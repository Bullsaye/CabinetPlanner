<script lang="ts">
  import { setOption, store, type Layer } from "../../lib/store.svelte.ts";
  import { optionChoices, optionDef } from "../../lib/fields.ts";

  let { key, layer = "cabinet", label }: { key: string; layer?: Layer; label?: string } = $props();
  const t = $derived(store.tr.t);
  const doc = $derived(store.layerDoc(layer));
  const o = $derived(optionDef(key));
  const ro = $derived(store.cabinet?.resolved.options.get(key));
  const own = $derived(doc?.options?.[key] === undefined ? "" : JSON.stringify(doc.options[key]));
  const choices = $derived(o ? optionChoices(o) : []);
</script>

{#if o}
  <div class="var opt">
    <label for={`o-${layer}-${key}`}>{label ?? t(`option.${key}`)}</label>
    <select
      id={`o-${layer}-${key}`}
      value={own}
      onchange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        setOption(layer, key, v === "" ? undefined : JSON.parse(v));
      }}
    >
      <option value="">{t("ui.inherit")}{ro ? ` (${choices.find((c) => c.value === JSON.stringify(ro.value))?.label ?? String(ro.value)})` : ""}</option>
      {#each choices as ch}<option value={ch.value}>{ch.label}</option>{/each}
    </select>
    {#if ro}<span class="pill {ro.source.layer}" title={t(`layer.${ro.source.layer}`)}>{ro.source.preset ? store.presetName(ro.source.preset) : t(`layer.${ro.source.layer}`)}</span>{:else}<span></span>{/if}
  </div>
{/if}

<style>
  .var.opt { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; gap: 6px; align-items: center; }
  label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  select { min-width: 0; width: 100%; }
</style>
