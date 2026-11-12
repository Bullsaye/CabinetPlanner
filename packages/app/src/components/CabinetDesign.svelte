<script lang="ts">
  import { FACTORY_TEMPLATES, localName } from "@cabinet-planner/engine";
  import { openConstruction, parseInput, setKind, store } from "../lib/store.svelte.ts";
  import FrontBuilder from "./FrontBuilder.svelte";
  import OptRow from "./fields/OptRow.svelte";
  import ParamRow from "./fields/ParamRow.svelte";
  import VarRow from "./fields/VarRow.svelte";

  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const kind = $derived((c?.kind ?? "base") as "base" | "wall" | "tall");
  /** Parameters in effect: from presets of every layer and the cabinet's own (D59). */
  const params = $derived(store.cabinet?.resolved.params ?? c?.params ?? []);
  /** Height as a formula under the (sloped) ceiling: the lowest point over the carcase minus base and gap. */
  function fitToCeiling(): void {
    if (!c) return;
    c.vars = { ...(c.vars ?? {}), H: kind === "wall" ? "ceiling_h - wall_bottom - ceiling_gap" : "ceiling_h - plinth_h - ceiling_gap" };
  }
  /** Extra fixed shelves of the cabinet (construction.panels, D38), edited here too (D71). */
  const fixedPanels = $derived((c?.construction?.panels ?? []) as { y: number | string }[]);
  /** Adds a fixed shelf in the middle of the tallest compartment between the lying carcase panels. */
  function addFixedPanel(): void {
    if (!c) return;
    const v = (n: string): number => store.cabinet?.resolved.values.get(n) ?? 0;
    const t0 = v("t_carcase");
    const lying = (store.cabinet?.parts ?? [])
      .filter((p) => ["bottom", "top", "rail_front", "rail_rear", "fixed_shelf"].includes(p.role) && p.box.dy <= t0 + 0.01)
      .map((p) => [p.box.y, p.box.y + p.box.dy] as const)
      .sort((a, b) => a[0] - b[0]);
    let best: [number, number] = [t0, v("H") - t0];
    let size = 0;
    for (let k = 0; k + 1 < lying.length; k++) {
      const gap = lying[k + 1]![0] - lying[k]![1];
      if (gap > size) [size, best] = [gap, [lying[k]![1], lying[k + 1]![0]]];
    }
    c.construction ??= {};
    c.construction.panels ??= [];
    c.construction.panels.push({ y: Math.round((best[0] + best[1] - t0) / 2) });
  }
  function setPanelY(k: number, text: string): void {
    const val = parseInput(text);
    if (val !== undefined && c?.construction?.panels?.[k]) c.construction.panels[k].y = val;
  }
  /** Sloped corner down to the ceiling over that side (D47): H stays, the corner drops. */
  function fitSlope(side: "left" | "right" | "rear"): void {
    if (!c) return;
    const base = kind === "wall" ? "wall_bottom" : "plinth_h";
    c.vars = { ...(c.vars ?? {}), [`slope_${side}_drop`]: `max(0, H + ${base} - ceiling_h + ceiling_gap)` };
  }
  const template = $derived.by(() => {
    const id = c?.template;
    if (!id) return undefined;
    const tpl = (store.built.shop?.library.templates ?? []).find((x) => x.id === id) ?? FACTORY_TEMPLATES.find((x) => x.id === id);
    return tpl ? localName(tpl.name, store.ui.lang) : id;
  });
</script>

