<script lang="ts">
  import { confirmCnc, untestedPackHardware } from "../lib/packs.ts";
  import {
    drawAssembly,
    drawingText,
    drawPartSheets,
    elevationSvg,
    floorPlanSvg,
    DxfProfileSchema,
    FACTORY_DXF_PROFILES,
    FACTORY_STYLES,
    localName,
    partDxf,
    resolveStyle,
    sheetFooter,
    sheetPage,
    stackSheets,
    zip,
    type CabinetResult,
    type DxfFile,
  } from "@cabinet-planner/engine";
  import { copy, download, downloadNote, store } from "../lib/store.svelte.ts";
  import { localTimestamp } from "../lib/export.ts";
  import SheetChooser from "./SheetChooser.svelte";

  const t = $derived(store.tr.t);
  let kind = $state<"part" | "assembly" | "plan" | "elevation" | "room_part">("part");
  let wallId = $state("A");
  let note = $state("");

  const cab = $derived(store.cabinet);
  const parts = $derived(cab?.parts ?? []);
  const partId = $derived(store.ui.part && parts.some((p) => p.id === store.ui.part) ? store.ui.part : parts[0]?.id);
  // Worktops and plinth panels belong to the room, not to a cabinet.
  const roomParts = $derived(store.result?.room?.parts ?? []);
  let roomPartId = $state("");
  const roomPart = $derived(roomParts.find((p) => p.id === roomPartId) ?? roomParts[0]);
  const styles = $derived([...FACTORY_STYLES, ...(store.built.shop?.library.drawingStyles ?? []), ...(store.result?.project.library.drawingStyles ?? [])]);

  // The room can go while a room sheet is open (undo, "work without a room"): back to the part sheet.
  $effect(() => {
    if (!store.result?.room && (kind === "plan" || kind === "elevation" || kind === "room_part")) kind = "part";
  });

  // The style of the part sheets: the preview and every export use the same one.
  const styleIn = $derived([...styles].reverse().find((s) => s.id === store.ui.style) ?? FACTORY_STYLES[0]!);
  const sheetStyle = $derived.by(() => {
    try {
      return resolveStyle(styleIn.id, styles);
    } catch {
      return resolveStyle(FACTORY_STYLES[0]!.id, []);
    }
  });

  /**
   * The sheet on show. `file`: for saving, with the stylesheet embedded and
   * the footer line (project, revision, time) every exported sheet carries.
   */
  function make(file: boolean): string {
    const css = file;
    const r = store.result;
    const foot = <T extends { svg: string; page: { w: number; h: number } }>(d: T): T =>
      file && r ? { ...d, svg: sheetFooter(d.svg, d.page, { project: r.project.name, revision: r.project.revision, timestamp: localTimestamp() }, fileName, store.tr) } : d;
    const whole = (svg: string): string => foot({ svg, page: sheetPage(svg) }).svg;
    if (r?.room && (kind === "plan" || kind === "elevation")) {
      const text = drawingText(store.tr, r.library);
      return whole(
        kind === "plan"
          ? floorPlanSvg(r.room, r.project.name, text, css)
          : elevationSvg(r.room, r.room.walls.some((w) => w.id === wallId) ? wallId : r.room.walls[0]!.id, r.cabinets, r.project.name, text, css),
      );
    }
    if (r && kind === "room_part") {
      if (!roomPart) return "";
      const styleIn = [...styles].reverse().find((s) => s.id === store.ui.style) ?? FACTORY_STYLES[0]!;
      const b = roomPart.box;
      return stackSheets(
        drawPartSheets({
          part: roomPart,
          cabinet: { W: b.dx, H: b.dy, D: b.dz },
          style: resolveStyle(styleIn.id, styles),
          text: drawingText(store.tr, r.library, localName(styleIn.name, store.tr.locale)),
          css,
        }).map(foot),
      );
    }
    if (!r || !cab || !cab.parts.length) return "";
    const v = (n: string): number => cab.resolved.values.get(n)!;
    const size = { W: v("W"), H: v("H"), D: v("D") };
    try {
      if (kind === "assembly") {
        const c = cab.resolved.cabinet;
        return whole(
          drawAssembly({
            cabinet: { id: c.id, ...(c.name ? { name: c.name } : {}), ...size },
            parts: cab.parts,
            hardware: cab.hardware,
            library: r.library,
            text: drawingText(store.tr, r.library),
            project: { name: r.project.name, revision: r.project.revision },
            css,
          }).svg,
        );
      }
      const part = cab.parts.find((p) => p.id === partId);
      if (!part) return "";
      const styleIn = [...styles].reverse().find((s) => s.id === store.ui.style) ?? FACTORY_STYLES[0]!;
      const style = resolveStyle(styleIn.id, styles);
      return stackSheets(
        drawPartSheets({ part, cabinet: size, style, text: drawingText(store.tr, r.library, localName(styleIn.name, store.tr.locale)), css }).map(foot),
      );
    } catch (e) {
      return `<p>${String((e as Error).message)}</p>`;
    }
  }
  const svg = $derived(make(false));

  // CNC export: one DXF per machined part side, always delivered as a zip.
  const profiles = $derived([...FACTORY_DXF_PROFILES, ...(store.built.shop?.library.dxfProfiles ?? []), ...(store.result?.project.library.dxfProfiles ?? [])]);
  let profileId = $state("generic");
  function dxfOf(cabs: CabinetResult[], partFilter?: string): DxfFile[] {
    const r = store.result!;
    const profile = DxfProfileSchema.parse([...profiles].reverse().find((p) => p.id === profileId) ?? profiles[0]);
    const meta = { project: r.project.name, revision: r.project.revision, timestamp: new Date().toISOString().slice(0, 19) };
    return cabs.flatMap((c) => {
      const v = (n: string): number => c.resolved.values.get(n)!;
      return c.parts.filter((p) => !partFilter || p.id === partFilter).flatMap((p) => partDxf(p, { W: v("W"), H: v("H"), D: v("D") }, profile, meta));
    });
  }
  type DxfScope = "part" | "cabinet" | "project" | "selection";
  let cncAsk = $state<{ scope: DxfScope; ids?: string[]; items: { id: string; pack: string }[] } | null>(null);
  /** `ids`: the parts of scope "selection" (the part sheets ticked in the sheet chooser). */
  async function exportDxf(scope: DxfScope, ids?: string[]): Promise<void> {
    const r = store.result;
    if (!r || !r.ok) {
      note = t("ui.fix_errors_first");
      return;
    }
    const profile = DxfProfileSchema.parse([...profiles].reverse().find((p) => p.id === profileId) ?? profiles[0]);
    const meta = { project: r.project.name, revision: r.project.revision, timestamp: new Date().toISOString().slice(0, 19) };
    const roomDxf = (list: typeof roomParts) => list.flatMap((p) => partDxf(p, { W: p.box.dx, H: p.box.dy, D: p.box.dz }, profile, meta));
    const roomScope = kind === "room_part";
    const picked = scope === "selection" ? new Set(ids ?? []) : undefined;
    const cabs = picked ? r.cabinets.filter((c) => c.parts.some((p) => picked.has(p.id))) : scope === "project" ? r.cabinets : cab && !roomScope ? [cab] : [];
    // Hardware from an untested community pack: the first CNC export asks (PLAN.md, trust levels).
    const usedHardware = cabs.flatMap((c) => c.hardware.map((h) => h.item));
    const untested = untestedPackHardware(store.shop, usedHardware);
    if (untested.length && cncAsk?.scope !== scope) {
      cncAsk = { scope, ...(ids ? { ids } : {}), items: untested };
      return;
    }
    if (cncAsk) confirmCnc(store.shop, usedHardware);
    cncAsk = null;
    const files = picked
      ? [...dxfOf(cabs).filter((f) => picked.has(f.part)), ...roomDxf(roomParts.filter((p) => picked.has(p.id)))]
      : roomScope && scope === "part"
        ? roomDxf(roomPart ? [roomPart] : [])
        : [...dxfOf(cabs, scope === "part" ? partId : undefined), ...(scope === "project" ? roomDxf(roomParts) : [])];
    const base =
      scope === "project" || scope === "selection"
        ? (r.project.name || "project").replace(/[^\w.-]+/g, "-")
        : roomScope && scope === "part"
          ? roomPart?.id
          : scope === "cabinet"
            ? cab!.resolved.cabinet.id
            : partId;
    const name = `${base}-dxf.zip`;
    note = downloadNote(await download(name, zip(files.map((f) => ({ name: f.name, data: f.content }))), "application/zip"), `${name} (${files.length} DXF)`, t);
  }

  const fileName = $derived(
    kind === "room_part" ? `${roomPart?.id}.svg` : kind === "assembly" ? `${cab?.resolved.cabinet.id}-assembly.svg` : kind === "plan" ? "floor-plan.svg" : kind === "elevation" ? `elevation-${wallId}.svg` : `${partId}.svg`,
  );
