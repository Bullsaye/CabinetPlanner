<script lang="ts">
  import ForAll from "./ForAll.svelte";
  import { setOption, store, type Layer } from "../../lib/store.svelte.ts";
  import { optionChoices, optionDef } from "../../lib/fields.ts";
  import { highlightFor, layerView, originOf } from "../../lib/values.svelte.ts";

  /**
   * One option of a layer (D70): the select shows the choice that applies.
   * Own choices can be reset; inherited ones carry a quiet origin label.
   */
  let { key, layer = "cabinet", label, scope = "" }: { key: string; layer?: Layer; label?: string; scope?: string } = $props();
  const t = $derived(store.tr.t);
  const id = $derived(`o-${scope ? `${scope}-` : ""}${layer}-${key}`);
  const doc = $derived(store.layerDoc(layer));
  const o = $derived(optionDef(key));
  const ro = $derived(layerView(layer)?.options.get(key));
  const own = $derived(doc?.options?.[key] !== undefined);
  const value = $derived(own ? doc!.options[key] : ro?.value);
  const current = $derived(value === undefined ? "" : JSON.stringify(value));
  const choices = $derived(o ? optionChoices(o) : []);
  const known = $derived(choices.some((c) => c.value === current));
  const choiceLabel = (v: unknown): string => choices.find((c) => c.value === JSON.stringify(v))?.label ?? String(v);
  const origin = $derived(own ? (ro?.inherited ? originOf(ro.inherited.source) : undefined) : ro ? originOf(ro.source) : undefined);
  const otherwise = $derived(own && ro?.inherited && origin ? t("ui.origin.otherwise", { value: choiceLabel(ro.inherited.value), origin: origin.label }) : "");
  const text = $derived(label ?? t(`option.${key}`));

  let open = $state(false);
</script>

{#if o}
  <div
    class="vrow opt"
    class:own
    onfocusin={() => layer === "cabinet" && highlightFor(key)}
    onfocusout={(e) => {
      if (layer === "cabinet" && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) highlightFor(null);
    }}
  >
    <label for={id}>{text}</label>
    <div class="vctl">
      <select
        {id}
        value={current}
        aria-describedby={open ? `${id}-x` : undefined}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          setOption(layer, key, v === "" ? undefined : JSON.parse(v));
        }}
      >
        {#if !known && current !== ""}<option value={current}>{String(value)}</option>{/if}
        {#each choices as ch}<option value={ch.value}>{ch.label}</option>{/each}
        {#if own}<option value="">↺ {otherwise || t("ui.reset")}</option>{/if}
      </select>
    </div>
    <span class="vorg">
      {#if own}
        <button class="vsrc mine" tabindex="-1" aria-expanded={open} aria-controls={`${id}-x`} onclick={() => (open = !open)}>{t("ui.origin.own")}</button>
        <button
          class="quiet vreset"
          title={otherwise ? `${t("ui.reset")} – ${otherwise}` : t("ui.reset")}
          aria-label={`${t("ui.reset")}: ${text}`}
          onclick={() => setOption(layer, key, undefined)}>↺</button
        >
      {:else if origin}
        <button class="vsrc" tabindex="-1" title={origin.text} aria-expanded={open} aria-controls={`${id}-x`} onclick={() => (open = !open)}>{origin.label}</button>
      {/if}
    </span>
    {#if layer === "cabinet"}
      <ForAll kind="option" name={key} value={own ? doc!.options[key] : undefined} shown={choiceLabel(value)} label={text} {id} />
    {/if}
    {#if open}
      <p class="vexplain" id={`${id}-x`}>
        {#if own}
          {t(`ui.origin.own.${layer}`)} {otherwise}
        {:else if origin}
          {origin.text} {t(`ui.origin.override.${layer}`)}
        {/if}
      </p>
    {/if}
  </div>
{/if}
