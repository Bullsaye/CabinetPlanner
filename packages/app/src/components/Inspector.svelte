<script lang="ts">
  import {
    formatNumber,
    localName,
    OPTIONS,
    VARIABLES,
    type OptionDef,
    type VarDef,
  } from "@cabinet-planner/engine";
  import { parseInput, setOption, setVar, store, type Layer } from "../lib/store.svelte.ts";

  /** All variables and options of one layer (cabinet, project or shop defaults). */
  let { layer = "cabinet" }: { layer?: Layer } = $props();
  const t = $derived(store.tr.t);
  const doc = $derived(store.layerDoc(layer));
  const res = $derived(store.cabinet?.resolved);
  const lib = $derived(store.result?.library);

  const GROUPS = ["dimensions", "room", "fronts", "shelves", "drawers", "construction", "back", "board", "system", "hardware", "machining", "costing"] as const;
  const OPEN = new Set(["dimensions", "fronts", "shelves"]);
  const OPTION_GROUP: Record<string, string> = { materials: "materials", edges: "edges" };

  const varsIn = (g: string): VarDef[] => VARIABLES.filter((v) => v.group === g);
  const optsIn = (g: string): OptionDef[] => OPTIONS.filter((o) => (OPTION_GROUP[o.group] ?? o.group) === g);

  /** Touch steppers: the resolved value plus or minus the variable's step, within its limits. */
  function stepVar(name: string, by: number, current: number | undefined): void {
    const def = VARIABLES.find((x) => x.name === name);
    let next = (current ?? 0) + by;
    if (def?.min !== undefined) next = Math.max(def.min, next);
    if (def?.max !== undefined) next = Math.min(def.max, next);
    setVar(layer, name, Math.round(next * 100) / 100);
  }

  const own = (name: string): string => {
    const v = doc?.vars?.[name];
    return v === undefined ? "" : String(v);
  };
  const ownOpt = (key: string): string | undefined => {
    const v = doc?.options?.[key];
    return v === undefined ? undefined : JSON.stringify(v);
  };

  function commitVar(name: string, text: string): void {
    setVar(layer, name, parseInput(text));
  }

  const show = (x: number | undefined): string => (x === undefined ? "?" : formatNumber(x));

  function optionChoices(o: OptionDef): { value: string; label: string }[] {
    const k = o.kind;
    if (k.type === "enum") return k.values.map((v) => ({ value: JSON.stringify(v), label: t(`option.${o.key}.${v}`) }));
    if (k.type === "boolean") return [true, false].map((v) => ({ value: JSON.stringify(v), label: t(v ? "ui.yes" : "ui.no") }));
    if (k.type === "material")
      return [...(lib?.materials.values() ?? [])].map((m) => ({ value: JSON.stringify(m.id), label: localName(m.name, store.tr.locale) }));
    if (k.type === "edgeband")
      return [
        { value: "null", label: t("option.edge.none") },
        ...[...(lib?.edgebands.values() ?? [])].map((e) => ({ value: JSON.stringify(e.id), label: `${e.code} · ${localName(e.name, store.tr.locale)}` })),
      ];
    if (k.type === "surface")
      return [
        { value: "null", label: t("option.surface.none") },
        ...[...(lib?.surfaces.values() ?? [])].map((x) => ({ value: JSON.stringify(x.id), label: localName(x.name, store.tr.locale) })),
      ];
    const items = [...(lib?.hardware.values() ?? [])].filter((h) => h.category === k.category);
    return [
      ...(k.nullable ? [{ value: "null", label: t("ui.none") }] : []),
      ...items.map((h) => ({ value: JSON.stringify(h.id), label: localName(h.name, store.tr.locale) })),
    ];
  }


  let customName = $state("");
  let customValue = $state("");
  const customVars = $derived(Object.keys(doc?.vars ?? {}).filter((n) => !VARIABLES.some((v) => v.name === n)));
</script>

