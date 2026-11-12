<script lang="ts">
  import { formatNumber, localName, VARIABLE_BY_NAME, type ParamInput } from "@cabinet-planner/engine";
  import { tick } from "svelte";
  import ForAll from "./ForAll.svelte";
  import { parseInput, setVar, store, type Layer } from "../../lib/store.svelte.ts";
  import {
    afterClick,
    fieldDiagnosticText,
    formulaNames,
    formulaRefs,
    highlightFor,
    layerView,
    originOf,
    varDiagnostics,
    varLabel,
  } from "../../lib/values.svelte.ts";

  /**
   * One variable of a layer (D56): the field shows the value that applies;
   * with focus it holds what the user edits (a number or a formula). Whether
   * the value is the layer's own or comes from elsewhere is a quiet cue on
   * the right; a tap on it explains in a sentence where the value comes from.
   */
  let {
    name,
    layer = "cabinet",
    label,
    steppers = false,
    param,
    scope = "",
    custom = false,
    detail = false,
  }: {
    name: string;
    layer?: Layer;
    label?: string;
    steppers?: boolean;
    /** A cabinet parameter (D45): its label, description, step and limits. */
    param?: ParamInput;
    /** Keeps ids apart when the same variable is on the page twice. */
    scope?: string;
    /** A variable of the user's own: shown by its name, removed instead of reset. */
    custom?: boolean;
    /** Parameter view (D59): the variable's name under the label; a formula comes with the values it reads. */
    detail?: boolean;
  } = $props();

  const t = $derived(store.tr.t);
  const id = $derived(`v-${scope ? `${scope}-` : ""}${layer}-${name}`);
  const doc = $derived(store.layerDoc(layer));
  const rv = $derived(layerView(layer)?.vars.get(name));
  const def = $derived(VARIABLE_BY_NAME.get(name));
  const ownRaw = $derived(doc?.vars?.[name] as number | string | undefined);
  const own = $derived(ownRaw !== undefined);
  /** The number or formula in effect: the one the user would edit. */
  const input = $derived(own ? ownRaw : rv?.input);
  const formula = $derived(typeof input === "string" ? input : undefined);
  const shown = $derived(rv?.value !== undefined ? formatNumber(rv.value) : input !== undefined ? String(input) : "");
  const text = $derived(label ?? (param?.label ? localName(param.label, store.ui.lang) : (varLabel(name, layer) ?? name)));
  const named = $derived(text !== name);
  const description = $derived(param?.description ? localName(param.description, store.ui.lang) : "");
  const hint = $derived(description || (def && store.tr.has(`var.${name}.hint`) ? t(`var.${name}.hint`) : ""));
  const diags = $derived(varDiagnostics(layer, name));
  const bad = $derived(diags.some((d) => d.severity === "error"));
  const origin = $derived(own ? (rv?.inherited ? originOf(rv.inherited.source) : undefined) : rv ? originOf(rv.source) : undefined);
  const otherwise = $derived(
    own && rv?.inherited && origin
      ? t("ui.origin.otherwise", { value: typeof rv.inherited.input === "number" ? formatNumber(rv.inherited.input) : rv.inherited.input, origin: origin.label })
      : "",
  );
  const refs = $derived(formula ? formulaRefs(formula, layer) : []);
  const step = $derived(param?.step ?? def?.step ?? (param ? (param.unit === "count" ? 1 : 10) : 1));
  const stepped = $derived(steppers || !!param || !!def?.quick);

  let el = $state<HTMLInputElement>();
  let focused = $state(false);
  // svelte-ignore state_referenced_locally
  let open = $state(detail && typeof (store.layerDoc(layer)?.vars?.[name] ?? layerView(layer)?.vars.get(name)?.input) === "string");
  let draft = $state("");
  let before = "";
  let textKeys = $state(false);
  let suggestions = $state<{ name: string; label: string }[]>([]);
  let picked = $state(-1);

  function stepBy(by: number): void {
    if (focused || draft !== before) commit();
    let next = (rv?.value ?? 0) + by;
    const min = param?.min ?? def?.min;
    const max = param?.max ?? def?.max;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setVar(layer, name, Math.round(next * 100) / 100);
  }

  /** Writes the field like every value field does: a number, a formula, or empty = inherit. */
  function commit(): void {
    if (draft === before) return;
    before = draft;
    setVar(layer, name, parseInput(draft));
  }
  function onFocus(): void {
    draft = before = input === undefined ? "" : String(input);
    focused = true;
    void tick().then(() => el?.select());
  }
  function onBlur(): void {
    afterClick(commit);
    focused = false;
    textKeys = false;
    suggestions = [];
  }

  /** The name being typed at the caret, for the suggestion list. */
  function word(): { start: number; end: number; text: string } | undefined {
    const end = el?.selectionStart ?? draft.length;
    const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(draft.slice(0, end));
    return m ? { start: end - m[0].length, end, text: m[0] } : undefined;
  }
  function suggest(): void {
    picked = -1;
    const w = word();
    if (!w || w.text.length < 2) {
      suggestions = [];
      return;
    }
    const q = w.text.toLowerCase();
    const all = formulaNames(layer).filter((n) => n.name !== name);
    const first = all.filter((n) => n.name.toLowerCase().startsWith(q));
    const more = all.filter((n) => !first.includes(n) && (n.name.toLowerCase().includes(q) || n.label.toLowerCase().includes(q)));
    const list = [...first, ...more].slice(0, 6);
    suggestions = list.length === 1 && list[0]!.name === w.text ? [] : list;
  }
  function accept(s: { name: string }): void {
    const w = word();
    if (!w) return;
    draft = draft.slice(0, w.start) + s.name + draft.slice(w.end);
    suggestions = [];
    picked = -1;
    const caret = w.start + s.name.length;
    void tick().then(() => el?.setSelectionRange(caret, caret));
  }
  function onKey(e: KeyboardEvent): void {
    if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = suggestions.length;
      picked = e.key === "ArrowDown" ? (picked + 1) % n : (picked + n - 1 + (picked < 0 ? 1 : 0)) % n;
    } else if (picked >= 0 && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      accept(suggestions[picked]!);
    } else if (e.key === "Enter") {
      suggestions = [];
      commit();
    } else if (e.key === "Escape") {
      if (suggestions.length) suggestions = [];
      else {
        draft = before;
        el?.blur();
      }
    }
  }
