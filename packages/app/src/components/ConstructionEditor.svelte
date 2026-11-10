<script lang="ts">
  import { formatNumber } from "@cabinet-planner/engine";
  import {
    closeConstruction,
    constructionChanged,
    discardConstruction,
    parseInput,
    saveCabinetTemplate,
    store,
    templateName,
  } from "../lib/store.svelte.ts";
  import FreeConstruction from "./FreeConstruction.svelte";
  import Inspector from "./Inspector.svelte";
  import OptRow from "./fields/OptRow.svelte";
  import VarRow from "./fields/VarRow.svelte";

  type Doc = Record<string, any>;
  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const cab = $derived(store.cabinet);
  const kind = $derived((c?.kind ?? "base") as string);
  const zones = $derived(cab?.layout?.zones ?? []);
  const hasType = (ty: string): boolean => zones.some((z) => z.type === ty);
  /** Rails under the top: chosen directly, or by top.base_unit for base units. */
  const usesRails = $derived.by(() => {
    const top = cab?.resolved.options.get("top")?.value;
    return top === "rails" || (top === "auto" && kind === "base" && cab?.resolved.options.get("top.base_unit")?.value === "rails");
  });
  const fmt = (x: number | null | undefined): string => (x === null || x === undefined ? "–" : formatNumber(x));

  /** The cabinet's construction block, created on demand. */
  function cons(): Doc {
    c!.construction ??= {};
    const k = c!.construction;
    k.panels ??= [];
    k.fixed ??= {};
    k.noBack ??= [];
    return k;
  }
  const fixedOf = (i: number): Doc | undefined => c?.construction?.fixed?.[String(i + 1)];
  function setFixed(i: number, patch: Doc): void {
    const f = cons().fixed;
    const key = String(i + 1);
    f[key] = { ...(f[key] ?? {}), ...patch };
  }
  function setNum(target: Doc, key: string, text: string): void {
    const v = parseInput(text);
    if (v === undefined) delete target[key];
    else target[key] = v;
  }
  const noBack = (i: number): boolean => (c?.construction?.noBack ?? []).includes(i + 1);
  function toggleBack(i: number, keep: boolean): void {
    const k = cons();
    k.noBack = keep ? k.noBack.filter((z: number) => z !== i + 1) : [...k.noBack, i + 1].sort();
  }

  // --- Leaving: keep for this cabinet, save to the template (asked twice), or as a new template.
  let leaving = $state(false);
  let confirmStep = $state(0);
  let newName = $state("");
  let saved = $state("");
  const tplName = $derived(templateName(c?.template));

  function done(): void {
    if (!constructionChanged()) {
      closeConstruction();
      return;
    }
    leaving = true;
    confirmStep = 0;
    newName = tplName ? `${tplName} ${t("ui.copy_suffix")}` : (c?.name ?? "");
  }
  function overwrite(): void {
    if (confirmStep < 2) {
      confirmStep++;
      return;
    }
    saveCabinetTemplate({ id: c!.template, name: tplName ?? c!.template });
    saved = t("ui.template_overwritten", { name: tplName ?? "" });
    leaving = false;
    closeConstruction();
  }
  function saveNew(): void {
    if (!newName.trim()) return;
    saveCabinetTemplate({ name: newName.trim() });
    leaving = false;
    closeConstruction();
  }
</script>

