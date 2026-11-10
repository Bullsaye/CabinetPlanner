<script lang="ts">
  import { cutlistCsv, cutlistRows, formatNumber, localName, type CutlistRow } from "@cabinet-planner/engine";
  import { copy, download, downloadNote, store } from "../lib/store.svelte.ts";
  import { csvForDownload } from "../lib/export.ts";

  const t = $derived(store.tr.t);
  let group = $state(true);
  let scope = $state<"project" | "cabinet">("project");
  let note = $state("");

  const parts = $derived(
    scope === "cabinet" ? (store.cabinet?.parts ?? []) : (store.result?.parts ?? []),
  );
  const text = $derived({
    locale: store.tr.locale,
    shaped: t("cutlist.shaped"),
    header: (col: string) => t(`col.${col}`),
    role: (row: CutlistRow) => {
      if (row.label !== undefined) return localName(row.label, store.tr.locale);
      const codes = new Set(row.parts.map((p) => p.slice(p.lastIndexOf("-") + 1)));
      if (row.qty > 1 && codes.has("SL") && codes.has("SR")) return t("role.side_pair");
      if (row.qty > 1 && codes.has("RF") && codes.has("RR")) return t("role.rail_pair");
      return t(`role.${row.role}`);
    },
  });
  const rows = $derived(store.result ? cutlistRows(parts, store.result.library, { group }) : []);
  const lib = $derived(store.result?.library);
  const fmt = (x: number): string => formatNumber(x);
  const materialName = (id: string): string => localName(lib?.materials.get(id)?.name ?? id, store.tr.locale);
  const surfaceOf = (id: string) => (id ? lib?.surfaces.get(id) : undefined);
  /** Shown part numbers: a grouped row lists its codes without repeating the cabinet. */
  const partLabel = (r: CutlistRow): string => (r.parts.length > 1 ? `${r.cabinet}-${r.parts.map((p) => p.slice(p.lastIndexOf("-") + 1)).join("/")}` : r.part);
  const noteOf = (r: CutlistRow): string => [r.note, r.outline ? t("cutlist.shaped") : ""].filter(Boolean).join("; ");
  /** Edge picture: the part as a rectangle in its proportions (clamped), banded edges drawn heavy. */
  function edgeBox(r: CutlistRow): { w: number; h: number } {
    const ratio = Math.min(3, Math.max(1 / 3, r.length / r.width));
    return ratio >= 1 ? { w: 36, h: Math.max(12, 36 / ratio) } : { w: Math.max(12, 36 * ratio), h: 36 };
  }

  function csv(): string {
    return store.result ? cutlistCsv(cutlistRows(parts, store.result.library, { group }), store.result.library, text, { delimiter: ";" }) : "";
  }
  const m2 = $derived.by(() => {
    const by = new Map<string, number>();
    for (const p of parts) by.set(p.material, (by.get(p.material) ?? 0) + (p.length * p.width) / 1e6);
    return [...by.entries()].map(([id, a]) => ({ name: localName(store.result!.library.materials.get(id)?.name ?? id, store.tr.locale), a }));
  });
</script>