</script>

<section class="panel dv">
  <div class="bar">
    <div role="group" aria-label={t("ui.sheet")}>
      <button aria-pressed={kind === "part"} onclick={() => (kind = "part")}>{t("ui.part_sheet")}</button>
      <button aria-pressed={kind === "assembly"} onclick={() => (kind = "assembly")}>{t("ui.assembly_drawing")}</button>
      {#if store.result?.room}
        <button aria-pressed={kind === "plan"} onclick={() => (kind = "plan")}>{t("room.plan")}</button>
        <button aria-pressed={kind === "elevation"} onclick={() => (kind = "elevation")}>{t("room.elevation")}</button>
        {#if roomParts.length}
          <button aria-pressed={kind === "room_part"} onclick={() => (kind = "room_part")}>{t("ui.room_parts")}</button>
        {/if}
      {/if}
    </div>
    {#if kind === "elevation" && store.result?.room}
      <select id="draw-wall" aria-label={t("ui.wall")} bind:value={wallId}>
        {#each store.result.room.walls as w}<option value={w.id}>{t("room.wall")} {w.id}</option>{/each}
      </select>
    {/if}
    {#if kind === "room_part"}
      <select id="draw-room-part" aria-label={t("ui.part")} value={roomPart?.id} onchange={(e) => (roomPartId = (e.target as HTMLSelectElement).value)}>
        {#each roomParts as p}<option value={p.id}>{p.code} · {t(`role.${p.role}`)} · {p.length} × {p.width}</option>{/each}
      </select>
    {/if}
    {#if kind === "part" || kind === "room_part"}
      <select id="draw-style" aria-label={t("ui.style")} bind:value={store.ui.style}>
        {#each styles as s}<option value={s.id}>{localName(s.name, store.tr.locale)}</option>{/each}
      </select>
    {/if}
    {#if kind === "part"}
      <select id="draw-part" aria-label={t("ui.part")} value={partId} onchange={(e) => (store.ui.part = (e.target as HTMLSelectElement).value)}>
        {#each parts as p}<option value={p.id}>{p.id} · {t(`role.${p.role}`)}</option>{/each}
      </select>
    {/if}
    <span class="sp"></span>
    <button onclick={async () => (note = downloadNote(await download(fileName, make(true), "image/svg+xml"), fileName, t))}>{t("ui.download_svg")}</button>
    <button onclick={async () => (note = (await copy(make(true))) ? t("ui.copied") : t("ui.copy_failed"))}>{t("ui.copy_svg")}</button>
  </div>
  <div class="bar cnc">
    <span class="label">{t("ui.cnc_export")}</span>
    <select id="dxf-profile" aria-label={t("ui.dxf_profile")} bind:value={profileId}>
      {#each profiles as p}<option value={p.id}>{localName(p.name, store.tr.locale)}</option>{/each}
    </select>
    <button onclick={() => exportDxf("part")} disabled={kind === "room_part" ? !roomPart : !partId}>{t("ui.dxf_part")}</button>
    <button onclick={() => exportDxf("cabinet")} disabled={!cab || kind === "room_part"}>{t("ui.dxf_cabinet")}</button>
    <button onclick={() => exportDxf("project")}>{t("ui.dxf_project")}</button>
  </div>
  <SheetChooser style={sheetStyle} styleName={localName(styleIn.name, store.tr.locale)} dxf={(ids) => exportDxf("selection", ids)} say={(text) => (note = text)} />
  {#if cncAsk}
    <div class="c-notice warn" role="alertdialog" aria-label={t("cloud.cnc.title")} style="margin: 8px">
      <strong>{t("cloud.cnc.title")}</strong>
      <p>{t("cloud.cnc.text", { items: cncAsk.items.map((x) => `${x.id} (${x.pack})`).join(", ") })}</p>
      <div class="c-row">
        <button onclick={() => exportDxf(cncAsk!.scope, cncAsk!.ids)}>{t("cloud.cnc.export")}</button>
        <button class="quiet" onclick={() => (cncAsk = null)}>{t("ui.cancel")}</button>
      </div>
    </div>
  {/if}
  {#if note}<p class="note muted" role="status">{note}</p>{/if}
  {#if kind === "plan" || kind === "elevation" || kind === "room_part"}
    <div class="sheet scroll-x">{@html svg}</div>
  {:else if !cab}
    <p class="muted pad">{t("ui.select_cabinet")}</p>
  {:else if !cab.parts.length}
    <p class="muted pad">{t("ui.fix_errors_first")}</p>
  {:else}
    <div class="sheet scroll-x">{@html svg}</div>
  {/if}
</section>

<style>
  .dv { display: flex; flex-direction: column; min-height: 460px; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); align-items: center; }
  .bar [role="group"] { display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; }
  .bar [role="group"] button { white-space: nowrap; }
  .cnc { background: var(--surface-2); }
  .sp { flex: 1; }
  .note { margin: 6px 10px 0; font-size: 12px; }
  .pad { padding: 16px; }
  .sheet { padding: 12px; }
</style>
