<script lang="ts">
  import { OPTIONS, VARIABLES, type OptionDef, type VarDef } from "@cabinet-planner/engine";
  import { parseInput, setVar, store, type Layer } from "../lib/store.svelte.ts";
  import OptRow from "./fields/OptRow.svelte";
  import VarRow from "./fields/VarRow.svelte";

  /** All variables and options of one layer (cabinet, project or shop defaults). */
  let { layer = "cabinet" }: { layer?: Layer } = $props();
  const t = $derived(store.tr.t);
  const doc = $derived(store.layerDoc(layer));

  const FURNITURE = ["fronts", "shelves", "drawers", "construction", "back", "board", "materials", "edges", "system", "hardware", "machining"];
  /** The furniture itself first; room, worktop and plinth lead only where they are set for all cabinets. */
  const GROUPS = $derived(layer === "cabinet" ? ["dimensions", ...FURNITURE, "room", "costing"] : ["dimensions", "room", ...FURNITURE, "costing"]);
  const OPEN = new Set(["dimensions", "fronts", "shelves"]);

  const varsIn = (g: string): VarDef[] => VARIABLES.filter((v) => v.group === g);
  const optsIn = (g: string): OptionDef[] => OPTIONS.filter((o) => o.group === g);

  let customName = $state("");
  let customValue = $state("");
  const customVars = $derived(Object.keys(doc?.vars ?? {}).filter((n) => !VARIABLES.some((v) => v.name === n)));
</script>

<section class="panel insp">
  <p class="hint muted">{t(`ui.layer_hint.${layer}`)}</p>
  <p class="hint muted">{t("ui.value.formula_hint")}</p>

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
            {#each vs as v (v.name)}<VarRow name={v.name} {layer} scope="all" />{/each}
            {#each os as o (o.key)}<OptRow key={o.key} {layer} scope="all" />{/each}
          </div>
        </details>
      {/if}
    {/each}
    <details>
      <summary class="label">{t("ui.custom_vars")}</summary>
      <p class="hint muted">{t("ui.custom_vars_hint")}</p>
      <div class="rows">
        {#each customVars as n (n)}<VarRow name={n} {layer} scope="all" custom />{/each}
        <form
          class="add"
          onsubmit={(e) => {
            e.preventDefault();
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(customName) && customValue.trim()) {
              setVar(layer, customName, parseInput(customValue));
              customName = "";
              customValue = "";
            }
          }}
        >
          <input id={`custom-name-${layer}`} class="mono" type="text" placeholder="my_gap" bind:value={customName} aria-label={t("ui.var_name")} />
          <input id={`custom-value-${layer}`} class="mono" type="text" placeholder="3" bind:value={customValue} aria-label={t("ui.var_value")} />
          <button type="submit">{t("ui.add")}</button>
        </form>
      </div>
    </details>
  {/if}
</section>

<style>
  .insp { display: flex; flex-direction: column; gap: 8px; }
  .hint { margin: 0; font-size: 12px; }
  details { border-top: 1px solid var(--line); padding-top: 6px; }
  summary { cursor: pointer; padding: 4px 0; }
  .rows { display: flex; flex-direction: column; gap: 4px; padding: 4px 0 6px; }
  .add { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: center; }
  .add input { width: 100%; }
</style>
