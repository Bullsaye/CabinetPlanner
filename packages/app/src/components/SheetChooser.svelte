<script lang="ts">
  /**
   * Which drawing sheets go into an export (D75): every sheet of the project
   * as a list with checkboxes, grouped by room and cabinet. The selection
   * drives the PDF, the SVG zip, the CNC DXF zip and printing.
   */
  import { localName, projectSheets, sheetIndex, zip, type Part, type ResolvedStyle, type Sheet, type SheetInfo } from "@cabinet-planner/engine";
  import { SvelteSet } from "svelte/reactivity";
  import { localTimestamp, printSheets, type Paper } from "../lib/export.ts";
  import { download, downloadNote, store } from "../lib/store.svelte.ts";

  let {
    style,
    styleName,
    dxf,
    say,
  }: {
    /** Style of the part sheets (the one shown in the preview). */
    style: ResolvedStyle;
    styleName: string;
    /** Exports the CNC DXF of these parts (the drawings view owns profile and pack checks). */
    dxf: (partIds: string[]) => void;
    /** Shows a status line. */
    say: (text: string) => void;
  } = $props();

  const t = $derived(store.tr.t);
  let open = $state(false);
  let paper = $state<Paper>("sheet");
  let busy = $state(false);
  // What is NOT wanted: sheets that appear later (a new cabinet) are selected like the rest.
  const excluded = new SvelteSet<string>();

  const index = $derived(store.result ? sheetIndex(store.result, { tr: store.tr, style }) : []);
  const chosen = $derived(index.filter((s) => !excluded.has(s.name)));
  const partById = $derived(new Map<string, Part>([...(store.result?.parts ?? []), ...(store.result?.room?.parts ?? [])].map((p) => [p.id, p])));
  const cabinetId = $derived(store.cabinet?.resolved.cabinet.id);

  interface Group {
    id: string;
    title: string;
    sheets: SheetInfo[];
  }
  const groups = $derived.by(() => {
    const out: Group[] = [];
    const room = index.filter((s) => s.cabinet === undefined);
    if (room.length) out.push({ id: "room", title: t("ui.sheets_room"), sheets: room });
    for (const c of store.result?.cabinets ?? []) {
      const cab = c.resolved.cabinet;
      const sheets = index.filter((s) => s.cabinet === cab.id);
      if (sheets.length) out.push({ id: cab.id, title: cab.name ? `${cab.id} · ${cab.name}` : cab.id, sheets });
    }
    return out;
  });

  function label(s: SheetInfo): string {
    if (s.kind === "plan") return t("room.plan");
    if (s.kind === "elevation") return `${t("room.elevation")} ${t("room.wall")} ${s.wall}`;
    if (s.kind === "assembly") return t("ui.assembly_drawing");
    const p = partById.get(s.part ?? "");
    const name = p ? (p.label !== undefined ? localName(p.label, store.tr.locale) : t(`role.${p.role}`)) : "";
    return `${s.part} · ${name}${s.side ? ` (${t("ui.sheets_side", { index: s.side.index, of: s.side.of })})` : ""}`;
  }

  function setAll(list: readonly SheetInfo[], on: boolean): void {
    for (const s of list) {
      if (on) excluded.delete(s.name);
      else excluded.add(s.name);
    }
  }
  /** Selects exactly the sheets that pass the test. */
  function only(test: (s: SheetInfo) => boolean): void {
    for (const s of index) {
      if (test(s)) excluded.delete(s.name);
      else excluded.add(s.name);
    }
  }
  const count = (g: Group): number => g.sheets.filter((s) => !excluded.has(s.name)).length;

  function sheets(timestamp: string): Sheet[] {
    const r = store.result!;
    return projectSheets(r, {
      tr: store.tr,
      style,
      styleName,
      only: new Set(chosen.map((s) => s.name)),
      meta: { project: r.project.name, revision: r.project.revision, timestamp },
    });
  }
  /** File name stem: the cabinet when everything chosen belongs to one, else the project. */
  function base(): string {
    const cabs = new Set(chosen.map((s) => s.cabinet));
    const one = cabs.size === 1 ? [...cabs][0] : undefined;
    return one ?? (store.result?.project.name || "project").replace(/[^\w.-]+/g, "-");
  }

  async function run(how: "pdf" | "zip" | "print" | "dxf"): Promise<void> {
    if (!store.result || busy) return;
    if (!chosen.length) {
      say(t("ui.sheets_none_selected"));
      return;
    }
    if (how === "dxf") {
      const ids = [...new Set(chosen.filter((s) => s.part !== undefined).map((s) => s.part!))];
      if (ids.length) dxf(ids);
      else say(t("ui.sheets_no_parts"));
      return;
    }
    busy = true;
    const stamp = localTimestamp();
    try {
      if (how === "pdf") {
        say(t("ui.sheets_pdf_busy"));
        // Let the status line paint before the work starts.
        await new Promise((r) => setTimeout(r, 30));
        const list = sheets(stamp);
        const { sheetsToPdf } = await import("../lib/pdf.ts");
        const r = store.result;
        const pdf = await sheetsToPdf(list, { paper, title: r.project.name, timestamp: stamp });
        const name = `${base()}-sheets.pdf`;
        say(downloadNote(await download(name, pdf, "application/pdf"), `${name} (${t("cli.sheets", { n: list.length })})`, t));
      } else if (how === "zip") {
        const list = sheets(stamp);
        const name = `${base()}-sheets.zip`;
        say(downloadNote(await download(name, zip(list.map((s) => ({ name: s.name, data: s.svg }))), "application/zip"), `${name} (${list.length} SVG)`, t));
      } else {
        const list = sheets(stamp);
        const on = paper === "a3" ? "a3" : "a4";
        printSheets(list, on);
        say(t("ui.sheets_printed_fit", { n: list.length, paper: on.toUpperCase() }));
      }
    } catch (e) {
      say(t("ui.sheets_failed", { error: String((e as Error).message) }));
    } finally {
      busy = false;
    }
  }
