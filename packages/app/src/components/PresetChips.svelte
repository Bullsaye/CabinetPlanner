<script lang="ts">
  import { FACTORY_PRESETS } from "@cabinet-planner/engine";
  import { store, type Layer } from "../lib/store.svelte.ts";

  /** Presets applied in a layer (cabinet, project or shop defaults), in order; later ones win. */
  let { layer = "cabinet" }: { layer?: Layer } = $props();
  const t = $derived(store.tr.t);
  const doc = $derived(store.layerDoc(layer));
  const all = $derived([...FACTORY_PRESETS, ...(store.built.shop?.library.presets ?? []), ...(store.result?.project.library.presets ?? [])]);
  const applied = $derived((doc?.presets ?? []) as string[]);
  const free = $derived(all.filter((p, i) => !applied.includes(p.id) && all.findIndex((x) => x.id === p.id) === i));
  function add(e: Event): void {
    const s = e.target as HTMLSelectElement;
    if (s.value && doc) doc.presets = [...applied, s.value];
    s.value = "";
  }
</script>

{#if doc}
  <div class="chips">
    {#each applied as p, i}
      <span class="chip">{store.presetName(p)}<button class="quiet x" aria-label={`${t("ui.remove")} ${store.presetName(p)}`} onclick={() => doc.presets.splice(i, 1)}>×</button></span>
    {/each}
    <select aria-label={t("ui.add_preset")} onchange={add}>
      <option value="">+ {t("ui.add_preset")}</option>
      {#each free as p}<option value={p.id}>{store.presetName(p.id)}</option>{/each}
    </select>
  </div>
{/if}

<style>
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 2px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px; padding: 0 2px 0 8px; font-size: 12px; }
  .x { padding: 0 6px; }
  select { max-width: 12em; font-size: 12px; }
</style>