</script>

<div
  class="vrow"
  class:own
  class:bad
  onfocusin={() => layer === "cabinet" && highlightFor(name)}
  onfocusout={(e) => {
    if (layer === "cabinet" && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) highlightFor(null);
  }}
>
  <label class:mono={!named} for={id} title={hint ? (named ? `${hint} (${name})` : hint) : named ? name : undefined}>{text}{#if detail && named}<span class="vname mono">{name}</span>{/if}</label>
  <div class="vctl">
    <span class="vfield" class:typing={focused && /[A-Za-z_]/.test(draft)}>
      {#if stepped}
        <button class="vstep" class:always={steppers || !!param} tabindex="-1" aria-label={`${text} −`} onclick={() => stepBy(-step)}>−</button>
      {/if}
      <span class="vin">
      <input
        bind:this={el}
        {id}
        class="mono"
        type="text"
        inputmode={formula !== undefined || textKeys ? "text" : "decimal"}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        value={focused ? draft : shown}
        title={t("ui.value.formula_hint")}
        aria-invalid={bad ? "true" : undefined}
        aria-describedby={open ? `${id}-x` : undefined}
        aria-description={origin && !own ? origin.text : undefined}
        role={suggestions.length ? "combobox" : undefined}
        aria-expanded={suggestions.length ? "true" : undefined}
        aria-controls={suggestions.length ? `${id}-s` : undefined}
        onfocus={onFocus}
        onblur={onBlur}
        oninput={(e) => {
          draft = (e.target as HTMLInputElement).value;
          suggest();
        }}
        onkeydown={onKey}
      />
      {#if focused && formula === undefined && !textKeys}
        <button class="quiet vkeys" tabindex="-1" title={t("ui.value.type_formula")} aria-label={t("ui.value.type_formula")} onmousedown={(e) => e.preventDefault()} onclick={() => (textKeys = true)}>ƒ</button>
      {/if}
      </span>
      {#if stepped}
        <button class="vstep" class:always={steppers || !!param} tabindex="-1" aria-label={`${text} +`} onclick={() => stepBy(step)}>+</button>
      {/if}
      {#if suggestions.length}
        <ul class="vsug panel" id={`${id}-s`} role="listbox" aria-label={t("ui.value.suggestions")}>
          {#each suggestions as s, i (s.name)}
            <li role="option" aria-selected={i === picked}>
              <button tabindex="-1" class="quiet" class:on={i === picked} onmousedown={(e) => e.preventDefault()} onclick={() => accept(s)}>
                <span class="mono">{s.name}</span>
                {#if s.label}<span class="muted">{s.label}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </span>
    {#if formula !== undefined && rv?.value !== undefined}
      <span class="vfx mono" title={refs.map((r) => `${r.name}: ${r.label}`).join("\n")}>
        <span class="vf" aria-hidden="true">ƒ</span>
        {focused ? `= ${shown}` : `= ${formula}`}
      </span>
    {/if}
  </div>
  <span class="vorg">
    {#if own}
      {#if !custom}<button class="vsrc mine" tabindex="-1" aria-expanded={open} aria-controls={`${id}-x`} onclick={() => (open = !open)}>{t("ui.origin.own")}</button>{/if}
      <button
        class="quiet vreset"
        title={custom ? t("ui.delete") : otherwise ? `${t("ui.reset")} – ${otherwise}` : t("ui.reset")}
        aria-label={custom ? `${t("ui.delete")}: ${text}` : `${t("ui.reset")}: ${text}`}
        onclick={() => {
          before = draft;
          setVar(layer, name, undefined);
        }}>{custom ? "×" : "↺"}</button
      >
    {:else if origin}
      <button class="vsrc" tabindex="-1" title={origin.text} aria-expanded={open} aria-controls={`${id}-x`} onclick={() => (open = !open)}>{origin.label}</button>
    {/if}
  </span>
  {#if layer === "cabinet" && def && name !== "W"}
    <ForAll kind="var" {name} value={ownRaw} shown={formula !== undefined && shown !== formula ? `${formula} (= ${shown})` : shown} label={text} {id} />
  {/if}
  {#each diags as d}
    <p class="vmsg {d.severity}" role={d.severity === "error" ? "alert" : undefined}>{fieldDiagnosticText(d, name)}</p>
  {/each}
  {#if description}<p class="vdesc muted">{description}</p>{/if}
  {#if open}
    <p class="vexplain" id={`${id}-x`}>
      {#if own}
        {custom ? "" : t(`ui.origin.own.${layer}`)} {otherwise}
      {:else if origin}
        {origin.text} {t(`ui.origin.override.${layer}`)}
      {/if}
      {#each refs as r}
        <span class="vref"><span class="mono">{r.name}</span> = {r.label === r.name ? "" : `${r.label}: `}{r.value}</span>
      {/each}
    </p>
  {/if}
</div>
