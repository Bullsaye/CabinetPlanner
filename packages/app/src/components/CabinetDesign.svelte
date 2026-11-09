<script lang="ts">
  import { FACTORY_TEMPLATES, localName } from "@cabinet-planner/engine";
  import { openConstruction, setKind, store } from "../lib/store.svelte.ts";
  import FrontBuilder from "./FrontBuilder.svelte";
  import OptRow from "./fields/OptRow.svelte";
  import VarRow from "./fields/VarRow.svelte";

  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const kind = $derived((c?.kind ?? "base") as "base" | "wall" | "tall");
  /** Height as a formula under the (sloped) ceiling: the lowest point over the carcase minus base and gap. */
  function fitToCeiling(): void {
    if (!c) return;
    c.vars = { ...(c.vars ?? {}), H: kind === "wall" ? "ceiling_h - wall_bottom - ceiling_gap" : "ceiling_h - plinth_h - ceiling_gap" };
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
    </section>

    <section>
      <h3 class="label">{t("ui.fronts")}</h3>
      <FrontBuilder />
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
    </section>

    <section>
      <h3 class="label">{kind === "wall" ? t("ui.hanging") : t("ui.plinth")}</h3>
      {#if kind === "wall"}
        <VarRow name="wall_bottom" />
      {:else}
        <VarRow name="plinth_h" steppers />
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
      {#if kind === "tall"}<OptRow key="interior" />{/if}
    </section>

    <button class="primary construct" onclick={openConstruction}>{t("ui.open_construction")}</button>
  </div>
{/if}

<style>
  .design { display: flex; flex-direction: column; gap: 12px; }
  .head { display: flex; flex-direction: column; gap: 6px; }
  .name { font-weight: 600; font-size: 14px; }
  .seg { display: flex; }
  .seg button { flex: 1; border-radius: 0; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; }
  section { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  h3 { margin: 0 0 2px; }
  details summary { cursor: pointer; color: var(--accent-fg); padding: 2px 0; }
  details[open] { display: flex; flex-direction: column; gap: 4px; }
  .small { font-size: 12px; margin: 0; }
  .construct { margin-top: 4px; }
  .link { align-self: flex-start; color: var(--accent-fg); font-size: 12px; padding: 2px 4px; }
  .pad { padding: 12px; }
</style>
