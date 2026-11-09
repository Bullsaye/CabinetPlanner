<script lang="ts">
  import { formatNumber, localName, VARIABLE_BY_NAME } from "@cabinet-planner/engine";
  import { parseInput, setVar, store } from "../../lib/store.svelte.ts";

  /** A cabinet parameter (D45) in the simple editor: label, steppers, value or formula. */
  let { param }: { param: Record<string, any> } = $props();
  const t = $derived(store.tr.t);
  const name = $derived(param.name as string);
  const doc = $derived(store.cabinetDoc);
  const rv = $derived(store.cabinet?.resolved.vars.get(name));
  const def = $derived(VARIABLE_BY_NAME.get(name));
  const own = $derived(doc?.vars?.[name] === undefined ? "" : String(doc.vars[name]));
  const step = $derived((param.step ?? def?.step ?? (param.unit === "count" ? 1 : 10)) as number);
  const label = $derived(param.label ? localName(param.label, store.ui.lang) : def ? t(`var.${name}`) : name);
  const show = (x: number | undefined): string => (x === undefined ? "?" : formatNumber(x));
  function stepBy(by: number): void {
    let next = (rv?.value ?? 0) + by;
    const min = param.min ?? def?.min;
    const max = param.max ?? def?.max;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setVar("cabinet", name, Math.round(next * 100) / 100);
  }
</script>

<div class="var">
  <label for={`p-${name}`} title={name}>{label}</label>
  <span class="field">
    <button class="step" tabindex="-1" aria-label={`${label} −`} onclick={() => stepBy(-step)}>−</button>
    <input
      id={`p-${name}`}
      class="mono"
      type="text"
      inputmode="decimal"
      value={own}
      placeholder={rv ? String(rv.input) : ""}
      onchange={(e) => setVar("cabinet", name, parseInput((e.target as HTMLInputElement).value))}
    />
    <button class="step" tabindex="-1" aria-label={`${label} +`} onclick={() => stepBy(step)}>+</button>
  </span>
  <span class="val mono" title={rv && typeof rv.input === "string" ? rv.input : ""}>{show(rv?.value)}</span>
  {#if own !== ""}
    <button class="quiet reset" title={t("ui.reset")} aria-label={t("ui.reset")} onclick={() => setVar("cabinet", name, undefined)}>↺</button>
  {:else}<span></span>{/if}
</div>

<style>
  .var { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) 46px 22px; gap: 6px; align-items: center; }
  label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .field { display: flex; min-width: 0; gap: 2px; }
  .field input { flex: 1; min-width: 0; width: 100%; }
  .step { padding: 0 8px; }
  .val { text-align: right; font-size: 12px; }
  .reset { padding: 0 4px; }
</style>