<section class="panel insp">
  <p class="hint muted">{t(`ui.layer_hint.${layer}`)}</p>

  {#if !doc}
    <p class="muted">{t("ui.select_cabinet")}</p>
  {:else}
    {#each GROUPS as g}
      {@const vs = varsIn(g)}
      {@const os = optsIn(g)}
      {#if vs.length || os.length}
        <details open={OPEN.has(g)}>
          <summary class="label">{t(`group.${g}`)}</summary>
          <div class="rows">
            {#each vs as v (v.name)}
              {@const rv = res?.vars.get(v.name)}
              <div class="var">
                <label for={`v-${v.name}`} title={t(`var.${v.name}.hint`)}>{t(`var.${v.name}`)}</label>
                <span class="field">
                  {#if v.quick}
                    <button class="step" tabindex="-1" aria-label={`${t(`var.${v.name}`)} −`} onclick={() => stepVar(v.name, -(v.step ?? 1), rv?.value)}>−</button>
                  {/if}
                  <input
                    id={`v-${v.name}`}
                    class="mono"
                    type="text"
                    inputmode="decimal"
                    value={own(v.name)}
                    placeholder={rv ? String(rv.input) : ""}
                    onchange={(e) => commitVar(v.name, (e.target as HTMLInputElement).value)}
                  />
                  {#if v.quick}
                    <button class="step" tabindex="-1" aria-label={`${t(`var.${v.name}`)} +`} onclick={() => stepVar(v.name, v.step ?? 1, rv?.value)}>+</button>
                  {/if}
                </span>
                <span class="val mono" title={rv && typeof rv.input === "string" ? rv.input : ""}>{show(rv?.value)}</span>
                {#if rv}<span class="pill {rv.source.layer}" title={t(`layer.${rv.source.layer}`)}>{rv.source.preset ? store.presetName(rv.source.preset) : t(`layer.${rv.source.layer}`)}</span>{/if}
                {#if own(v.name) !== ""}
                  <button class="quiet reset" title={t("ui.reset")} aria-label={t("ui.reset")} onclick={() => setVar(layer, v.name, undefined)}>↺</button>
                {/if}
              </div>
            {/each}
            {#each os as o (o.key)}
              {@const ro = res?.options.get(o.key)}
              <div class="var opt">
                <label for={`o-${o.key}`}>{t(`option.${o.key}`)}</label>
                <select
                  id={`o-${o.key}`}
                  value={ownOpt(o.key) ?? ""}
                  onchange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    setOption(layer, o.key, v === "" ? undefined : JSON.parse(v));
                  }}
                >
                  <option value="">{t("ui.inherit")}{ro ? ` (${optionChoices(o).find((c) => c.value === JSON.stringify(ro.value))?.label ?? String(ro.value)})` : ""}</option>
                  {#each optionChoices(o) as ch}<option value={ch.value}>{ch.label}</option>{/each}
                </select>
                {#if ro}<span class="pill {ro.source.layer}" title={t(`layer.${ro.source.layer}`)}>{ro.source.preset ? store.presetName(ro.source.preset) : t(`layer.${ro.source.layer}`)}</span>{/if}
              </div>
            {/each}
          </div>
        </details>
      {/if}
    {/each}
    {#each [["materials", OPTIONS.filter((o) => o.group === "materials")], ["edges", OPTIONS.filter((o) => o.group === "edges")]] as [g, os]}
      <details>
        <summary class="label">{t(`group.${g}`)}</summary>
        <div class="rows">
          {#each os as o (o.key)}
            {@const ro = res?.options.get(o.key)}
            <div class="var opt">
              <label for={`o-${o.key}`}>{t(`option.${o.key}`)}</label>
              <select
                id={`o-${o.key}`}
                value={ownOpt(o.key) ?? ""}
                onchange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  setOption(layer, o.key, v === "" ? undefined : JSON.parse(v));
                }}
              >
                <option value="">{t("ui.inherit")}{ro ? ` (${optionChoices(o).find((c) => c.value === JSON.stringify(ro.value))?.label ?? String(ro.value)})` : ""}</option>
                {#each optionChoices(o) as ch}<option value={ch.value}>{ch.label}</option>{/each}
              </select>
              {#if ro}<span class="pill {ro.source.layer}" title={t(`layer.${ro.source.layer}`)}>{ro.source.preset ? store.presetName(ro.source.preset) : t(`layer.${ro.source.layer}`)}</span>{/if}
            </div>
          {/each}
        </div>
      </details>
    {/each}
    <details>
      <summary class="label">{t("ui.custom_vars")}</summary>
      <p class="hint muted">{t("ui.custom_vars_hint")}</p>
      <div class="rows">
        {#each customVars as n (n)}
          <div class="var">
            <label for={`c-${n}`} class="mono">{n}</label>
            <input id={`c-${n}`} class="mono" type="text" value={own(n)} onchange={(e) => commitVar(n, (e.target as HTMLInputElement).value)} />
            <span class="val mono">{show(res?.values.get(n))}</span>
            <span></span>
            <button class="quiet reset" aria-label={t("ui.delete")} onclick={() => setVar(layer, n, undefined)}>×</button>
          </div>
        {/each}
        <form
          class="var"
          onsubmit={(e) => {
            e.preventDefault();
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(customName) && customValue.trim()) {
              commitVar(customName, customValue);
              customName = "";
              customValue = "";
            }
          }}
        >
          <input id="custom-name" class="mono" type="text" placeholder="my_gap" bind:value={customName} aria-label={t("ui.var_name")} />
          <input id="custom-value" class="mono" type="text" placeholder="3" bind:value={customValue} aria-label={t("ui.var_value")} />
          <button type="submit">{t("ui.add")}</button>
        </form>
      </div>
    </details>
  {/if}
</section>

<style>
  .insp { display: flex; flex-direction: column; gap: 8px; }
  .layers { display: flex; gap: 4px; }
  .layers button { flex: 1; }
  .hint { margin: 0; font-size: 12px; }
  .row2 { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; }
  details { border-top: 1px solid var(--line); padding-top: 6px; }
  summary { cursor: pointer; padding: 4px 0; }
  .rows { display: flex; flex-direction: column; gap: 4px; padding: 4px 0 6px; }
  .var { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) 46px auto 22px; gap: 6px; align-items: center; }
  .var.opt { grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; }
  .field { display: flex; min-width: 0; gap: 2px; }
  .label-like { color: var(--fg); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 2px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 12px; padding: 0 2px 0 8px; font-size: 12px; }
  .chip .x { padding: 0 6px; min-height: 0; }
  #add-preset { max-width: 12em; font-size: 12px; }
  .field input { flex: 1; min-width: 0; width: 100%; }
  .step { display: none; padding: 0 8px; }
  @media (pointer: coarse) {
    .step { display: inline-block; }
    .var { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 46px auto 28px; }
  }
  .var label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .var input { width: 100%; }
  .val { text-align: right; font-size: 12px; }
  .reset { padding: 0 4px; }
  form.var { grid-template-columns: 1fr 1fr auto; }
</style>