{#if c}
  <div class="ce">
    <div class="top">
      <div>
        <h2>{t("ui.construction")}</h2>
        <p class="muted small">{c.name || c.id}{tplName ? ` · ${t("ui.from_template", { name: tplName })}` : ""}</p>
      </div>
      <button class="primary" onclick={done}>{t("ui.done")}</button>
    </div>

    {#if leaving}
      <div class="dialog panel" role="dialog" aria-modal="true" aria-labelledby="leave-title">
        <h3 id="leave-title">{t("ui.leave_construction")}</h3>
        <p class="small muted">{t("ui.leave_construction_hint")}</p>
        {#if confirmStep === 0}
          <button class="primary" onclick={() => { leaving = false; closeConstruction(); }}>{t("ui.keep_this_cabinet")}</button>
          {#if c.template}
            <button onclick={overwrite}>{t("ui.save_to_template", { name: tplName ?? c.template })}</button>
          {/if}
          <div class="new">
            <input type="text" aria-label={t("ui.template_name")} bind:value={newName} />
            <button onclick={saveNew} disabled={!newName.trim()}>{t("ui.save_as_new_template")}</button>
          </div>
          <div class="row">
            <button class="quiet" onclick={() => { leaving = false; discardConstruction(); }}>{t("ui.discard_changes")}</button>
            <button class="quiet" onclick={() => (leaving = false)}>{t("ui.keep_editing")}</button>
          </div>
        {:else}
          <p class="warn" role="alert">{confirmStep === 1 ? t("ui.overwrite_confirm_1", { name: tplName ?? "" }) : t("ui.overwrite_confirm_2", { name: tplName ?? "" })}</p>
          <div class="row">
            <button class="danger-btn" onclick={overwrite}>{confirmStep === 1 ? t("ui.overwrite") : t("ui.overwrite_really")}</button>
            <button onclick={() => (confirmStep = 0)}>{t("ui.cancel")}</button>
          </div>
        {/if}
      </div>
    {/if}
    {#if saved}<p class="small muted" role="status">{saved}</p>{/if}

    <p class="muted small">{t("ui.construction_hint")} {t("ui.value.formula_hint")}</p>

    <section>
      <h3 class="label">{t("ui.carcase")}</h3>
      <OptRow key="material.carcase" />
      <VarRow name="t_carcase" />
      <OptRow key="carcase_joint" />
      <OptRow key="edge.carcase" />
    </section>

    <section>
      <h3 class="label">{t("ui.top_and_bottom")}</h3>
      <OptRow key="top" />
      {#if kind === "base"}<OptRow key="top.base_unit" />{/if}
      {#if usesRails}
        <OptRow key="rail.front" />
        <OptRow key="rail.rear" />
        <VarRow name="rail_w" />
      {/if}
      <VarRow name="bottom_setback_rear" />
      <VarRow name="bottom_setback_front" />
      <OptRow key="rail.bottom" />
      {#if cab?.resolved.options.get("rail.bottom")?.value !== "none"}<VarRow name="rail_bottom_w" />{/if}
    </section>

    <section>
      <h3 class="label">{t("ui.back")}</h3>
      <OptRow key="back_mount" />
      <OptRow key="back_extent" />
      <OptRow key="material.back" />
      <VarRow name="back_groove_offset" />
      <VarRow name="back_groove_depth" />
    </section>

    <section>
      <h3 class="label">{t("ui.shelves_and_panels")}</h3>
      <OptRow key="material.shelf" />
      <VarRow name="shelf_front_setback" />
      <VarRow name="shelf_back_gap" />
      <p class="muted small">{t("ui.panels_hint")}</p>
      <div class="scroll-x">
      <table class="grid zones">
        <thead><tr><th>{t("ui.zone")}</th><th>{t("ui.back")}</th><th>{t("ui.panel_below")}</th><th>{t("ui.setback_front")}</th><th>{t("ui.setback_rear")}</th></tr></thead>
        <tbody>
          {#each zones as z, i}
            {@const f = fixedOf(i)}
            <tr>
              <td>{i + 1} · {t(`ui.zone.${z.type}`)} <span class="muted mono">{fmt(z.y1 - z.y0)}</span></td>
              <td><input type="checkbox" aria-label={`${t("ui.back")} ${i + 1}`} checked={!noBack(i)} onchange={(e) => toggleBack(i, (e.target as HTMLInputElement).checked)} /></td>
              {#if z.fixedBelow !== null && i < zones.length - 1}
                <td><input type="checkbox" aria-label={`${t("ui.panel_below")} ${i + 1}`} checked={f?.panel ?? true} onchange={(e) => setFixed(i, { panel: (e.target as HTMLInputElement).checked })} /></td>
                <td><input class="mono num" type="text" aria-label={t("ui.setback_front")} value={f?.setbackFront ?? ""} placeholder="0" onchange={(e) => { setFixed(i, {}); setNum(cons().fixed[String(i + 1)], "setbackFront", (e.target as HTMLInputElement).value); }} /></td>
                <td><input class="mono num" type="text" aria-label={t("ui.setback_rear")} value={f?.setbackRear ?? ""} placeholder="0" onchange={(e) => { setFixed(i, {}); setNum(cons().fixed[String(i + 1)], "setbackRear", (e.target as HTMLInputElement).value); }} /></td>
              {:else}
                <td colspan="3" class="muted">–</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
      <h4 class="label">{t("ui.extra_panels")}</h4>
      {#each c.construction?.panels ?? [] as p, k}
        <div class="panelrow">
          <input class="mono" type="text" aria-label={t("ui.panel_height")} value={p.y} onchange={(e) => setNum(p, "y", (e.target as HTMLInputElement).value)} />
          <input class="mono" type="text" aria-label={t("ui.setback_front")} placeholder="0" value={p.setbackFront ?? ""} onchange={(e) => setNum(p, "setbackFront", (e.target as HTMLInputElement).value)} />
          <input class="mono" type="text" aria-label={t("ui.setback_rear")} placeholder="0" value={p.setbackRear ?? ""} onchange={(e) => setNum(p, "setbackRear", (e.target as HTMLInputElement).value)} />
          <button class="quiet" aria-label={t("ui.delete")} onclick={() => cons().panels.splice(k, 1)}>×</button>
        </div>
      {/each}
      {#if (c.construction?.panels ?? []).length}
        <p class="muted small">{t("ui.extra_panels_cols")}</p>
      {/if}
      <button onclick={() => cons().panels.push({ y: Math.round((cab?.resolved.values.get("H") ?? 720) / 2) })}>{t("ui.add_panel")}</button>
    </section>

    <section>
      <h3 class="label">{t("ui.fronts_construction")}</h3>
      <OptRow key="material.front" />
      <OptRow key="edge.front" />
      {#if hasType("drawer")}<OptRow key="drawer_front.fixing" />{/if}
      <OptRow key="corner" />
      {#if cab?.resolved.options.get("corner")?.value !== "none"}<VarRow name="blind_w" />{/if}
    </section>

    <section>
      <h3 class="label">{t("ui.joints")}</h3>
      <OptRow key="joint_method" />
      <OptRow key="hardware.fastener" />
      <OptRow key="hardware.connector" label={t("ui.dowel")} />
      <OptRow key="dowel_pattern" />
      <VarRow name="dowel_offset_front" />
      <VarRow name="dowel_second" />
      <VarRow name="dowel_raster" />
      <VarRow name="dowel_offset_rear" />
      <OptRow key="joint_screws" />
      {#if cab?.resolved.options.get("joint_screws")?.value !== "none"}
        <OptRow key="hardware.joint_screw" />
        <VarRow name="joint_screw_every" />
      {/if}
    </section>

    <section>
      <h3 class="label">{t("ui.fittings")}</h3>
      {#if hasType("door")}<OptRow key="hardware.hinge" />{/if}
      {#if hasType("drawer")}<OptRow key="hardware.slide" />{/if}
      {#if hasType("flap")}<OptRow key="hardware.flap" />{/if}
      <OptRow key="hardware.shelf_support" />
      {#if kind === "wall"}<OptRow key="hardware.hanger" />{:else}<OptRow key="hardware.leg" />{/if}
      {#if kind === "tall"}<OptRow key="hardware.rail" />{/if}
    </section>

    <FreeConstruction />

    <details>
      <summary class="label">{t("ui.in_room")}</summary>
      <div class="rows">
        <p class="muted small">{t("ui.in_room_hint")}</p>
        <OptRow key="side.left" />
        <OptRow key="side.right" />
        <OptRow key="cabinet_link" />
        {#if cab?.resolved.options.get("cabinet_link")?.value !== "none"}<OptRow key="hardware.link" />{/if}
        <OptRow key="ceiling_filler" />
        <VarRow name="ceiling_gap" />
        {#if kind === "base"}<OptRow key="worktop_cutout" />{/if}
      </div>
    </details>

    <details>
      <summary class="label">{t("ui.all_settings")}</summary>
      <Inspector layer="cabinet" />
    </details>
  </div>
{/if}

<style>
  .ce { display: flex; flex-direction: column; gap: 12px; position: relative; }
  .top { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
  h2 { margin: 0; font-size: 16px; }
  /* The wide editor has room for preset names as origin. */
  @media (min-width: 1101px) { .ce :global(.vrow) { grid-template-columns: minmax(0, .85fr) minmax(0, 1.25fr) 112px; } }
  h3, h4 { margin: 0 0 2px; }
  section { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  .small { font-size: 12px; margin: 0; }
  .zones td input.num { width: 4.5em; }
  .zones td, .zones th { padding: 4px 6px; }
  .zones th { white-space: normal; position: static; vertical-align: bottom; }
  .rows { display: flex; flex-direction: column; gap: 4px; padding: 4px 0 6px; }
  .panelrow { display: grid; grid-template-columns: 1.6fr 1fr 1fr auto; gap: 4px; }
  .panelrow input { width: 100%; min-width: 0; }
  details { border-top: 1px solid var(--line); padding-top: 6px; }
  summary { cursor: pointer; padding: 4px 0; }
  .dialog { position: sticky; top: 0; z-index: 5; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / .18); border-color: var(--accent); }
  .dialog h3 { font-size: 14px; }
  .new { display: flex; gap: 6px; }
  .new input { flex: 1; min-width: 0; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
  .warn { color: var(--warn); background: var(--warn-soft); padding: 8px; border-radius: 6px; margin: 0; }
  .danger-btn { background: var(--err); border-color: var(--err); color: #fff; }
</style>
