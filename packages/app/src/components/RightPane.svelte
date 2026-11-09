<script lang="ts">
  import { FACTORY_PRESETS } from "@cabinet-planner/engine";
  import { store } from "../lib/store.svelte.ts";
  import CabinetDesign from "./CabinetDesign.svelte";
  import ConstructionEditor from "./ConstructionEditor.svelte";
  import Inspector from "./Inspector.svelte";

  const t = $derived(store.tr.t);
  const editing = $derived(store.ui.construction !== null && store.ui.construction === store.ui.selected);
  const c = $derived(store.cabinetDoc);
  const allPresets = $derived([...FACTORY_PRESETS, ...(store.built.shop?.library.presets ?? []), ...(store.result?.project.library.presets ?? [])]);
</script>

<section class="panel rp">
  {#if !editing}
    <div class="tabs" role="tablist" aria-label={t("ui.edit_layer")}>
      {#each ["cabinet", "project", "shop"] as p}
        <button role="tab" aria-selected={store.ui.pane === p} aria-pressed={store.ui.pane === p} onclick={() => (store.ui.pane = p as "cabinet")}>
          {p === "cabinet" && store.ui.selected ? store.ui.selected : t(`ui.layer.${p}`)}
        </button>
      {/each}
    </div>
  {/if}
  {#if store.ui.pane === "cabinet" || editing}
    {#if editing}
      <ConstructionEditor />
    {:else}
      <CabinetDesign />
      {#if c}
        <details class="presets">
          <summary class="label">{t("ui.presets")}</summary>
          <div class="chips">
            {#each c.presets ?? [] as p, i}
              <span class="chip">{store.presetName(p)}<button class="quiet x" aria-label={`${t("ui.remove")} ${store.presetName(p)}`} onclick={() => c.presets.splice(i, 1)}>×</button></span>
            {/each}
            <select id="add-preset" aria-label={t("ui.add_preset")} onchange={(e) => { const s = e.target as HTMLSelectElement; if (s.value) { c.presets = [...(c.presets ?? []), s.value]; s.value = ""; } }}>
              <option value="">+ {t("ui.add_preset")}</option>
              {#each allPresets.filter((p) => !(c.presets ?? []).includes(p.id)) as p}<option value={p.id}>{store.presetName(p.id)}</option>{/each}
            </select>
          </div>
        </details>
      {/if}
    {/if}
  {:else}
    <Inspector layer={store.ui.pane} />
  {/if}
</section>

<style>
  .rp { padding: 12px; display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 90px); overflow: auto; }
  .tabs { display: flex; gap: 4px; }
  .tabs button { flex: 1; }
  .presets { border-top: 1px solid var(--line); padding-top: 6px; }
  summary { cursor: pointer; padding: 4px 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 2px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px; padding: 0 2px 0 8px; font-size: 12px; }
  .chip .x { padding: 0 6px; min-height: 0; }
  #add-preset { max-width: 12em; font-size: 12px; }
  @media (max-width: 1100px) { .rp { max-height: none; } }
</style>
