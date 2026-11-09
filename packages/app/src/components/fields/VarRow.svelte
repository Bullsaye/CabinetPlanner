<script lang="ts">
  import { formatNumber, VARIABLE_BY_NAME } from "@cabinet-planner/engine";
  import { parseInput, setVar, store, type Layer } from "../../lib/store.svelte.ts";
  import { stepVar } from "../../lib/fields.ts";

  let { name, layer = "cabinet", label, steppers = false }: { name: string; layer?: Layer; label?: string; steppers?: boolean } = $props();
  const t = $derived(store.tr.t);
  const doc = $derived(store.layerDoc(layer));
  const rv = $derived(store.cabinet?.resolved.vars.get(name));
  const def = $derived(VARIABLE_BY_NAME.get(name));
  const own = $derived(doc?.vars?.[name] === undefined ? "" : String(doc.vars[name]));
  const step = $derived(def?.step ?? 1);
  const show = (x: number | undefined): string => (x === undefined ? "?" : formatNumber(x));
</script>

<div class="var" class:stepped={steppers}>
  <label for={`v-${layer}-${name}`} title={t(`var.${name}.hint`)}>{label ?? t(`var.${name}`)}</label>
  <span class="field">
    {#if steppers || def?.quick}
      <button class="step" class:always={steppers} tabindex="-1" aria-label={`${t(`var.${name}`)} −`} onclick={() => stepVar(layer, name, -step, rv?.value)}>−</button>
    {/if}
    <input
      id={`v-${layer}-${name}`}
      class="mono"
      type="text"
      inputmode="decimal"
      value={own}
      placeholder={rv ? String(rv.input) : ""}
      onchange={(e) => setVar(layer, name, parseInput((e.target as HTMLInputElement).value))}
    />
    {#if steppers || def?.quick}
      <button class="step" class:always={steppers} tabindex="-1" aria-label={`${t(`var.${name}`)} +`} onclick={() => stepVar(layer, name, step, rv?.value)}>+</button>
    {/if}
  </span>
  <span class="val mono" title={rv && typeof rv.input === "string" ? rv.input : ""}>{show(rv?.value)}</span>
  {#if rv}<span class="pill {rv.source.layer}" title={t(`layer.${rv.source.layer}`)}>{rv.source.preset ? store.presetName(rv.source.preset) : t(`layer.${rv.source.layer}`)}</span>{:else}<span></span>{/if}
  {#if own !== ""}
    <button class="quiet reset" title={t("ui.reset")} aria-label={t("ui.reset")} onclick={() => setVar(layer, name, undefined)}>↺</button>
  {:else}<span></span>{/if}
</div>

<style>
  .var { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) 46px auto 22px; gap: 6px; align-items: center; }
  .var.stepped { grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) 46px auto 22px; }
  label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .field { display: flex; min-width: 0; gap: 2px; }
  .field input { flex: 1; min-width: 0; width: 100%; }
  .step { display: none; padding: 0 8px; }
  .step.always { display: inline-block; }
  @media (pointer: coarse) {
    .step { display: inline-block; }
    .var { grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) 46px auto 28px; }
  }
  .val { text-align: right; font-size: 12px; }
  .reset { padding: 0 4px; }
</style>
