<script lang="ts">
  import { drawAssembly, drawingText, drawPartSheets, FACTORY_STYLES, localName, resolveStyle, stackSheets } from "@cabinet-planner/engine";
  import { copy, download, downloadNote, store } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  let kind = $state<"part" | "assembly">("part");
  let note = $state("");

  const cab = $derived(store.cabinet);
  const parts = $derived(cab?.parts ?? []);
  const partId = $derived(store.ui.part && parts.some((p) => p.id === store.ui.part) ? store.ui.part : parts[0]?.id);
  const styles = $derived([...FACTORY_STYLES, ...(store.built.shop?.library.drawingStyles ?? []), ...(store.result?.project.library.drawingStyles ?? [])]);

  function make(css: boolean): string {
    const r = store.result;
    if (!r || !cab || !cab.parts.length) return "";
    const v = (n: string): number => cab.resolved.values.get(n)!;
    const size = { W: v("W"), H: v("H"), D: v("D") };
    try {
      if (kind === "assembly") {
        const c = cab.resolved.cabinet;
        return drawAssembly({
          cabinet: { id: c.id, ...(c.name ? { name: c.name } : {}), ...size },
          parts: cab.parts,
          hardware: cab.hardware,
          library: r.library,
          text: drawingText(store.tr, r.library),
          project: { name: r.project.name, revision: r.project.revision },
          css,
        }).svg;
      }
      const part = cab.parts.find((p) => p.id === partId);
      if (!part) return "";
      const styleIn = [...styles].reverse().find((s) => s.id === store.ui.style) ?? FACTORY_STYLES[0]!;
      const style = resolveStyle(styleIn.id, styles);
      return stackSheets(
        drawPartSheets({ part, cabinet: size, style, text: drawingText(store.tr, r.library, localName(styleIn.name, store.tr.locale)), css }),
      );
    } catch (e) {
      return `<p>${String((e as Error).message)}</p>`;
    }
  }
  const svg = $derived(make(false));
  const fileName = $derived(kind === "assembly" ? `${cab?.resolved.cabinet.id}-assembly.svg` : `${partId}.svg`);
</script>

<section class="panel dv">
  <div class="bar">
    <div role="group" aria-label={t("ui.sheet")}>
      <button aria-pressed={kind === "part"} onclick={() => (kind = "part")}>{t("ui.part_sheet")}</button>
      <button aria-pressed={kind === "assembly"} onclick={() => (kind = "assembly")}>{t("ui.assembly_drawing")}</button>
    </div>
    {#if kind === "part"}
      <select id="draw-part" aria-label={t("ui.part")} value={partId} onchange={(e) => (store.ui.part = (e.target as HTMLSelectElement).value)}>
        {#each parts as p}<option value={p.id}>{p.id} · {t(`role.${p.role}`)}</option>{/each}
      </select>
      <select id="draw-style" aria-label={t("ui.style")} bind:value={store.ui.style}>
        {#each styles as s}<option value={s.id}>{localName(s.name, store.tr.locale)}</option>{/each}
      </select>
    {/if}
    <span class="sp"></span>
    <button onclick={async () => (note = downloadNote(await download(fileName, make(true), "image/svg+xml"), fileName, t))}>{t("ui.download_svg")}</button>
    <button onclick={async () => (note = (await copy(make(true))) ? t("ui.copied") : t("ui.copy_failed"))}>{t("ui.copy_svg")}</button>
  </div>
  {#if note}<p class="note muted">{note}</p>{/if}
  {#if !cab}
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
  .bar [role="group"] { display: flex; gap: 4px; }
  .sp { flex: 1; }
  .note { margin: 6px 10px 0; font-size: 12px; }
  .pad { padding: 16px; }
  .sheet { padding: 12px; }
</style>