</script>

<div class="sc">
  <div class="bar">
    <button class="toggle" aria-expanded={open} aria-controls="sheet-list" onclick={() => (open = !open)}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      {t("ui.sheets_choose")}
    </button>
    <span class="count mono" role="status">{t("ui.sheets_count", { n: chosen.length, total: index.length })}</span>
    <span class="sp"></span>
    <select id="sheet-paper" aria-label={t("ui.paper")} bind:value={paper}>
      <option value="sheet">{t("ui.paper.sheet")}</option>
      <option value="a4">A4</option>
      <option value="a3">A3</option>
    </select>
    <button class="primary" id="sheets-pdf" onclick={() => run("pdf")} disabled={busy}>{t("ui.sheets_pdf")}</button>
    <button id="sheets-zip" onclick={() => run("zip")} disabled={busy}>{t("ui.sheets_zip")}</button>
    <button id="sheets-dxf" onclick={() => run("dxf")} disabled={busy}>{t("ui.sheets_dxf")}</button>
    <button id="sheets-print" onclick={() => run("print")} disabled={busy}>{t("ui.sheets_print_on", { paper: paper === "a3" ? "A3" : "A4" })}</button>
  </div>
  {#if open}
    <div class="list" id="sheet-list">
      <div class="quick">
        <button onclick={() => setAll(index, true)}>{t("ui.sheets_all")}</button>
        <button onclick={() => setAll(index, false)}>{t("ui.sheets_none")}</button>
        <button onclick={() => only((s) => !!s.machined)}>{t("ui.sheets_machined")}</button>
        {#if cabinetId}
          <button onclick={() => only((s) => s.cabinet === cabinetId)}>{t("ui.sheets_only_cabinet", { cabinet: cabinetId })}</button>
        {/if}
      </div>
      <div class="groups">
        {#each groups as g (g.id)}
          {@const n = count(g)}
          <fieldset class="group">
            <legend>
              <label>
                <input type="checkbox" checked={n === g.sheets.length} indeterminate={n > 0 && n < g.sheets.length} onchange={(e) => setAll(g.sheets, (e.target as HTMLInputElement).checked)} />
                <strong>{g.title}</strong>
                <span class="muted mono">{n}/{g.sheets.length}</span>
              </label>
            </legend>
            {#each g.sheets as s (s.name)}
              <label class="item" class:plain={s.kind !== "part" && s.kind !== "room_part"}>
                <input type="checkbox" checked={!excluded.has(s.name)} onchange={(e) => setAll([s], (e.target as HTMLInputElement).checked)} />
                <span>{label(s)}</span>
              </label>
            {/each}
          </fieldset>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .sc { background: var(--surface-2); border-bottom: 1px solid var(--line); }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; align-items: center; }
  .toggle { font-weight: 600; white-space: nowrap; }
  .count { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .sp { flex: 1; }
  .list { border-top: 1px solid var(--line); padding: 8px; }
  .quick { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; max-height: 340px; overflow: auto; align-items: start; }
  .group { border: 1px solid var(--line); border-radius: 6px; background: var(--surface); padding: 4px 8px 6px; margin: 0; min-width: 0; }
  .group legend { padding: 0 4px; font-size: 12px; max-width: 100%; }
  .group legend label { display: flex; align-items: center; gap: 6px; }
  .group legend strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; }
  .item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item.plain span { color: var(--accent-fg); }
  input[type="checkbox"] { flex: none; margin: 0; }
  @media (pointer: coarse) {
    .item { padding: 7px 0; font-size: 14px; }
    input[type="checkbox"] { width: 20px; height: 20px; }
  }
</style>
