<script lang="ts">
  import { cutlistCsv, cutlistRows, localName, type CutlistRow } from "@cabinet-planner/engine";
  import { copy, download, downloadNote, store } from "../lib/store.svelte.ts";
  import { csvForDownload } from "../lib/export.ts";
  import { bandColour, EDGE_KEYS, partCode, partEdgeOverride, setPartEdge, setPartEdgeNote, type EdgeKey } from "../lib/edges.ts";
  import EdgeEditor from "./EdgeEditor.svelte";

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
    edge: (e: string) => t(`edge.${e}`),
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
  // Shown in the reader's number format (decimal comma in German); the CSV keeps the machine format (D10).
  const fmt = (x: number): string => store.tr.number(x, 2);
  /** The cabinet a row belongs to, as an editable document (room parts have none). */
  const cabinetDoc = (r: CutlistRow): Record<string, any> | undefined => (store.project.cabinets ?? []).find((c: Record<string, any>) => c.id === r.cabinet);
  /** Writes the remark to every part of the row (part override `note`); empty removes it. */
  function setNote(r: CutlistRow, text: string): void {
    const c = cabinetDoc(r);
    if (!c) return;
    c.parts ??= {};
    for (const id of r.parts) {
      const code = id.slice(id.lastIndexOf("-") + 1);
      const o = { ...(c.parts[code] ?? {}) };
      if (text.trim()) o.note = text.trim();
      else delete o.note;
      if (Object.keys(o).length) c.parts[code] = o;
      else delete c.parts[code];
    }
  }
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

  // Edges by name (D75): L1, L2, B1, B2 with the edgeband code and a remark; a click edits one edge.
  const bands = $derived([...(lib?.edgebands.values() ?? [])].map((e) => ({ id: e.id, code: e.code ?? e.id, name: localName(e.name, store.tr.locale) })));
  const bandCodes = $derived(bands.map((b) => b.code));
  const edgeName = (k: EdgeKey): string => t(`ui.edge.${k}`);
  const edgeText = (r: CutlistRow, i: number): string => [r.edges[i] || (r.edgeNotes[i] ? "" : "–"), r.edgeNotes[i]].filter(Boolean).join(" ");
  const edgesLabel = (r: CutlistRow): string => `${t("ui.edges")}: ${EDGE_KEYS.map((k, i) => `${edgeName(k)} ${edgeText(r, i)}`).join(", ")}`;
  /** The edge being edited: the parts of its row when it was opened, and where the popover sits. */
  let editing = $state<{ ids: string[]; cabinet: string; edge: EdgeKey; x: number; y: number } | null>(null);
  const editRow = $derived(editing ? rows.find((r) => r.parts.includes(editing!.ids[0]!)) : undefined);
  const editDoc = $derived(editing ? (store.project.cabinets ?? []).find((c: Record<string, any>) => c.id === editing!.cabinet) : undefined);
  function openEdge(e: MouseEvent, r: CutlistRow, edge: EdgeKey): void {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    const h = 190;
    editing = {
      ids: [...r.parts],
      cabinet: r.cabinet,
      edge,
      x: Math.max(8, Math.min(box.left, window.innerWidth - w - 8)),
      y: box.bottom + 4 + h > window.innerHeight ? Math.max(8, box.top - h - 4) : box.bottom + 4,
    };
  }
  function applyEdge(change: (doc: Record<string, any>, code: string, edge: EdgeKey) => void): void {
    if (!editing || !editDoc) return;
    for (const id of editing.ids) change(editDoc, partCode(id), editing.edge);
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
            <td>
              <div class="edges">
                <svg width="30" height="30" viewBox="-4 -4 44 44" role="img" aria-label={edgesLabel(r)}>
                  <g transform={`translate(${(36 - eb.w) / 2} ${(36 - eb.h) / 2})`}>
                    <rect class="eb-part" x="0" y="0" width={eb.w} height={eb.h} />
                    <!-- Length runs left to right: L1 bottom, L2 top, W1 left, W2 right (D4). One colour per edgeband; a remark without a band is dotted. -->
                    {#each [[0, eb.h, eb.w, eb.h], [0, 0, eb.w, 0], [0, 0, 0, eb.h], [eb.w, 0, eb.w, eb.h]] as [x1, y1, x2, y2], i}
                      {#if r.edges[i]}
                        <line class="eb-on" style={`stroke:${bandColour(r.edges[i]!, bandCodes)}`} {x1} {y1} {x2} {y2} />
                      {:else if r.edgeNotes[i]}
                        <line class="eb-note" {x1} {y1} {x2} {y2} />
                      {/if}
                    {/each}
                  </g>
                </svg>
                <div class="eg">
                  {#each EDGE_KEYS as k, i (k)}
                    {#if cabinetDoc(r)}
                      <button
                        class="e"
                        aria-haspopup="dialog"
                        aria-label={`${t("ui.edge_edit", { edge: edgeName(k), part: partLabel(r) })}: ${edgeText(r, i)}`}
                        onclick={(e) => openEdge(e, r, k)}
                      >
                        <span class="en">{edgeName(k)}</span>
                        {#if r.edges[i]}<span class="ec" style={`color:${bandColour(r.edges[i]!, bandCodes)}`}>{r.edges[i]}</span>{:else if !r.edgeNotes[i]}<span class="ec none">–</span>{/if}
                        {#if r.edgeNotes[i]}<span class="er">{r.edgeNotes[i]}</span>{/if}
                      </button>
                    {:else}
                      <span class="e">
                        <span class="en">{edgeName(k)}</span>
                        {#if r.edges[i]}<span class="ec" style={`color:${bandColour(r.edges[i]!, bandCodes)}`}>{r.edges[i]}</span>{:else if !r.edgeNotes[i]}<span class="ec none">–</span>{/if}
                        {#if r.edgeNotes[i]}<span class="er">{r.edgeNotes[i]}</span>{/if}
                      </span>
                    {/if}
                  {/each}
                </div>
              </div>
            </td>
            <td class="n muted">{fmt(r.cutLength)} × {fmt(r.cutWidth)}</td>
            <td class="note-cell">
              {#if cabinetDoc(r)}
                <input type="text" aria-label={`${t("col.note")} ${partLabel(r)}`} value={r.note} placeholder="–" onchange={(e) => setNote(r, (e.target as HTMLInputElement).value)} />
                {#if r.outline}<span class="muted small">{t("cutlist.shaped")}</span>{/if}
              {:else}{noteOf(r)}{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="sum muted">
    {#each m2 as x}<span>{x.name}: <span class="mono">{x.a.toFixed(2)} m²</span></span>{/each}
  </div>
</section>

<svelte:window onkeydown={(e) => e.key === "Escape" && (editing = null)} />
{#if editing && editRow && editDoc}
  {@const i = EDGE_KEYS.indexOf(editing.edge)}
  {@const override = partEdgeOverride(editDoc, partCode(editing.ids[0]!), editing.edge)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="pop-back" onclick={() => (editing = null)}></div>
  <div class="pop" role="dialog" aria-label={t("ui.edge_edit", { edge: edgeName(editing.edge), part: partLabel(editRow) })} style={`left:${editing.x}px;top:${editing.y}px`}>
    <header>
      <strong>{t("ui.edge_edit", { edge: edgeName(editing.edge), part: partLabel(editRow) })}</strong>
    </header>
    <EdgeEditor
      id="cl-edge"
      band={override}
      constructed={override === undefined ? editRow.edges[i] : undefined}
      {bands}
      note={editRow.edgeNotes[i] ?? ""}
      onband={(band) => applyEdge((doc, code, edge) => setPartEdge(doc, code, edge, band))}
      onnote={(text) => applyEdge((doc, code, edge) => setPartEdgeNote(doc, code, edge, text))}
    />
    <footer><button class="primary" onclick={() => (editing = null)}>{t("ui.done")}</button></footer>
  </div>
{/if}

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
  .eb-note { stroke: var(--warn); stroke-width: 2.5; stroke-dasharray: 2 3; }
  .eg { display: grid; grid-template-columns: repeat(2, auto); gap: 1px 4px; justify-content: start; }
  .e { display: inline-flex; align-items: baseline; gap: 4px; font-family: var(--font-mono); font-size: 11px; line-height: 1.5; white-space: nowrap; padding: 0 4px; min-height: 0; border-radius: 4px; }
  button.e { border-color: transparent; background: transparent; cursor: pointer; }
  button.e:hover, button.e:focus-visible { border-color: var(--line); background: var(--surface); }
  .en { color: var(--muted); }
  .ec { font-weight: 600; }
  .ec.none { color: var(--muted); font-weight: 400; }
  .er { color: var(--warn); font-weight: 600; }
  .pop-back { position: fixed; inset: 0; z-index: 40; }
  .pop { position: fixed; z-index: 41; width: min(300px, calc(100vw - 16px)); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 28px rgb(0 0 0 / 0.22); padding: 10px; display: grid; gap: 8px; }
  .pop header { font-size: 12px; }
  .pop footer { display: flex; justify-content: flex-end; }
  @media (pointer: coarse) {
    .e { font-size: 13px; padding: 5px 6px; }
  }
  .swatch { display: inline-block; width: 14px; height: 14px; border: 1px solid var(--line); border-radius: 3px; vertical-align: -2px; }
  .small { font-size: 11px; }
  .note-cell input { min-width: 12em; width: 100%; border-color: transparent; background: transparent; padding: 2px 4px; }
  .note-cell input:hover, .note-cell input:focus { border-color: var(--line); background: var(--surface); }
  th.n { text-align: right; }
  .sum { display: flex; flex-wrap: wrap; gap: 16px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: 12px; }
</style>