{#if !c}
  <p class="muted pad">{t("ui.select_cabinet")}</p>
{:else}
  <div class="design">
    <div class="head">
      <input id="cab-name" class="name" type="text" bind:value={c.name} placeholder={`${c.id} · ${t(`ui.kind.${kind}`)}`} aria-label={t("ui.name")} />
      <div class="seg" role="group" aria-label={t("ui.kind")}>
        {#each ["base", "wall", "tall"] as k}
          <button aria-pressed={kind === k} onclick={() => setKind(k as "base")}>{t(`ui.kind.${k}`)}</button>
        {/each}
      </div>
      {#if template}<p class="muted small">{t("ui.from_template", { name: template })}</p>{/if}
    </div>

    <section>
      <h3 class="label">{t("ui.size")}</h3>
      <VarRow name="W" steppers />
      <VarRow name="H" steppers />
      <VarRow name="D" steppers />
      <VarRow name="t_carcase" label={t("ui.material_thickness")} />
      <button class="quiet link" onclick={fitToCeiling} title={t("ui.fit_to_ceiling_hint")}>{t("ui.fit_to_ceiling")}</button>
      <p class="muted small">{t("ui.value.formula_hint")}</p>
    </section>

    {#if params.length}
      <section>
        <h3 class="label">{t("ui.params")}</h3>
        {#each params as p (p.name)}<ParamRow param={p} />{/each}
      </section>
    {/if}

    {#if kind !== "base"}
      <section>
        <h3 class="label">{t("ui.slope")}</h3>
        <VarRow name="slope_right_drop" />
        <VarRow name="slope_right_angle" />
        <VarRow name="slope_left_drop" />
        <VarRow name="slope_left_angle" />
        <VarRow name="slope_rear_drop" />
        <VarRow name="slope_rear_angle" />
        <OptRow key="slope_fronts" />
        <div class="links">
          <button class="quiet link" onclick={() => fitSlope("right")} title={t("ui.fit_slope_hint")}>{t("ui.fit_slope_right")}</button>
          <button class="quiet link" onclick={() => fitSlope("left")} title={t("ui.fit_slope_hint")}>{t("ui.fit_slope_left")}</button>
          <button class="quiet link" onclick={() => fitSlope("rear")} title={t("ui.fit_slope_hint")}>{t("ui.fit_slope_rear")}</button>
        </div>
      </section>
    {/if}

    <section>
      <h3 class="label">{t("ui.fronts")}</h3>
      <FrontBuilder />
    </section>

    <section>
      <h3 class="label">{t("ui.surfaces")}</h3>
      <OptRow key="surface.carcase" />
      <OptRow key="surface.front" />
      <OptRow key="surface.visible_side" />
      <p class="muted small">{t("ui.surfaces_hint")}</p>
    </section>

    <section>
      <h3 class="label">{t("ui.gaps")}</h3>
      <VarRow name="front_gap" label={t("ui.gap_horizontal")} />
      <VarRow name="front_gap_v" label={t("ui.gap_vertical")} />
      <details>
        <summary class="small">{t("ui.more_gaps")}</summary>
        <VarRow name="front_gap_top" />
        <VarRow name="front_gap_bottom" />
        <VarRow name="front_gap_left" />
        <VarRow name="front_gap_right" />
        <VarRow name="front_gap_middle" />
      </details>
    </section>

    <section>
      <h3 class="label">{t("ui.handles")}</h3>
      <OptRow key="hardware.handle" label={t("ui.handle")} />
      <OptRow key="handle.door" />
      <OptRow key="handle.drawer" />
      <details>
        <summary class="small">{t("ui.handle_position")}</summary>
        <OptRow key="handle.door_y" />
        <VarRow name="handle_height" />
        <VarRow name="handle_edge_offset" />
        <VarRow name="handle_end_offset" />
        <VarRow name="handle_drawer_top" />
      </details>
    </section>

    <section>
      <h3 class="label">{kind === "wall" ? t("ui.hanging") : t("ui.plinth")}</h3>
      {#if kind === "wall"}
        <VarRow name="wall_bottom" />
      {:else}
        <VarRow name="plinth_h" steppers />
        <OptRow key="hardware.leg" />
      {/if}
    </section>

    <section>
      <h3 class="label">{t("ui.ceiling")}</h3>
      <OptRow key="ceiling_filler" />
      {#if store.cabinet?.resolved.options.get("ceiling_filler")?.value === "front"}
        <VarRow name="ceiling_filler_gap" />
      {/if}
      <VarRow name="ceiling_gap" />
    </section>

    <section>
      <h3 class="label">{t("ui.shelves")}</h3>
      <VarRow name="shelf_count" steppers />
      {#if kind === "tall"}<OptRow key="interior" /><OptRow key="hat_shelf" />{/if}
      <OptRow key="open_shelf" />
      {#if store.cabinet?.resolved.options.get("open_shelf")?.value === "reveal"}<VarRow name="open_shelf_reveal" />{/if}
      {#if c.sections?.length || (store.cabinet?.resolved.values.get("partition_count") ?? 0) > 0}<OptRow key="partition_joint" />{/if}
      {#each fixedPanels as p, k}
        <div class="fixed-panel">
          <label for={`fixed-panel-${k}`}>{t("ui.fixed_panel")} {k + 1}</label>
          <input id={`fixed-panel-${k}`} class="mono" type="text" inputmode="decimal" value={p.y} title={t("ui.fixed_panel_y")} aria-label={t("ui.fixed_panel_y")} onchange={(e) => setPanelY(k, (e.target as HTMLInputElement).value)} />
          <button class="quiet" aria-label={`${t("ui.delete")}: ${t("ui.fixed_panel")} ${k + 1}`} onclick={() => c.construction.panels.splice(k, 1)}>×</button>
        </div>
      {/each}
      {#if fixedPanels.length}<p class="muted small">{t("ui.fixed_panels_hint")}</p>{/if}
      <button class="quiet link" onclick={addFixedPanel}>{t("ui.add_fixed_panel")}</button>
    </section>

    <button class="primary construct" onclick={openConstruction}>{t("ui.open_construction")}</button>
  </div>
{/if}

<style>
  .design { display: flex; flex-direction: column; gap: 12px; }
  .head { display: flex; flex-direction: column; gap: 6px; }
  .name { font-weight: 600; font-size: 14px; }
  .seg { display: flex; }
  .seg button { flex: 1; min-width: 0; padding-left: 4px; padding-right: 4px; border-radius: 0; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; }
  section { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  h3 { margin: 0 0 2px; }
  details summary { cursor: pointer; color: var(--accent-fg); padding: 2px 0; }
  details[open] { display: flex; flex-direction: column; gap: 4px; }
  .small { font-size: 12px; margin: 0; }
  .construct { margin-top: 4px; }
  .links { display: flex; flex-wrap: wrap; gap: 4px; }
  .link { align-self: flex-start; color: var(--accent-fg); font-size: 12px; padding: 2px 4px; }
  .pad { padding: 12px; }
  .fixed-panel { display: grid; grid-template-columns: 1fr 96px auto; gap: 4px; align-items: center; }
  .fixed-panel input { width: 100%; }
</style>
