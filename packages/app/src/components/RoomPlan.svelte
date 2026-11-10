<script lang="ts">
  /**
   * The floor plan with cabinets that can be grabbed and dragged. The drawing
   * is the engine's floor plan (as on the drawing sheets); the shapes to grab,
   * the selection and the dragged cabinet are drawn over it in the same
   * coordinates and viewBox (floorPlanFrame), so they fit at any size.
   */
  import { drawingText, floorPlanFrame, floorPlanSvg, type CabinetPlacement, type WallLayout } from "@cabinet-planner/engine";
  import { applyMove, insertion, itemsOf, levelOf, nearestWall, onWall, simulate, snapX, stepAnchor, withInserted, type Anchor, type ArrItem, type Level } from "../lib/arrange.ts";
  import { store } from "../lib/store.svelte.ts";

  type Doc = Record<string, any>;
  const t = $derived(store.tr.t);
  const layout = $derived(store.result?.room);
  const frame = $derived(layout ? floorPlanFrame(layout) : undefined);
  /** Zoomed to the room: the sheet's title and margins are for paper. */
  const viewBox = $derived(frame ? frame.view.map((v) => Math.round(v * 1000) / 1000).join(" ") : "");
  const plan = $derived(
    layout && store.result
      ? floorPlanSvg(layout, store.project.name, drawingText(store.tr, store.result.library), false).replace(/viewBox="[^"]*" width="[^"]*" height="[^"]*"/, `viewBox="${viewBox}"`)
      : "",
  );
  const docs = (): Doc[] => (store.project.cabinets ?? []) as Doc[];
  const wallOf = (id: string): WallLayout | undefined => layout?.walls.find((w) => w.id === id);
  const placed = (id: string | null): CabinetPlacement | undefined => layout?.placements.find((p) => p.cabinet === id);
  const isFree = (id: string): boolean => docs().find((c) => c.id === id)?.place?.x !== undefined;
  const num = (x: number): string => store.tr.number(Math.round(x * 10) / 10, 1);

  /** Paper points of a rectangle standing on a wall: from x along it, v0..v1 into the room. */
  function rect(w: { start: readonly [number, number]; d: readonly [number, number]; n: readonly [number, number] }, x: number, W: number, v0: number, v1: number): string {
    if (!frame) return "";
    const at = (u: number, v: number): string => frame.toPaper(w.start[0] + w.d[0] * u + w.n[0] * v, w.start[1] + w.d[1] * u + w.n[1] * v).map((c) => Math.round(c * 1000) / 1000).join(",");
    return [at(x, v0), at(x + W, v0), at(x + W, v1), at(x, v1)].join(" ");
  }

  /**
   * Shapes to grab, floor units below wall units. A wall unit hangs over the
   * rear of the floor units: there it takes only the rear half of its depth,
   * so both can be grabbed. The selected cabinet lies on top in full.
   */
  const shapes = $derived.by(() => {
    if (!layout) return [];
    const list = [...layout.placements].sort((a, b) => (a.kind === "wall" ? 1 : 0) - (b.kind === "wall" ? 1 : 0) || (a.cabinet < b.cabinet ? -1 : 1));
    return list.flatMap((q) => {
      const w = wallOf(q.wall);
      if (!w) return [];
      const over = q.kind === "wall" && layout.placements.some((o) => o.kind !== "wall" && o.wall === q.wall && o.x < q.x + q.W - 1 && q.x < o.x + o.W - 1);
      return [{ id: q.cabinet, points: rect(w, q.x, q.W, 0, over ? q.depth / 2 : q.depth), full: rect(w, q.x, q.W, 0, q.depth) }];
    });
  });
  const selected = $derived(shapes.find((s) => s.id === store.ui.selected));

  // --- Dragging -------------------------------------------------------------

  interface Drag {
    id: string;
    pointerId: number;
    touch: boolean;
    sx: number;
    sy: number;
    started: boolean;
    view: View;
    /** From the cabinet's left side to the pointer, along the wall. */
    grab: number;
    W: number;
    depth: number;
    level: Level;
    free: boolean;
    snapshot: string;
    others: ArrItem[];
    wall: string;
    /** Run: the place shown, the place written to the project, and where it was grabbed. */
    applied: string;
    written: string;
    initial: string;
    /** Free: the position last written. */
    x?: number;
    cx: number;
    cy: number;
  }
  let drag: Drag | null = null;
  let host = $state<HTMLDivElement>();
  let over = $state<SVGSVGElement>();
  let dragging = $state(false);
  let drag_id = $state<string | null>(null);
  let ghost = $state<{ points: string; label?: { x: number; y: number; text: string }; guide?: string } | null>(null);
  /** Cabinets shown at their place to be, while the project is not rebuilt during the drag. */
  let preview = $state<{ id: string; from: string; to: string; cx: number; cy: number }[]>([]);
  let raf = 0;

  /**
   * How the others make room while dragging: the project is changed and
   * rebuilt at once when that is quick (the plan itself shows the result,
   * worktops and dimensions included). A large kitchen takes longer than a
   * frame or two: then the places are worked out here (arrange.simulate) and
   * drawn over the plan, and the project changes once, on drop.
   */
  const LIVE_MAX_MS = 60;
  let buildMs = 0;
  function rebuild(): void {
    const t0 = performance.now();
    void store.result;
    buildMs = performance.now() - t0;
  }

  /**
   * Screen → plan mm. A drag keeps the mapping it started with: when the page
   * moves under the pointer (a line of checks appears, the header wraps), the
   * cabinet must not jump, and its new place must not move the page again.
   */
  interface View {
    inv: DOMMatrix;
    mmPerPx: number;
    toPlan(px: number, py: number): [number, number];
  }
  function view(): View | undefined {
    const m = over?.getScreenCTM();
    return m && frame ? { inv: m.inverse(), mmPerPx: frame.den / m.a, toPlan: frame.toPlan } : undefined;
  }
  function toPlan(v: View, cx: number, cy: number): [number, number] {
    const pt = new DOMPoint(cx, cy).matrixTransform(v.inv);
    return v.toPlan(pt.x, pt.y);
  }

  function down(e: PointerEvent): void {
    if (drag || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const id = (e.target as Element | null)?.closest?.("[data-cab]")?.getAttribute("data-cab");
    const q = placed(id ?? null);
    const w = q && wallOf(q.wall);
    const v = view();
    if (!id || !q || !w || !v) return;
    host?.setPointerCapture(e.pointerId);
    drag = {
      id,
      pointerId: e.pointerId,
      touch: e.pointerType === "touch",
      sx: e.clientX,
      sy: e.clientY,
      started: false,
      view: v,
      grab: onWall(w, toPlan(v, e.clientX, e.clientY)).u - q.x,
      W: q.W,
      depth: q.depth,
      level: levelOf(q.kind),
      free: isFree(id),
      snapshot: "",
      others: [],
      wall: w.id,
      applied: "",
      written: "",
      initial: "",
      cx: e.clientX,
      cy: e.clientY,
    };
  }

  function begin(d: Drag): void {
    // What was edited before the drag stays its own undo step; the drag becomes one.
    store.record();
    store.historyHold = true;
    d.snapshot = JSON.stringify($state.snapshot(store.project));
    d.started = true;
    dragging = true;
    drag_id = d.id;
    store.ui.selected = d.id;
    if (!d.free && layout) {
      d.others = itemsOf(docs(), layout.placements).filter((it) => it.id !== d.id);
      const q = placed(d.id)!;
      d.initial = d.applied = d.written = key(d.wall, insertion(layout.walls, d.others, d.wall, d.level, q.x).anchor);
    }
  }
  const key = (wall: string, anchor: unknown): string => `${wall}|${JSON.stringify(anchor)}`;

  function move(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    if (!d.started) {
      // A tap selects: the drag starts after a few pixels (more for a finger).
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < (d.touch ? 10 : 5)) return;
      begin(d);
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(false); });
  }

  /** Follows the pointer: the ghost always, the project when the place changes. */
  function update(final: boolean): void {
    const d = drag;
    if (!d || !d.started || !layout) return;
    const p = toPlan(d.view, d.cx, d.cy);
    const w = wallOf(nearestWall(layout.walls, p, d.wall)) ?? wallOf(d.wall);
    if (!w) return;
    d.wall = w.id;
    const left = onWall(w, p).u - d.grab;
    if (d.free) {
      const others = layout.placements.filter((q) => q.wall === w.id && levelOf(q.kind) === d.level && q.cabinet !== d.id);
      const s = snapX(left, d.W, w.length, others, layout.openings.filter((o) => o.wall === w.id), (d.touch ? 16 : 10) * d.view.mmPerPx);
      const [lx, ly] = frame!.toPaper(w.start[0] + w.d[0] * (s.x + d.W / 2) + w.n[0] * d.depth / 2, w.start[1] + w.d[1] * (s.x + d.W / 2) + w.n[1] * d.depth / 2);
      ghost = {
        points: rect(w, s.x, d.W, 0, d.depth),
        label: { x: lx, y: ly, text: num(s.x) },
        ...(s.edge !== undefined ? { guide: rect(w, s.edge, 0, -w.thickness, Math.max(d.depth, 600) + 150) } : {}),
      };
      // A free position changes with every frame: live only when a build fits into one.
      if ((final || buildMs <= LIVE_MAX_MS / 3) && (d.x !== s.x || placed(d.id)?.wall !== w.id)) {
        d.x = s.x;
        applyMove(docs(), d.id, w.id, null, s.x);
        rebuild();
      }
    } else {
      const ins = insertion(layout.walls, d.others, w.id, d.level, left);
      const k = key(w.id, ins.anchor);
      const live = final || buildMs <= LIVE_MAX_MS;
      if (live ? k !== d.written : k !== d.applied) {
        d.applied = k;
        if (live) {
          d.written = k;
          preview = [];
          applyMove(docs(), d.id, w.id, ins.anchor);
          rebuild();
        } else preview = k === d.written ? [] : previewOf(d, w.id, ins.anchor);
      }
      ghost = { points: rect(w, Math.min(Math.max(0, w.length - d.W), Math.max(0, left)), d.W, 0, d.depth) };
    }
  }

  /** Where the cabinets of the dragged one's level would stand, for those that move. */
  function previewOf(d: Drag, wall: string, anchor: Anchor): typeof preview {
    if (!layout || !frame) return [];
    const list = withInserted(d.others, { id: d.id, level: d.level, wall, W: d.W, depth: d.depth }, anchor);
    const pos = simulate(layout.walls, list);
    const out: typeof preview = [];
    for (const it of list) {
      const now = placed(it.id);
      const x = pos.get(it.id);
      const w = wallOf(it.wall);
      const w0 = now && wallOf(now.wall);
      if (!now || !w || !w0 || x === undefined || (now.wall === it.wall && Math.abs(now.x - x) < 0.01)) continue;
      const [cx, cy] = frame.toPaper(w.start[0] + w.d[0] * (x + it.W / 2) + (w.n[0] * it.depth) / 2, w.start[1] + w.d[1] * (x + it.W / 2) + (w.n[1] * it.depth) / 2);
      out.push({ id: it.id, from: rect(w0, now.x, now.W, 0, now.depth), to: rect(w, x, it.W, 0, it.depth), cx, cy });
    }
    return out;
  }

  function finish(cancel: boolean): void {
    const d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(raf);
    raf = 0;
    if (host?.hasPointerCapture(d.pointerId)) host.releasePointerCapture(d.pointerId);
    ghost = null;
    preview = [];
    dragging = false;
    if (!d.started) {
      if (!cancel) store.ui.selected = d.id;
      return;
    }
    // Cancelled, or dropped where it was grabbed: exactly the state before the drag.
    if ((cancel || (!d.free && d.written === d.initial)) && JSON.stringify($state.snapshot(store.project)) !== d.snapshot) {
      store.project = JSON.parse(d.snapshot);
    }
    store.historyHold = false;
    store.record();
  }

  function up(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    update(true);
    finish(false);
  }
  function cancelled(e: PointerEvent): void {
    if (drag && e.pointerId === drag.pointerId) finish(true);
  }
  function windowKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && drag) {
      e.preventDefault();
      finish(true);
    }
  }

  // --- Buttons and keys -----------------------------------------------------

  const items = $derived(layout ? itemsOf(docs(), layout.placements) : []);
  const sel = $derived(items.find((it) => it.id === store.ui.selected));
  const selRun = $derived(sel && sel.x === undefined ? items.filter((it) => it.wall === sel.wall && it.level === sel.level && it.x === undefined) : []);
  const canStep = (by: -1 | 1): boolean => !!sel && (sel.x !== undefined || stepAnchor(items, sel.id, by) !== null);

  /** One place along the run (or 10 mm for a fixed position) towards the wall's start (-1) or end (+1). */
  function step(id: string, by: -1 | 1): void {
    const me = items.find((it) => it.id === id);
    if (!me) return;
    if (me.x !== undefined) applyMove(docs(), id, me.wall, null, Math.round(me.x + by * 10));
    else {
      const anchor = stepAnchor(items, id, by);
      if (anchor) applyMove(docs(), id, me.wall, anchor);
    }
  }
  /** Arrow for a step along a wall as it lies in the plan. */
  function arrow(wall: string, by: -1 | 1): string {
    const w = wallOf(wall);
    if (!w) return by < 0 ? "←" : "→";
    const dx = w.d[0] * by;
    const dy = -w.d[1] * by; // paper Y points down
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "←" : "→") : dy < 0 ? "↑" : "↓";
  }
  function shapeKey(e: KeyboardEvent, id: string): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      store.ui.selected = id;
      return;
    }
    const q = placed(id);
    const by = ([-1, 1] as const).find((b) => q && `Arrow${{ "←": "Left", "→": "Right", "↑": "Up", "↓": "Down" }[arrow(q.wall, b)]}` === e.key);
    if (!by) return;
    e.preventDefault();
    store.ui.selected = id;
    step(id, by);
  }
