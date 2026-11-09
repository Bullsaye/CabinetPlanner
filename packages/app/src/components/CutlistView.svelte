<script lang="ts">
  import { cutlistCsv, cutlistRows, cutlistTable, localName, type CutlistRow } from "@cabinet-planner/engine";
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
  const table = $derived(
    store.result ? cutlistTable(cutlistRows(parts, store.result.library, { group }), store.result.library, text) : [],
  );
  const NUMERIC = new Set([4, 5, 6, 7, 8, 9]);

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
      <thead><tr>{#each table[0] ?? [] as h}<th>{h}</th>{/each}</tr></thead>
      <tbody>
        {#each table.slice(1) as row}
          <tr>{#each row as cell, i}<td class:n={NUMERIC.has(i)}>{cell}</td>{/each}</tr>
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
  .sum { display: flex; flex-wrap: wrap; gap: 16px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: 12px; }
</style>