<section class="panel cl">
  <div class="bar">
    <div role="group" aria-label={t("ui.scope")}>
      <button aria-pressed={scope === "project"} onclick={() => (scope = "project")}>{t("ui.whole_project")}</button>
      <button aria-pressed={scope === "cabinet"} onclick={() => (scope = "cabinet")} disabled={!store.cabinet}>{store.ui.selected ?? t("ui.cabinet")}</button>
    </div>
    <button aria-pressed={group} onclick={() => (group = !group)}>{t("ui.group_identical")}</button>
    <span class="sp"></span>
    <button onclick={async () => (note = downloadNote(await download("cutlist.csv", csvForDownload(csv()), "text/csv"), "cutlist.csv", t))}>{t("ui.download_csv")}</button>
    <button onclick={async () => (note = (await copy(csv())) ? t("ui.copied") : t("ui.copy_failed"))}>{t("ui.copy_csv")}</button>
  </div>
  {#if note}<p class="note muted">{note}</p>{/if}
  <div class="scroll-x tbl">
    <table class="grid">
      <thead>
        <tr>
          <th>{t("col.part")}</th><th>{t("col.role")}</th><th class="n">{t("ui.pieces")}</th><th class="n">{t("col.length")}</th><th class="n">{t("col.width")}</th><th class="n">{t("col.thickness")}</th>
          <th>{t("col.material")}</th><th>{t("col.surface")}</th><th>{t("ui.edges")}</th><th class="n">{t("ui.cut_size")}</th><th>{t("col.note")}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.part)}
          {@const sf = surfaceOf(r.surface)}
          {@const eb = edgeBox(r)}
          <tr>
            <td class="mono">{partLabel(r)}</td>
            <td>{text.role(r)}</td>
            <td class="n">{r.qty}</td>
            <td class="n">{fmt(r.length)}</td>
            <td class="n">{fmt(r.width)}</td>
            <td class="n">{fmt(r.thickness)}</td>
            <td>{materialName(r.material)}{#if r.grain}<span class="muted" title={t("col.grain")}> ↔</span>{/if}</td>
            <td>{#if sf}<span class="swatch" style={`background:${sf.color ?? "transparent"}`}></span> {localName(sf.name, store.tr.locale)}{/if}</td>
            <td class="edges">
              <svg width="30" height="30" viewBox="-4 -4 44 44" role="img" aria-label={`${t("ui.edges")}: ${r.edges.map((e, k) => `${["L1", "L2", "B1", "B2"][k]} ${e || "–"}`).join(", ")}`}>
                <g transform={`translate(${(36 - eb.w) / 2} ${(36 - eb.h) / 2})`}>
                  <rect class="eb-part" x="0" y="0" width={eb.w} height={eb.h} />
                  <!-- Length runs left to right: L1 bottom, L2 top, W1 left, W2 right (D4). -->
                  {#if r.edges[0]}<line class="eb-on" x1="0" y1={eb.h} x2={eb.w} y2={eb.h} />{/if}
                  {#if r.edges[1]}<line class="eb-on" x1="0" y1="0" x2={eb.w} y2="0" />{/if}
                  {#if r.edges[2]}<line class="eb-on" x1="0" y1="0" x2="0" y2={eb.h} />{/if}
                  {#if r.edges[3]}<line class="eb-on" x1={eb.w} y1="0" x2={eb.w} y2={eb.h} />{/if}
                </g>
              </svg>
              <span class="mono small">{[...new Set(r.edges.filter(Boolean))].join(" ")}</span>
            </td>
            <td class="n muted">{fmt(r.cutLength)} × {fmt(r.cutWidth)}</td>
            <td>{noteOf(r)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="sum muted">
    {#each m2 as x}<span>{x.name}: <span class="mono">{x.a.toFixed(2)} m²</span></span>{/each}
  </div>
</section>

<style>
  .cl { display: flex; flex-direction: column; min-height: 460px; height: 100%; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); align-items: center; }
  .bar [role="group"] { display: flex; gap: 4px; }
  .sp { flex: 1; }
  .note { margin: 6px 10px 0; font-size: 12px; }
  .tbl { flex: 1; overflow: auto; }
  .tbl :global(table.grid td), .tbl :global(table.grid th) { padding: 3px 8px; }
  .edges { display: flex; align-items: center; gap: 6px; }
  .edges svg { flex: none; }
  .eb-part { fill: var(--surface-2); stroke: var(--line); stroke-width: 1; }
  .eb-on { stroke: var(--accent); stroke-width: 3.5; stroke-linecap: square; }
  .swatch { display: inline-block; width: 14px; height: 14px; border: 1px solid var(--line); border-radius: 3px; vertical-align: -2px; }
  .small { font-size: 11px; }
  th.n { text-align: right; }
  .sum { display: flex; flex-wrap: wrap; gap: 16px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: 12px; }
</style>