</script>

<svelte:window onkeydown={windowKey} />

<div class="rp">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sheet stack" class:dragging bind:this={host} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancelled}>
    <div class="draw">{@html plan}</div>
    {#if frame}
      <svg class="over" bind:this={over} {viewBox}>
        {#each shapes as s (s.id)}
          <polygon
            class="hit"
            data-cab={s.id}
            points={s.points}
            tabindex="0"
            role="button"
            aria-label={t("ui.arrange_cabinet", { id: s.id })}
            aria-pressed={store.ui.selected === s.id}
            onkeydown={(e) => shapeKey(e, s.id)}
          ><title>{s.id}</title></polygon>
        {/each}
        {#if selected}
          <polygon class="hit sel" class:slot={dragging} data-cab={selected.id} points={selected.full} aria-hidden="true" />
        {/if}
        {#each preview as m (m.id)}<polygon class="veil" points={m.from} />{/each}
        {#each preview as m (m.id)}
          <polygon class="pre" class:slot={m.id === drag_id} points={m.to} />
          <text class="pre-id" x={m.cx} y={m.cy} text-anchor="middle" dominant-baseline="central">{m.id}</text>
        {/each}
        {#if ghost}
          {#if ghost.guide}<polygon class="guide" points={ghost.guide} />{/if}
          <polygon class="ghost" points={ghost.points} />
          {#if ghost.label}
            <text class="xlabel" x={ghost.label.x} y={ghost.label.y} text-anchor="middle" dominant-baseline="central">{ghost.label.text}</text>
          {/if}
        {/if}
      </svg>
    {/if}
  </div>
  <div class="bar">
    {#if sel}
      <span class="mono id">{sel.id}</span>
      <!-- In the order the arrows point in the plan: ← before →, ↑ before ↓. -->
      {#each "←↑".includes(arrow(sel.wall, -1)) ? ([-1, 1] as const) : ([1, -1] as const) as by (by)}
        {@const label = t(by < 0 ? "ui.arrange_towards_start" : "ui.arrange_towards_end")}
        <button class="step" title={label} aria-label={label} disabled={!canStep(by)} onclick={() => step(sel.id, by)}>{arrow(sel.wall, by)}</button>
      {/each}
      <span class="muted small" aria-live="polite">
        {sel.x !== undefined
          ? t("ui.arrange_free", { wall: sel.wall, x: num(sel.x) })
          : t("ui.arrange_in_run", { wall: sel.wall, n: selRun.indexOf(sel) + 1, of: selRun.length })}
      </span>
    {:else}
      <span class="muted small">{t("ui.arrange_none")}</span>
    {/if}
  </div>
  <p class="hint muted">{t("ui.arrange_hint")}</p>
</div>

<style>
  .rp { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .stack { display: grid; min-width: 0; user-select: none; -webkit-user-select: none; }
  .stack > * { grid-area: 1 / 1; min-width: 0; }
  /* Both SVGs take the same box (app.css .sheet svg) and the same viewBox. */
  .stack :global(svg) { max-height: 70vh; }
  /* Only the cabinets take the pointer: a finger beside them scrolls the page as usual.
     touch-action sits on the SVG root (browsers ignore it on shapes); it counts for touches that start on a cabinet. */
  .over { pointer-events: none; overflow: visible; touch-action: none; }
  .hit { fill: transparent; stroke: none; pointer-events: all; cursor: grab; touch-action: none; outline: none; }
  .hit:hover { fill: color-mix(in srgb, var(--accent) 12%, transparent); }
  .hit:focus-visible { stroke: var(--accent); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; }
  .hit.sel { fill: color-mix(in srgb, var(--accent) 18%, transparent); stroke: var(--accent); stroke-width: 0.7; }
  .hit.sel.slot { fill: none; stroke-dasharray: 2 1.2; }
  .dragging, .dragging .hit { cursor: grabbing; }
  .veil { fill: var(--surface); fill-opacity: 0.85; pointer-events: none; }
  .pre { fill: color-mix(in srgb, var(--accent) 10%, var(--surface)); stroke: var(--accent); stroke-width: 0.35; pointer-events: none; }
  .pre.slot { stroke-width: 0.7; stroke-dasharray: 2 1.2; }
  .pre-id { font: 600 2.4px var(--font-mono); fill: var(--fg); pointer-events: none; }
  .ghost { fill: color-mix(in srgb, var(--accent) 30%, transparent); stroke: var(--accent); stroke-width: 0.5; pointer-events: none; }
  .guide { fill: none; stroke: var(--err); stroke-width: 0.35; stroke-dasharray: 1.5 1; pointer-events: none; }
  .xlabel { font: 600 3.2px var(--font-mono); fill: #1b1f24; paint-order: stroke; stroke: #fff; stroke-width: 0.9; pointer-events: none; }
  .bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; min-height: 36px; }
  .id { font-weight: 600; }
  .step { min-width: 40px; min-height: 36px; font-size: 16px; line-height: 1; }
  .hint { margin: 0; font-size: 12px; }
  .small { font-size: 12px; }
</style>
