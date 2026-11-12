<script lang="ts">
  import { formatNumber } from "@cabinet-planner/engine";
  import { commonValue, setForCabinets, type ValueKind } from "../../lib/bulk.ts";
  import { optionChoices, optionDef } from "../../lib/fields.ts";
  import { parseInput, store } from "../../lib/store.svelte.ts";
  import { afterClick, varLabel } from "../../lib/values.svelte.ts";

  /**
   * One value of several selected cabinets (D59): the field shows the value
   * they share, or "differs"; what is entered is written to each of them.
   */
  let { ids, name, kind = "var", label }: { ids: string[]; name: string; kind?: ValueKind; label?: string } = $props();
  const t = $derived(store.tr.t);
  const id = $derived(`m-${name}`);
  const cv = $derived(commonValue(ids, kind, name));
  const text = $derived(label ?? (kind === "var" ? (varLabel(name) ?? name) : t(`option.${name}`)));
  const o = $derived(kind === "option" ? optionDef(name) : undefined);
  const choices = $derived(o ? optionChoices(o) : []);
  const shown = $derived(cv.mixed ? "" : cv.value !== undefined ? formatNumber(cv.value) : cv.input === undefined ? "" : String(cv.input));
  const formula = $derived(!cv.mixed && typeof cv.input === "string" && kind === "var" ? cv.input : undefined);

  let focused = $state(false);
  let draft = $state("");
  let before = "";
  function commit(): void {
    if (draft === before) return;
    before = draft;
    setForCabinets(ids, "var", name, parseInput(draft));
  }
</script>

<div class="vrow" class:own={cv.own > 0 && !cv.mixed} class:mixed={cv.mixed} data-multi={name}>
  <label for={id}>{text}</label>
  <div class="vctl">
    {#if kind === "var"}
      <span class="vfield">
        <input
          {id}
          class="mono"
          type="text"
          inputmode={formula !== undefined ? "text" : "decimal"}
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          value={focused ? draft : shown}
          placeholder={cv.mixed ? t("ui.multi.mixed") : ""}
          onfocus={() => {
            draft = before = cv.mixed || cv.input === undefined ? "" : String(cv.input);
            focused = true;
          }}
          onblur={() => {
            afterClick(commit);
            focused = false;
          }}
          oninput={(e) => (draft = (e.target as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              draft = before;
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </span>
      {#if formula !== undefined && !focused}<span class="vfx mono"><span class="vf" aria-hidden="true">ƒ</span> = {formula}</span>{/if}
    {:else}
      <select
        {id}
        value={cv.mixed ? "__mixed" : JSON.stringify(cv.input)}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v !== "__mixed") setForCabinets(ids, "option", name, JSON.parse(v));
        }}
      >
        {#if cv.mixed}<option value="__mixed" disabled>{t("ui.multi.mixed")}</option>{/if}
        {#each choices as ch}<option value={ch.value}>{ch.label}</option>{/each}
      </select>
    {/if}
  </div>
  <span class="vorg">
    {#if cv.own > 0}
      <span class="vsrc mine" title={t("ui.multi.own_hint", { n: cv.own, of: ids.length })}>{cv.own}/{ids.length}</span>
      <button class="quiet vreset" title={t("ui.multi.reset")} aria-label={`${t("ui.multi.reset")}: ${text}`} onclick={() => setForCabinets(ids, kind, name, undefined)}>↺</button>
    {/if}
  </span>
</div>

<style>
  .mixed :global(input::placeholder) { font-style: italic; color: var(--muted); }
  .mixed select { font-style: italic; }
  span.vsrc { font-size: 11px; padding: 2px 4px; }
</style>
