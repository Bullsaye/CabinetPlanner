<script lang="ts">
  import { untrack } from "svelte";
  import { store } from "../lib/store.svelte.ts";
  import CabinetDesign from "./CabinetDesign.svelte";
  import ConstructionEditor from "./ConstructionEditor.svelte";
  import Inspector from "./Inspector.svelte";
  import MultiEdit from "./MultiEdit.svelte";
  import PartPanel from "./PartPanel.svelte";
  import PresetChips from "./PresetChips.svelte";

  const t = $derived(store.tr.t);
  const editing = $derived(store.ui.construction !== null && store.ui.construction === store.ui.selected);
  const c = $derived(store.cabinetDoc);
  const multi = $derived(editing ? [] : store.multi);
  /** A picked part shows its own panel (D73), unless the construction editor is open on its parameters. */
  const part = $derived(!store.ui.part || store.ui.partPanel !== store.ui.part || store.ui.partParams === store.ui.part || multi.length ? undefined : store.part);

  // Tablet: the pane is a drawer. A part picked in the room view opens it, or the tap would seem to do nothing.
  let lastPart: string | null = store.ui.partPanel;
  $effect(() => {
    const id = store.ui.partPanel;
    if (id === lastPart) return;
    lastPart = id;
    untrack(() => {
      if (id && store.part && store.narrow && store.ui.tab === "view" && store.viewMode !== "cabinet") store.ui.panel = "inspector";
    });
  });
</script>

<section class="panel rp">
  {#if !editing}
    <div class="tabs" role="tablist" aria-label={t("ui.edit_layer")}>
      {#each ["cabinet", "project", "shop"] as p}
        <button role="tab" aria-selected={store.ui.pane === p} aria-pressed={store.ui.pane === p} onclick={() => (store.ui.pane = p as "cabinet")}>
          {p === "cabinet" && multi.length ? t("ui.multi.tab", { n: multi.length }) : p === "cabinet" && store.ui.selected ? store.ui.selected : t(`ui.layer.${p}`)}
        </button>
      {/each}
    </div>
  {/if}
  {#if store.ui.pane === "cabinet" || editing}
    {#if part}
      {#key part.id}<PartPanel {part} />{/key}
    {:else if editing}
      <ConstructionEditor />
    {:else if multi.length}
      <MultiEdit ids={multi} />
    {:else}
      <CabinetDesign />
      {#if c}
        <details class="presets">
          <summary class="label">{t("ui.presets")}</summary>
          <PresetChips layer="cabinet" />
        </details>
      {/if}
    {/if}
  {:else}
    <div class="presets top">
      <span class="label">{t("ui.presets")}</span>
      <p class="muted small">{t("ui.layer_presets_hint")}</p>
      <PresetChips layer={store.ui.pane} />
    </div>
    <Inspector layer={store.ui.pane} />
  {/if}
</section>

<style>
  .rp { padding: 12px; display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 90px); overflow: auto; }
  .tabs { display: flex; gap: 4px; }
  .tabs button { flex: 1; }
  .presets { border-top: 1px solid var(--line); padding-top: 6px; }
  summary { cursor: pointer; padding: 4px 0; }
  .presets.top { border-top: 0; padding-top: 0; }
  .small { font-size: 12px; margin: 0; }
  @media (max-width: 1100px) { .rp { max-height: none; } }
</style>
