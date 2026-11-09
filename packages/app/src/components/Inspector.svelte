<script lang="ts">
  import {
    formatNumber,
    localName,
    OPTIONS,
    VARIABLES,
    type OptionDef,
    type VarDef,
  } from "@cabinet-planner/engine";
  import { parseInput, setKind, setOption, setVar, store, type Layer } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  const layer = $derived(store.ui.layer);
  const doc = $derived(store.layerDoc(layer));
  const res = $derived(store.cabinet?.resolved);
  const lib = $derived(store.result?.library);

  const GROUPS = ["dimensions", "fronts", "shelves", "construction", "back", "board", "system", "hardware", "machining"] as const;
  const OPEN = new Set(["dimensions", "fronts", "shelves"]);
  const OPTION_GROUP: Record<string, string> = { materials: "materials", edges: "edges" };

  const varsIn = (g: string): VarDef[] => VARIABLES.filter((v) => v.group === g);
  const optsIn = (g: string): OptionDef[] => OPTIONS.filter((o) => (OPTION_GROUP[o.group] ?? o.group) === g);

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
    const items = [...(lib?.hardware.values() ?? [])].filter((h) => h.category === k.category);
    return [
      ...(k.nullable ? [{ value: "null", label: t("ui.none") }] : []),
      ...items.map((h) => ({ value: JSON.stringify(h.id), label: localName(h.name, store.tr.locale) })),
    ];
  }

  const LAYERS: Layer[] = ["cabinet", "project", "shop"];
  let customName = $state("");
  let customValue = $state("");
  const customVars = $derived(Object.keys(doc?.vars ?? {}).filter((n) => !VARIABLES.some((v) => v.name === n)));
</script>

<section class="panel insp">
  <div class="layers" role="group" aria-label={t("ui.edit_layer")}>
    {#each LAYERS as l}
      <button aria-pressed={layer === l} onclick={() => (store.ui.layer = l)} disabled={l === "cabinet" && !store.cabinetDoc}>
        {l === "cabinet" && store.ui.selected ? store.ui.selected : t(`ui.layer.${l}`)}
      </button>
    {/each}
  </div>
  <p class="hint muted">{t(`ui.layer_hint.${layer}`)}</p>

  {#if layer === "cabinet" && store.cabinetDoc}
    {@const c = store.cabinetDoc}
    <div class="row2">
      <label for="cab-name">{t("ui.name")}</label>
      <input id="cab-name" type="text" bind:value={c.name} placeholder={t(`ui.kind.${c.kind ?? "base"}`)} />
      <label for="cab-kind">{t("ui.kind")}</label>
      <select id="cab-kind" value={c.kind ?? "base"} onchange={(e) => setKind((e.target as HTMLSelectElement).value as "base")}>
        {#each ["base", "wall", "tall"] as k}<option value={k}>{t(`ui.kind.${k}`)}</option>{/each}
      </select>
    </div>
  {/if}

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
                <input
                  id={`v-${v.name}`}
                  class="mono"
                  type="text"
                  value={own(v.name)}
                  placeholder={rv ? String(rv.input) : ""}
                  onchange={(e) => commitVar(v.name, (e.target as HTMLInputElement).value)}
                />
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
  .insp { padding: 12px; display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 90px); overflow: auto; }
  .layers { display: flex; gap: 4px; }
  .layers button { flex: 1; }
  .hint { margin: 0; font-size: 12px; }
  .row2 { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; }
  details { border-top: 1px solid var(--line); padding-top: 6px; }
  summary { cursor: pointer; padding: 4px 0; }
  .rows { display: flex; flex-direction: column; gap: 4px; padding: 4px 0 6px; }
  .var { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) 46px auto 22px; gap: 6px; align-items: center; }
  .var.opt { grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; }
  .var label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .var input { width: 100%; }
  .val { text-align: right; font-size: 12px; }
  .reset { padding: 0 4px; }
  form.var { grid-template-columns: 1fr 1fr auto; }
</style>
