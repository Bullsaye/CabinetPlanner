<script lang="ts">
  import { formatNumber, localName } from "@cabinet-planner/engine";
  import { store } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  const lib = $derived(store.result?.library);
  const totals = $derived.by(() => {
    const m = new Map<string, { qty: number; unit: string; lengths: number[] }>();
    for (const c of store.result?.cabinets ?? []) {
      for (const h of c.hardware) {
        const x = m.get(h.item) ?? { qty: 0, unit: h.unit, lengths: [] };
        x.qty += h.qty;
        x.lengths.push(...(h.lengths ?? []));
        m.set(h.item, x);
      }
    }
    return [...m.entries()];
  });
  const unit = (u: string): string => (store.tr.has(`unit.${u}`) ? t(`unit.${u}`) : u);
</script>

<section class="panel hv">
  <h2 class="label">{t("ui.hardware_needed")}</h2>
  <table class="grid">
    <thead><tr><th>{t("cli.col.qty")}</th><th>{t("cli.col.item")}</th><th>{t("ui.articles")}</th></tr></thead>
    <tbody>
      {#each totals as [id, x]}
        {@const h = lib?.hardware.get(id)}
        <tr>
          <td class="n">{x.qty} {unit(x.unit)}</td>
          <td>
            {h ? localName(h.name, store.tr.locale) : id}
            {#if x.lengths.length}<span class="mono muted"> · {x.lengths.map((l) => formatNumber(l)).join(", ")} mm</span>{/if}
          </td>
          <td class="mono">{h?.articles.map((a) => a.code).join(", ") ?? ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <p class="muted small">{t("ui.hardware_library_moved")}</p>
</section>

<style>
  .hv { padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 460px; }
  h2 { margin: 8px 0 0; }
  .small { margin: 0; font-size: 12px; }
</style>
