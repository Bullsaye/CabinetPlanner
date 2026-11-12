<script lang="ts">
  import { bomCsv, bomText, buildBom, formatLengths, localName, VARIABLE_BY_NAME, type ProjectResult } from "@cabinet-planner/engine";
  import { copy, download, downloadNote, parseInput, setVar, store } from "../lib/store.svelte.ts";
  import { csvForDownload } from "../lib/export.ts";

  /**
   * Bill of materials: the one place for order quantities and cost. All
   * numbers come from the engine's buildBom, the same data the CSV holds.
   */
  const t = $derived(store.tr.t);
  let scope = $state<"project" | "cabinet">("project");
  let note = $state("");

  // One cabinet: the same calculation on that cabinet's parts and hardware.
  const result = $derived.by((): ProjectResult | undefined => {
    const r = store.result;
    const c = store.cabinet;
    if (!r || scope === "project" || !c) return r;
    return { ...r, cabinets: [c], parts: c.parts };
  });
  const bom = $derived(result ? buildBom(result) : undefined);
  const lib = $derived(store.result?.library);
  const text = $derived(bomText(store.tr));

  // Display only: locale decimal separator, always two decimals so columns line up.
  const money = $derived.by(() => {
    const f = new Intl.NumberFormat(store.tr.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (x: number | undefined): string => (x === undefined ? "–" : f.format(x));
  });
  const num = (x: number): string => money(x);
  const qty = (x: number): string => store.tr.number(x, 2);
  const name = (kind: "materials" | "edgebands" | "hardware", id: string): string => {
    const item = lib?.[kind].get(id);
    return item ? localName(item.name, store.tr.locale) : id;
  };
  const missing = $derived(bom ? bom.totals.unpriced.material + bom.totals.unpriced.edgeband + bom.totals.unpriced.hardware : 0);
  const rows = $derived(bom ? bom.materials.length + bom.edgebands.length + bom.hardware.length : 0);
  const anyPrice = $derived(missing < rows);
  // A sum only shows when at least one of its rows has a price.
  const priced = $derived({
    material: !!bom && bom.totals.unpriced.material < bom.materials.length,
    edgeband: !!bom && bom.totals.unpriced.edgeband < bom.edgebands.length,
    hardware: !!bom && bom.totals.unpriced.hardware < bom.hardware.length,
  });
  const sum = (cost: number, show: boolean): string => money(show ? cost : undefined);

  const SETTINGS = ["waste_pct", "edge_allowance"] as const;
  const own = (n: string): string => (store.project.vars?.[n] === undefined ? "" : String(store.project.vars[n]));
  const unitOf = (n: string): string => (VARIABLE_BY_NAME.get(n)?.unit === "percent" ? "%" : "mm");

  function csv(): string {
    return bom && result ? bomCsv(bom, result, text, { delimiter: ";", cabinets: scope === "project" }) : "";
  }
  const file = $derived(scope === "cabinet" && store.cabinet ? `bom-${store.cabinet.resolved.cabinet.id}.csv` : "bom.csv");
</script>

<section class="panel bv">
  <div class="bar">
    <div role="group" aria-label={t("ui.scope")}>
      <button aria-pressed={scope === "project"} onclick={() => (scope = "project")}>{t("ui.whole_project")}</button>
      <button aria-pressed={scope === "cabinet"} onclick={() => (scope = "cabinet")} disabled={!store.cabinet}>{store.ui.selected ?? t("ui.cabinet")}</button>
    </div>
    <span class="sp"></span>
    <button onclick={async () => (note = downloadNote(await download(file, csvForDownload(csv()), "text/csv"), file, t))}>{t("ui.download_csv")}</button>
    <button onclick={async () => (note = (await copy(csv())) ? t("ui.copied") : t("ui.copy_failed"))}>{t("ui.copy_csv")}</button>
  </div>
  {#if note}<p class="note muted" role="status">{note}</p>{/if}

  {#if bom}
    <div class="body">
      <div class="totals" aria-label={t("ui.bom.total")}>
        <div><span class="label">{t("bom.total.material")}</span><span class="mono">{sum(bom.totals.material, priced.material)}</span></div>
        <div><span class="label">{t("bom.total.edgeband")}</span><span class="mono">{sum(bom.totals.edgeband, priced.edgeband)}</span></div>
        <div><span class="label">{t("bom.total.hardware")}</span><span class="mono">{sum(bom.totals.hardware, priced.hardware)}</span></div>
        <div class="all"><span class="label">{t("bom.total.all")}</span><span class="mono">{money(anyPrice ? bom.totals.total : undefined)}</span></div>
      </div>
      {#if missing}<p class="warn">{t("ui.bom.unpriced", { n: missing })}</p>{/if}

      <h2 class="label">{t("ui.bom.board")}</h2>
      <div class="scroll-x">
        <table class="grid">
          <thead>
            <tr>
              <th>{t("ui.bom.material")}</th><th class="n">{t("ui.bom.parts")}</th><th class="n">{t("ui.bom.net_m2")}</th>
              <th class="n">{t("ui.bom.gross_m2")}</th><th class="n">{t("ui.price_m2")}</th><th class="n">{t("ui.bom.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {#each bom.materials as m (m.material)}
              <tr>
                <td>{name("materials", m.material)}</td>
                <td class="n">{m.parts}</td>
                <td class="n">{num(m.netArea)}</td>
                <td class="n">{num(m.grossArea)}</td>
                <td class="n">{money(m.pricePerM2)}</td>
                <td class="n">{money(m.cost)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <h2 class="label">{t("ui.bom.edgebands")}</h2>
      <div class="scroll-x">
        <table class="grid">
          <thead>
            <tr>
              <th>{t("ui.bom.edgeband")}</th><th class="n">{t("ui.bom.edges")}</th><th class="n">{t("ui.bom.net_m")}</th>
              <th class="n">{t("ui.bom.gross_m")}</th><th class="n">{t("ui.bom.price_m")}</th><th class="n">{t("ui.bom.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {#each bom.edgebands as b (b.edgeband)}
              <tr>
                <td>{name("edgebands", b.edgeband)}</td>
                <td class="n">{b.edges}</td>
                <td class="n">{num(b.netLength)}</td>
                <td class="n">{num(b.length)}</td>
                <td class="n">{money(b.pricePerM)}</td>
                <td class="n">{money(b.cost)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <h2 class="label">{t("ui.hardware_needed")}</h2>
      <div class="scroll-x">
        <table class="grid">
          <thead>
            <tr>
              <th class="n">{t("cli.col.qty")}</th><th>{t("cli.col.item")}</th><th>{t("ui.articles")}</th>
              <th class="n">{t("ui.bom.price")}</th><th class="n">{t("ui.bom.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {#each bom.hardware as h (h.item + "|" + h.article)}
              <tr>
                <td class="n">{qty(h.qty)} {text.unit(h.unit)}</td>
                <td class="wrap">
                  {name("hardware", h.item)}
                  {#if h.lengths.length}<span class="mono muted"> · {formatLengths(h.lengths)}</span>{/if}
                </td>
                <td class="mono">{h.article}</td>
                <td class="n">{money(h.price)}</td>
                <td class="n">{money(h.cost)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if scope === "project" && bom.cabinets.length > 1}
        <h2 class="label">{t("ui.bom.cabinets")}</h2>
        <div class="scroll-x">
          <table class="grid">
            <thead>
              <tr>
                <th>{t("ui.cabinet")}</th><th>{t("ui.name")}</th><th class="n">{t("ui.bom.net_m2")}</th><th class="n">{t("bom.total.material")}</th>
                <th class="n">{t("bom.total.edgeband")}</th><th class="n">{t("bom.total.hardware")}</th><th class="n">{t("ui.bom.total")}</th>
              </tr>
            </thead>
            <tbody>
              {#each bom.cabinets as c (c.cabinet)}
                <tr>
                  <td class="mono">{c.cabinet === "ROOM" ? "" : c.cabinet}</td>
                  <td>{c.cabinet === "ROOM" ? t("ui.bom.room") : c.name}</td>
                  <td class="n">{num(c.netArea)}</td>
                  <td class="n">{sum(c.material, priced.material)}</td>
                  <td class="n">{sum(c.edgeband, priced.edgeband)}</td>
                  <td class="n">{sum(c.hardware, priced.hardware)}</td>
                  <td class="n">{money(anyPrice ? c.total : undefined)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <h2 class="label">{t("ui.bom.settings")}</h2>
      <div class="settings">
        {#each SETTINGS as n (n)}
          <label for={`bom-${n}`} title={t(`var.${n}.hint`)}>{t(`var.${n}`)}</label>
          <span class="field">
            <input
              id={`bom-${n}`}
              class="mono"
              type="text"
              inputmode="decimal"
              value={own(n)}
              placeholder={String(store.result?.values.get(n) ?? "")}
              onchange={(e) => setVar("project", n, parseInput((e.target as HTMLInputElement).value))}
            />
            <span class="muted">{unitOf(n)}</span>
          </span>
          <span class="pill {own(n) === '' ? 'factory' : 'project'}">{t(own(n) === "" ? "ui.inherit" : "layer.project")}</span>
        {/each}
      </div>
      <p class="muted small">{t("ui.bom.hint")}</p>
    </div>
  {/if}
</section>

<style>
  .bv { display: flex; flex-direction: column; min-height: 460px; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); align-items: center; }
  .bar [role="group"] { display: flex; gap: 4px; }
  .sp { flex: 1; }
  .note { margin: 6px 10px 0; font-size: 12px; }
  .body { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  h2 { margin: 10px 0 0; }
  th.n { text-align: right; }
  td.wrap { white-space: normal; min-width: 16em; }
  .totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .totals div { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; min-width: 0; }
  .totals .mono { font-size: 16px; }
  .totals .all { background: var(--accent-soft); border-color: transparent; }
  .totals .all .label, .totals .all .mono { color: var(--accent-fg); }
  .warn { margin: 0; padding: 6px 10px; border-radius: 6px; background: var(--warn-soft); color: var(--warn); font-size: 12px; }
  .settings { display: grid; grid-template-columns: max-content minmax(0, 9em) max-content; gap: 6px 10px; align-items: center; }
  .field { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .field input { width: 100%; min-width: 0; }
  .small { margin: 4px 0 0; font-size: 12px; }
  @media (max-width: 700px) {
    .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .settings { grid-template-columns: minmax(0, 1fr) minmax(0, 7em) max-content; }
  }
</style>
