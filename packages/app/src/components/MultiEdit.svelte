<script lang="ts">
  import { store } from "../lib/store.svelte.ts";
  import { frontFittings } from "../lib/partmap.ts";
  import MultiRow from "./fields/MultiRow.svelte";

  /**
   * Several cabinets selected in the list (D73): the rows of the simple
   * editor; a change is written to every selected cabinet.
   */
  let { ids }: { ids: string[] } = $props();
  type Doc = Record<string, any>;
  const t = $derived(store.tr.t);
  const docs = $derived(((store.project.cabinets ?? []) as Doc[]).filter((c) => ids.includes(c.id)));
  const kinds = $derived(new Set(docs.map((c) => (c.kind ?? "base") as string)));
  const zoneTypes = $derived(new Set((store.result?.cabinets ?? []).filter((c) => ids.includes(c.resolved.cabinet.id)).flatMap((c) => [...frontFittings(c.layout)])));
</script>

<div class="me" data-multi-edit>
  <div class="head">
    <h2>{t("ui.multi.title", { n: ids.length })}</h2>
    <p class="mono muted small">{ids.join(" · ")}</p>
    <p class="muted small">{t("ui.multi.hint")}</p>
    <button class="quiet link" onclick={() => store.select(store.ui.selected)}>{t("ui.multi.end")}</button>
  </div>

  <section>
    <h3 class="label">{t("ui.size")}</h3>
    <MultiRow {ids} name="W" />
    <MultiRow {ids} name="H" />
    <MultiRow {ids} name="D" />
    <MultiRow {ids} name="t_carcase" label={t("ui.material_thickness")} />
  </section>

  <section>
    <h3 class="label">{t("ui.gaps")}</h3>
    <MultiRow {ids} name="front_gap" label={t("ui.gap_horizontal")} />
    <MultiRow {ids} name="front_gap_v" label={t("ui.gap_vertical")} />
    <MultiRow {ids} name="front_gap_top" />
    <MultiRow {ids} name="front_gap_bottom" />
    <MultiRow {ids} name="front_gap_left" />
    <MultiRow {ids} name="front_gap_right" />
    <MultiRow {ids} name="front_gap_middle" />
  </section>

  <section>
    <h3 class="label">{t("ui.surfaces")}</h3>
    <MultiRow {ids} kind="option" name="surface.carcase" />
    <MultiRow {ids} kind="option" name="surface.front" />
    <MultiRow {ids} kind="option" name="surface.visible_side" />
  </section>

  <section>
    <h3 class="label">{t("ui.handles")}</h3>
    <MultiRow {ids} kind="option" name="hardware.handle" label={t("ui.handle")} />
    <MultiRow {ids} kind="option" name="handle.door" />
    <MultiRow {ids} kind="option" name="handle.drawer" />
  </section>

  <section>
    <h3 class="label">{t("ui.fittings")}</h3>
    {#if zoneTypes.has("door")}<MultiRow {ids} kind="option" name="hardware.hinge" />{/if}
    {#if zoneTypes.has("drawer")}<MultiRow {ids} kind="option" name="hardware.slide" />{/if}
    {#if zoneTypes.has("flap")}<MultiRow {ids} kind="option" name="hardware.flap" />{/if}
    <MultiRow {ids} kind="option" name="hardware.shelf_support" />
  </section>

  <section>
    <h3 class="label">{t("ui.plinth")} · {t("ui.shelves")}</h3>
    {#if kinds.has("base") || kinds.has("tall")}<MultiRow {ids} name="plinth_h" />{/if}
    {#if kinds.has("wall")}<MultiRow {ids} name="wall_bottom" />{/if}
    <MultiRow {ids} name="shelf_count" />
    <MultiRow {ids} name="ceiling_gap" />
  </section>
</div>

<style>
  .me { display: flex; flex-direction: column; gap: 12px; }
  .head { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  h2 { margin: 0; font-size: 16px; }
  section { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  h3 { margin: 0 0 2px; }
  .small { font-size: 12px; margin: 0; }
  .link { color: var(--accent-fg); font-size: 12px; padding: 2px 4px 2px 0; }
</style>
