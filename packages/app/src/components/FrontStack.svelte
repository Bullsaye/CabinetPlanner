<script lang="ts">
  import { formatNumber, layoutFronts } from "@cabinet-planner/engine";
  import { parseInput, store } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const res = $derived(store.cabinet?.resolved);

  /** Heights as the engine lays them out, for display next to each row. */
  const placed = $derived.by(() => {
    if (!c?.fronts || !res) return [];
    const v = (n: string): number => res.values.get(n) ?? 0;
    try {
      return layoutFronts(
        $state.snapshot(c.fronts),
        v("H"),
        { top: v("front_gap_top"), bottom: v("front_gap_bottom"), between: v("front_gap") },
        v("door_count"),
        res.values,
        { cabinet: c.id },
      ).fronts;
    } catch {
      return [];
    }
  });

  function move(i: number, by: -1 | 1): void {
    const list = c!.fronts as unknown[];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const [x] = list.splice(i, 1);
    list.splice(j, 0, x);
  }
</script>

{#if c}
  <details open>
    <summary class="label">{t("ui.fronts_stack")}</summary>
    {#if !c.fronts}
      <p class="hint muted">{t("ui.no_fronts_stack")}</p>
      <button onclick={() => (c.fronts = [{ type: "drawer", h: 150 }, { type: "door" }])}>{t("ui.use_stack")}</button>
    {:else}
      <p class="hint muted">{t("ui.fronts_hint")}</p>
      <div class="stack">
        {#each c.fronts as f, i}
          <div class="row">
            <select id={`front-type-${i}`} aria-label={t("ui.fronts_stack")} bind:value={f.type}>
              <option value="drawer">{t("ui.drawer")}</option>
              <option value="door">{t("ui.door_zone")}</option>
            </select>
            <input
              id={`front-h-${i}`}
              class="mono"
              type="text"
              value={f.h ?? ""}
              placeholder={t("ui.rest")}
              aria-label="h"
              onchange={(e) => {
                const v = parseInput((e.target as HTMLInputElement).value);
                if (v === undefined) delete f.h;
                else f.h = v;
              }}
            />
            <span class="mono val">{placed[i] ? formatNumber(placed[i].y1 - placed[i].y0) : ""}</span>
            {#if f.type === "door"}
              <select id={`front-doors-${i}`} aria-label={t("ui.doors")} value={String(f.doors ?? "")} onchange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                if (v === "") delete f.doors;
                else f.doors = Number(v);
              }}>
                <option value="">{t("ui.doors")}: {t("ui.inherit")}</option>
                <option value="1">1 {t("ui.doors")}</option>
                <option value="2">2 {t("ui.doors")}</option>
              </select>
            {:else}
              <span></span>
            {/if}
            <span class="tools">
              <button class="quiet" aria-label={t("ui.move_up")} onclick={() => move(i, -1)}>↑</button>
              <button class="quiet" aria-label={t("ui.move_down")} onclick={() => move(i, 1)}>↓</button>
              <button class="quiet" aria-label={t("ui.delete")} onclick={() => c.fronts.splice(i, 1)}>×</button>
            </span>
          </div>
        {/each}
      </div>
      <div class="add">
        <button onclick={() => c.fronts.unshift({ type: "drawer", h: 150 })}>{t("ui.add_drawer")}</button>
        <button onclick={() => c.fronts.push({ type: "door" })}>{t("ui.add_door_zone")}</button>
        <button class="quiet" onclick={() => delete c.fronts}>{t("ui.remove_stack")}</button>
      </div>
    {/if}
  </details>
{/if}

<style>
  details { border-top: 1px solid var(--line); padding-top: 6px; }
  summary { cursor: pointer; padding: 4px 0; }
  .hint { margin: 0 0 6px; font-size: 12px; }
  .stack { display: flex; flex-direction: column; gap: 4px; }
  .row { display: grid; grid-template-columns: minmax(96px, 1.3fr) 64px 40px minmax(0, 1fr) auto; gap: 4px; align-items: center; }
  .row input { width: 100%; }
  .val { text-align: right; font-size: 12px; }
  .tools { display: flex; }
  .tools button { padding: 0 4px; }
  .add { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
</style>
