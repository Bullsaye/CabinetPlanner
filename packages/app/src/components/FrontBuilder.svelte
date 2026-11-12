<script lang="ts">
  import { formatNumber, frontViewOf, layoutFronts } from "@cabinet-planner/engine";
  import { swingPoints } from "../lib/elevation.ts";
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

  /** Hinges and handles as the engine drilled them (D54), so the opening direction is plain to see. */
  const fv = $derived(store.cabinet?.parts.length ? frontViewOf(store.cabinet) : undefined);
  const doorOf = (id: string) => fv?.parts.find((p) => p.id === id);

  // --- Dragging (D59): a front up or down to reorder, the line between two fronts to set heights.
  const MIN_H = 30;
  /** Moves zone `from` to position `to` of the list without it. */
  function moveZone(from: number, to: number): void {
    if (to === from) return;
    edit((l) => l.splice(to, 0, ...l.splice(from, 1)));
    store.ui.zone = to;
  }
  /** Position a dragged zone would take: before the first other zone whose middle is below `pos`. */
  function slot(from: number, pos: number, mids: number[]): number {
    const others = mids.filter((_, k) => k !== from);
    const at = others.findIndex((m) => pos < m);
    return at < 0 ? others.length : at;
  }

  type Drag =
    | { kind: "zone"; i: number; y0: number; dy: number; to: number; moved: boolean }
    | { kind: "edge"; i: number; y0: number; a0: number; b0: number; a: number; grid: number };
  let drag = $state<Drag | null>(null);
  let svgEl = $state<SVGSVGElement>();
  /** Pointer position in the drawing, mm below the top of the carcase. */
  const mmAt = (e: PointerEvent): number => (e.clientY - (svgEl?.getBoundingClientRect().top ?? 0) - 4) / s;

  function zoneDown(e: PointerEvent, i: number): void {
    if (e.button > 0) return;
    svgEl?.setPointerCapture(e.pointerId);
    drag = { kind: "zone", i, y0: e.clientY, dy: 0, to: i, moved: false };
  }
  function edgeDown(e: PointerEvent, i: number): void {
    const a = placed[i];
    const b = placed[i + 1];
    if (e.button > 0 || !a || !b) return;
    e.stopPropagation();
    svgEl?.setPointerCapture(e.pointerId);
    store.historyHold = true;
    drag = { kind: "edge", i, y0: e.clientY, a0: a.y1 - a.y0, b0: b.y1 - b.y0, a: a.y1 - a.y0, grid: 1 };
  }
  function dragMove(e: PointerEvent): void {
    const d = drag;
    if (!d) return;
    if (d.kind === "zone") {
      d.dy = e.clientY - d.y0;
      if (Math.abs(d.dy) > 5) d.moved = true;
      if (d.moved) d.to = slot(d.i, mmAt(e), placed.map((p) => H - (p.y0 + p.y1) / 2));
      return;
    }
    // Heights in whole millimetres; Shift, or a finger, keeps to the 5 mm grid.
    d.grid = e.shiftKey || e.pointerType !== "mouse" ? 5 : 1;
    const total = d.a0 + d.b0;
    const want = d.a0 + (e.clientY - d.y0) / s;
    const a = Math.min(total - MIN_H, Math.max(MIN_H, Math.round(want / d.grid) * d.grid));
    if (a === d.a) return;
    d.a = a;
    setBoundary(d.i, a, total - a);
  }
  /**
   * Heights after the line between zone i (above) and i + 1 moved. A zone with a height keeps having one;
   * a "rest" zone stays rest while it can take up the difference: when it is the only rest zone of the stack.
   */
  function setBoundary(i: number, a: number, b: number): void {
    edit((l) => {
      const up = l[i]!;
      const low = l[i + 1]!;
      const rests = l.filter((z) => z.h === undefined).length;
      const upRest = up.h === undefined;
      const lowRest = low.h === undefined;
      if (upRest && lowRest) {
        up.h = a;
        if (rests > 2) low.h = b;
      } else if (upRest) {
        low.h = b;
        if (rests > 1) up.h = a;
      } else if (lowRest) {
        up.h = a;
        if (rests > 1) low.h = b;
      } else {
        up.h = a;
        low.h = b;
      }
    });
  }
  function dragEnd(e: PointerEvent): void {
    const d = drag;
    drag = null;
    if (!d) return;
    if (svgEl?.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId);
    if (d.kind === "edge") {
      store.historyHold = false;
      store.record();
    } else if (e.type === "pointercancel") return;
    else if (d.moved) moveZone(d.i, d.to);
    else store.ui.zone = d.i;
  }
  /** Where the dragged zone would go: Y of the insertion line in the drawing. */
  const dropY = $derived.by(() => {
    if (drag?.kind !== "zone" || !drag.moved) return null;
    const others = placed.filter((_, k) => k !== drag!.i);
    if (!others.length) return null;
    const p = drag.to < others.length ? others[drag.to]! : others[others.length - 1]!;
    return (H - (drag.to < others.length ? p.y1 : p.y0)) * s;
  });

  // The same in the list: a row dragged by its grip.
  let rowDrag = $state<{ i: number; to: number } | null>(null);
  function rowDown(e: PointerEvent, i: number): void {
    if (e.button > 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    rowDrag = { i, to: i };
  }
  function rowMove(e: PointerEvent): void {
    if (!rowDrag || !rowsEl) return;
    const mids = [...rowsEl.querySelectorAll<HTMLElement>("[data-zone]")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    rowDrag.to = slot(rowDrag.i, e.clientY, mids);
  }
  function rowEnd(e: PointerEvent): void {
    const d = rowDrag;
    rowDrag = null;
    if (d && e.type !== "pointercancel") moveZone(d.i, d.to);
  }
  /** Row the insertion line is drawn at, and on which side. */
  const rowDrop = $derived.by(() => {
    if (!rowDrag || rowDrag.to === rowDrag.i) return null;
    const others = zones.map((_, k) => k).filter((k) => k !== rowDrag!.i);
    return rowDrag.to < others.length ? { row: others[rowDrag.to]!, side: "before" } : { row: others[others.length - 1]!, side: "after" };
  });
  const resolvedH = (i: number): string => (placed[i] ? formatNumber(placed[i]!.y1 - placed[i]!.y0) : "");

  // A zone picked in a drawing: bring its row into view.
  let rowsEl = $state<HTMLDivElement>();
  $effect(() => {
    const z = store.ui.zone;
    if (z === null || !rowsEl) return;
    rowsEl.querySelector(`[data-zone="${z}"]`)?.scrollIntoView({ block: "nearest" });
  });
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
        <svg
          class="preview"
          class:dragging={drag !== null}
          bind:this={svgEl}
          viewBox={`-4 -4 ${W * s + 8} ${H * s + 8}`}
          width={W * s + 8}
          height={H * s + 8}
          role="img"
          aria-label={t("ui.front_preview")}
          onpointermove={dragMove}
          onpointerup={dragEnd}
          onpointercancel={dragEnd}
        >
          <rect class="carcase" x="0" y="0" width={W * s} height={H * s} />
          {#each placed as p, i}
            {#each rects(i) as r}
              {@const y = (H - p.y1) * s}
              {@const h = (p.y1 - p.y0) * s}
              {#if zones[i]?.type === "open" || (zones[i]?.type === "appliance" && !zones[i]?.front)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect class="hole" data-front={i} x={r.x * s} {y} width={r.w * s} height={h} onpointerdown={(e) => zoneDown(e, i)} />
              {:else}
                <!-- A tap picks the zone; dragged up or down it changes places (D59). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect
                  class="front {zones[i]?.type}"
                  class:on={store.ui.zone === i}
                  class:lifted={drag?.kind === "zone" && drag.i === i && drag.moved}
                  data-front={i}
                  x={r.x * s}
                  {y}
                  width={r.w * s}
                  height={h}
                  transform={drag?.kind === "zone" && drag.i === i && drag.moved ? `translate(0 ${drag.dy})` : undefined}
                  onpointerdown={(e) => zoneDown(e, i)}
                />
                {#if r.hinge}
                  <!-- Opening symbol: tip at the hinge edge or at the handle edge (preference). -->
                  <polyline class="swing" points={swingPoints({ x: r.x * s, y, w: r.w * s, h }, r.hinge, store.ui.hingeSymbol)} />
                {/if}
                {#if zones[i]?.type === "flap"}
                  <polyline class="swing" points={swingPoints({ x: r.x * s, y, w: r.w * s, h }, "top", store.ui.hingeSymbol)} />
                {/if}
              {/if}
            {/each}
            <text class="h" x={gl * s + 6} y={(H - (p.y0 + p.y1) / 2) * s + 3}>{formatNumber(p.y1 - p.y0)}</text>
          {/each}
          {#if dropY !== null}<line class="drop" x1="-2" x2={W * s + 2} y1={dropY} y2={dropY} />{/if}
          <!-- The line between two fronts: drag it to set their heights. -->
          {#each placed as p, i}
            {#if i < placed.length - 1}
              {@const yb = (H - (p.y0 + placed[i + 1]!.y1) / 2) * s}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <g class="edge" class:on={drag?.kind === "edge" && drag.i === i} data-edge={i} onpointerdown={(e) => edgeDown(e, i)}>
                <title>{t("ui.fb.drag_height")}</title>
                <rect class="hit" x="0" y={yb - 7} width={W * s} height="14" />
                <line x1={W * s * 0.5 - 12} x2={W * s * 0.5 + 12} y1={yb} y2={yb} />
              </g>
            {/if}
          {/each}
          {#if fv && !drag}
            {#each fv.hinges as hg}
              {@const d = doorOf(hg.part)}
              {#if d && hg.edge === "top"}
                <rect class="mark" x={hg.x * s - 3.5} y={(H - d.y - d.h) * s} width="7" height="2.5" />
              {:else if d}
                <rect class="mark" x={hg.edge === "left" ? d.x * s : (d.x + d.w) * s - 2.5} y={(H - hg.y) * s - 3.5} width="2.5" height="7" />
              {/if}
            {/each}
            {#each fv.handles as hd}
              {#if hd.kind === "knob"}
                <circle class="mark" cx={hd.x1 * s} cy={(H - hd.y1) * s} r="2.2" />
              {:else}
                <line class="grip" x1={hd.x1 * s} y1={(H - hd.y1) * s} x2={hd.x2 * s} y2={(H - hd.y2) * s} />
              {/if}
            {/each}
          {/if}
        </svg>
      {/if}
      <div class="rows" bind:this={rowsEl}>
        {#each zones as z, i}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="row"
            class:on={store.ui.zone === i}
            class:lifted={rowDrag?.i === i}
            class:drop-before={rowDrop?.row === i && rowDrop.side === "before"}
            class:drop-after={rowDrop?.row === i && rowDrop.side === "after"}
            data-zone={i}
            onfocusin={() => (store.ui.zone = i)}
          >
            <button class="quiet rowgrip" tabindex="-1" title={t("ui.fb.drag_row")} aria-label={t("ui.fb.drag_row")} onpointerdown={(e) => rowDown(e, i)} onpointermove={rowMove} onpointerup={rowEnd} onpointercancel={rowEnd}>⠿</button>
            <select id={`fz-type-${i}`} aria-label={t("ui.front_type")} value={z.type} onchange={(e) => edit((l) => (l[i]!.type = (e.target as HTMLSelectElement).value))}>
              {#each TYPES as ty}<option value={ty}>{t(`ui.zone.${ty}`)}</option>{/each}
            </select>
            <label class="hl" for={`fz-h-${i}`}>{t("ui.fb.height")}</label>
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
            <span class="hres mono" title={t("ui.fb.height_now")}>{typeof z.h === "number" && formatNumber(z.h) === resolvedH(i) ? "mm" : `= ${resolvedH(i)}`}</span>
            {#if z.type === "door"}
              <div class="seg" role="group" aria-label={t("ui.opening")}>
                {#each ["left", "pair", "right"] as m}
                  <button aria-pressed={doorMode(z) === m} title={t(`ui.door_mode.${m}`)} onclick={() => setDoorMode(i, m as "left")}>{t(`ui.door_mode_short.${m}`)}</button>
                {/each}
              </div>
            {:else if z.type === "appliance"}
              <label class="chk"><input type="checkbox" checked={z.front ?? false} onchange={(e) => edit((l) => (l[i]!.front = (e.target as HTMLInputElement).checked))} /> {t("ui.appliance_front")}</label>
            {/if}
            <span class="tools">
              <button class="quiet" aria-label={t("ui.move_up")} disabled={i === 0} onclick={() => edit((l) => l.splice(i - 1, 0, ...l.splice(i, 1)))}>↑</button>
              <button class="quiet" aria-label={t("ui.move_down")} disabled={i === zones.length - 1} onclick={() => edit((l) => l.splice(i + 1, 0, ...l.splice(i, 1)))}>↓</button>
              <button class="quiet" aria-label={t("ui.delete")} onclick={() => edit((l) => l.splice(i, 1))}>×</button>
            </span>
          </div>
        {/each}
        {#if !zones.length}<p class="muted small">{t("ui.no_fronts")}</p>{:else}<p class="muted small">{t("ui.fb.height_hint")} {zones.length > 1 ? t("ui.fb.drag_hint") : ""}</p>{/if}
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
  /* The rows go below the drawing when the pane is too narrow for both. */
  .body { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
  .preview { flex: none; }
  .preview { display: block; }
  .carcase { fill: var(--surface-2); stroke: var(--part-edge); stroke-width: 1; }
  .front { fill: color-mix(in srgb, var(--surface) 75%, var(--accent)); stroke: var(--fg); stroke-width: .8; }
  .front.drawer { fill: color-mix(in srgb, var(--surface) 82%, var(--accent)); }
  .front.panel, .front.appliance { fill: color-mix(in srgb, var(--surface) 88%, var(--fg)); }
  .hole { fill: var(--view); stroke: var(--part-edge); stroke-width: .6; stroke-dasharray: 3 2; }
  .swing { fill: none; stroke: var(--muted); stroke-width: .8; stroke-dasharray: 4 2; }
  .preview { touch-action: none; user-select: none; -webkit-user-select: none; }
  .front { cursor: grab; }
  .preview.dragging .front { cursor: grabbing; }
  .front.lifted { opacity: .75; stroke: var(--accent); stroke-width: 2; }
  .drop { stroke: var(--accent); stroke-width: 3; stroke-linecap: round; pointer-events: none; }
  .edge { cursor: ns-resize; }
  .edge .hit { fill: transparent; }
  .edge line { stroke: var(--fg); stroke-width: 3; stroke-linecap: round; opacity: .55; pointer-events: none; }
  .edge:hover line, .edge.on line { stroke: var(--accent); opacity: 1; stroke-width: 4; }
  .front.on { stroke: var(--accent); stroke-width: 2; }
  .mark { fill: var(--fg); pointer-events: none; }
  .grip { stroke: var(--fg); stroke-width: 2.2; stroke-linecap: round; pointer-events: none; }
  .h { font: 9px var(--font-mono); fill: var(--fg); pointer-events: none; paint-order: stroke; stroke: var(--surface); stroke-width: 2.5; stroke-linejoin: round; }
  .row.on { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
  .rows { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 250px; }
  /* A row wraps when the pane is narrow, so one more field per zone finds room. */
  .row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 1px 0; border-radius: 6px; }
  .row select { flex: 1 1 84px; min-width: 84px; }
  .row input[type="text"] { width: 58px; flex: none; }
  .row .tools { margin-left: auto; }
  .hl { font-size: 12px; color: var(--muted); }
  .hres { font-size: 11px; color: var(--muted); min-width: 34px; }
  .rowgrip { cursor: grab; touch-action: none; padding: 0 3px; color: var(--muted); font-size: 15px; line-height: 1; align-self: stretch; }
  .row.lifted { opacity: .55; background: var(--accent-soft); }
  .row.drop-before { box-shadow: 0 -3px 0 -1px var(--accent); }
  .row.drop-after { box-shadow: 0 3px 0 -1px var(--accent); }
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
</style>
