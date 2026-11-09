<script lang="ts">
  import { formatNumber, layoutFronts } from "@cabinet-planner/engine";
  import { parseInput, store } from "../lib/store.svelte.ts";

  type Zone = { type: string; h?: number | string; doors?: number; hinge?: "left" | "right"; front?: boolean };
  const TYPES = ["door", "drawer", "flap", "open", "appliance", "panel"] as const;

  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const res = $derived(store.cabinet?.resolved);
  const v = (n: string): number => res?.values.get(n) ?? 0;

  /** The stack as edited: the cabinet's own, or one door zone made from door_count. */
  const zones = $derived<Zone[]>(c?.fronts ?? (v("door_count") > 0 ? [{ type: "door", doors: v("door_count") }] : []));
  function edit(f: (list: Zone[]) => void): void {
    if (!c) return;
    if (!c.fronts) c.fronts = JSON.parse(JSON.stringify(zones));
    f(c.fronts as Zone[]);
  }

  const placed = $derived.by(() => {
    if (!res) return [];
    try {
      return layoutFronts(
        JSON.parse(JSON.stringify(zones)),
        v("H"),
        { top: v("front_gap_top"), bottom: v("front_gap_bottom"), between: v("front_gap") },
        v("door_count"),
        res.values,
        { cabinet: c?.id ?? "" },
      ).fronts;
    } catch {
      return [];
    }
  });

  /** Door mode of a zone: one door hinged left or right, or a pair. */
  const doorMode = (z: Zone): "left" | "right" | "pair" =>
    (z.doors ?? v("door_count")) >= 2 ? "pair" : (z.hinge ?? (res?.options.get("door_hinge_side")?.value as "left" | "right") ?? "left");
  function setDoorMode(i: number, m: "left" | "right" | "pair"): void {
    edit((l) => {
      const z = l[i]!;
      if (m === "pair") {
        z.doors = 2;
        delete z.hinge;
      } else {
        z.doors = 1;
        z.hinge = m;
      }
    });
  }

  const LAYOUTS: { id: string; zones: Zone[] }[] = [
    { id: "door_left", zones: [{ type: "door", doors: 1, hinge: "left" }] },
    { id: "door_right", zones: [{ type: "door", doors: 1, hinge: "right" }] },
    { id: "doors_pair", zones: [{ type: "door", doors: 2 }] },
    { id: "drawer_door", zones: [{ type: "drawer", h: 150 }, { type: "door" }] },
    { id: "drawers_3", zones: [{ type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer" }] },
    { id: "drawers_4", zones: [{ type: "drawer", h: 140 }, { type: "drawer", h: 140 }, { type: "drawer", h: 140 }, { type: "drawer" }] },
    { id: "flap", zones: [{ type: "flap" }] },
    { id: "open", zones: [] },
  ];
  function applyLayout(l: Zone[]): void {
    if (!c) return;
    c.fronts = JSON.parse(JSON.stringify(l));
    if (!l.length) c.vars = { ...(c.vars ?? {}), door_count: 0 };
    else if (c.vars?.door_count === 0) delete c.vars.door_count;
  }

  // Preview geometry (front view, paper Y down).
  const W = $derived(v("W"));
  const H = $derived(v("H"));
  const s = $derived(W && H ? Math.min(150 / W, 190 / H) : 1);
  const gl = $derived(v("front_gap_left"));
  const gr = $derived(v("front_gap_right"));
  const gm = $derived(v("front_gap_middle"));
  function rects(i: number): { x: number; w: number; hinge?: "left" | "right" }[] {
    const z = zones[i];
    const p = placed[i];
    if (!z || !p) return [];
    if (z.type === "door" && doorMode(z) === "pair") {
      const dw = (W - gl - gr - gm) / 2;
      return [{ x: gl, w: dw, hinge: "left" }, { x: gl + dw + gm, w: dw, hinge: "right" }];
    }
    return [{ x: gl, w: W - gl - gr, ...(z.type === "door" ? { hinge: doorMode(z) as "left" | "right" } : {}) }];
  }
</script>

{#if c}
  <div class="fb">
    <div class="layouts" role="group" aria-label={t("ui.front_layouts")}>
      {#each LAYOUTS as l}
        <button class="quiet lay" title={t(`ui.layout.${l.id}`)} onclick={() => applyLayout(l.zones)}>{t(`ui.layout.${l.id}`)}</button>
      {/each}
    </div>
    <div class="body">
      {#if W && H}
        <svg class="preview" viewBox={`-4 -4 ${W * s + 8} ${H * s + 8}`} width={W * s + 8} height={H * s + 8} role="img" aria-label={t("ui.front_preview")}>
          <rect class="carcase" x="0" y="0" width={W * s} height={H * s} />
          {#each placed as p, i}
            {#each rects(i) as r}
              {@const y = (H - p.y1) * s}
              {@const h = (p.y1 - p.y0) * s}
              {#if zones[i]?.type === "open" || (zones[i]?.type === "appliance" && !zones[i]?.front)}
                <rect class="hole" x={r.x * s} {y} width={r.w * s} height={h} />
              {:else}
                <rect class="front {zones[i]?.type}" x={r.x * s} {y} width={r.w * s} height={h} />
                {#if r.hinge}
                  <!-- Opening symbol: lines from the opening edge to the middle of the hinge edge. -->
                  {@const hx = r.hinge === "left" ? r.x * s : (r.x + r.w) * s}
                  {@const ox = r.hinge === "left" ? (r.x + r.w) * s : r.x * s}
                  <polyline class="swing" points={`${ox},${y} ${hx},${y + h / 2} ${ox},${y + h}`} />
                {/if}
                {#if zones[i]?.type === "flap"}
                  <polyline class="swing" points={`${r.x * s},${y + h} ${(r.x + r.w / 2) * s},${y} ${(r.x + r.w) * s},${y + h}`} />
                {/if}
              {/if}
            {/each}
            <text class="h" x={W * s - 3} y={(H - (p.y0 + p.y1) / 2) * s + 3} text-anchor="end">{formatNumber(p.y1 - p.y0)}</text>
          {/each}
        </svg>
      {/if}
      <div class="rows">
        {#each zones as z, i}
          <div class="row">
            <select id={`fz-type-${i}`} aria-label={t("ui.front_type")} value={z.type} onchange={(e) => edit((l) => (l[i]!.type = (e.target as HTMLSelectElement).value))}>
              {#each TYPES as ty}<option value={ty}>{t(`ui.zone.${ty}`)}</option>{/each}
            </select>
            <input
              id={`fz-h-${i}`}
              class="mono"
              type="text"
              inputmode="decimal"
              value={z.h ?? ""}
              placeholder={t("ui.rest")}
              aria-label={t("ui.front_height")}
              onchange={(e) => {
                const val = parseInput((e.target as HTMLInputElement).value);
                edit((l) => (val === undefined ? delete l[i]!.h : (l[i]!.h = val)));
              }}
            />
            {#if z.type === "door"}
              <div class="seg" role="group" aria-label={t("ui.opening")}>
                {#each ["left", "pair", "right"] as m}
                  <button aria-pressed={doorMode(z) === m} title={t(`ui.door_mode.${m}`)} onclick={() => setDoorMode(i, m as "left")}>{t(`ui.door_mode_short.${m}`)}</button>
                {/each}
              </div>
            {:else if z.type === "appliance"}
              <label class="chk"><input type="checkbox" checked={z.front ?? false} onchange={(e) => edit((l) => (l[i]!.front = (e.target as HTMLInputElement).checked))} /> {t("ui.appliance_front")}</label>
            {:else}<span></span>{/if}
            <span class="tools">
              <button class="quiet" aria-label={t("ui.move_up")} disabled={i === 0} onclick={() => edit((l) => l.splice(i - 1, 0, ...l.splice(i, 1)))}>↑</button>
              <button class="quiet" aria-label={t("ui.move_down")} disabled={i === zones.length - 1} onclick={() => edit((l) => l.splice(i + 1, 0, ...l.splice(i, 1)))}>↓</button>
              <button class="quiet" aria-label={t("ui.delete")} onclick={() => edit((l) => l.splice(i, 1))}>×</button>
            </span>
          </div>
        {/each}
        {#if !zones.length}<p class="muted small">{t("ui.no_fronts")}</p>{/if}
        <div class="add">
          <button onclick={() => edit((l) => l.push({ type: "drawer", h: 150 }))}>{t("ui.add_drawer")}</button>
          <button onclick={() => edit((l) => l.push({ type: "door", doors: 1 }))}>{t("ui.add_door_zone")}</button>
          <button onclick={() => edit((l) => l.push({ type: "flap" }))}>{t("ui.add_flap")}</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .fb { display: flex; flex-direction: column; gap: 8px; }
  .layouts { display: flex; flex-wrap: wrap; gap: 4px; }
  .lay { font-size: 12px; padding: 2px 8px; border: 1px solid var(--line); }
  .body { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; }
  .preview { display: block; }
  .carcase { fill: var(--surface-2); stroke: var(--part-edge); stroke-width: 1; }
  .front { fill: color-mix(in srgb, var(--surface) 75%, var(--accent)); stroke: var(--fg); stroke-width: .8; }
  .front.drawer { fill: color-mix(in srgb, var(--surface) 82%, var(--accent)); }
  .front.panel, .front.appliance { fill: color-mix(in srgb, var(--surface) 88%, var(--fg)); }
  .hole { fill: var(--view); stroke: var(--part-edge); stroke-width: .6; stroke-dasharray: 3 2; }
  .swing { fill: none; stroke: var(--muted); stroke-width: .8; stroke-dasharray: 4 2; }
  .h { font: 9px var(--font-mono); fill: var(--fg); }
  .rows { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .row { display: grid; grid-template-columns: minmax(84px, 1fr) 58px auto auto; gap: 4px; align-items: center; }
  .row input { width: 100%; }
  .seg { display: flex; }
  .seg button { padding: 2px 7px; border-radius: 0; font-size: 12px; white-space: nowrap; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; }
  .chk { display: flex; align-items: center; gap: 4px; font-size: 12px; white-space: nowrap; }
  .tools { display: flex; }
  .tools button { padding: 0 4px; }
  .add { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .add button { font-size: 12px; padding: 3px 8px; }
  .small { font-size: 12px; margin: 0; }
  @media (max-width: 420px) { .body { grid-template-columns: minmax(0, 1fr); } }
</style>
