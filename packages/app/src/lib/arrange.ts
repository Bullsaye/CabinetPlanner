/**
 * Arranging cabinets in the room plan by drag and drop: the pure part.
 *
 * A cabinet without `place.x` stands in the run of its wall and level
 * (floor units: base and tall; wall units), in project order (D28). Moving
 * it in the plan therefore means moving it in the project's cabinet list
 * and setting `place.wall`; no position is written, so the run stays
 * closed. A cabinet with `place.x` is moved by changing x, with snapping.
 *
 * Nothing here touches the store or the DOM. Lengths are mm; plan
 * coordinates as in the engine (X east, Y north).
 */

export type Vec2 = readonly [number, number];
export type Level = "floor" | "wall";

export interface ArrWall {
  id: string;
  index: number;
  start: Vec2;
  /** Unit direction along the wall. */
  d: Vec2;
  /** Unit normal into the room; by default to the right of `d` (walls run clockwise, D28). */
  n?: Vec2;
  length: number;
  turn: "right" | "left";
}

/** A placed cabinet, as far as arranging needs it. Lists are in project order. */
export interface ArrItem {
  id: string;
  level: Level;
  wall: string;
  /** Explicit position (resolved, mm); undefined = stands in the run. */
  x?: number;
  W: number;
  /** Depth including fronts (the next wall's run starts behind it in a corner, D29). */
  depth: number;
}

export const levelOf = (kind: string | undefined): Level => (kind === "wall" ? "wall" : "floor");

/** Items from the cabinet documents (project order) and the engine's placements. */
export function itemsOf(
  cabinets: readonly { id: string; place?: { wall?: string; x?: unknown } }[],
  placements: readonly { cabinet: string; kind: string; wall: string; x: number; W: number; depth: number }[],
): ArrItem[] {
  const placed = new Map(placements.map((p) => [p.cabinet, p]));
  const out: ArrItem[] = [];
  for (const c of cabinets) {
    const p = placed.get(c.id);
    if (!p) continue;
    out.push({ id: c.id, level: levelOf(p.kind), wall: p.wall, W: p.W, depth: p.depth, ...(c.place?.x !== undefined ? { x: p.x } : {}) });
  }
  return out;
}

/**
 * Positions along the walls, by the engine's rule (layoutRoom): walls in
 * order, cabinets in project order; a run starts behind the deepest unit of
 * its level that reaches the end of the previous wall when that wall turns
 * right into this one; an explicit position pushes the run's end.
 */
export function simulate(walls: readonly ArrWall[], items: readonly ArrItem[]): Map<string, number> {
  const pos = new Map<string, number>();
  const byId = new Map(walls.map((w) => [w.id, w]));
  for (const wall of [...walls].sort((a, b) => a.index - b.index)) {
    for (const level of ["floor", "wall"] as const) {
      let end = runStart(walls, items, pos, wall, level);
      for (const it of items) {
        if (it.wall !== wall.id || it.level !== level || !byId.has(it.wall)) continue;
        const x = it.x ?? end;
        pos.set(it.id, x);
        end = Math.max(end, x + it.W);
      }
    }
  }
  return pos;
}

function runStart(walls: readonly ArrWall[], items: readonly ArrItem[], pos: ReadonlyMap<string, number>, wall: ArrWall, level: Level): number {
  const prev = walls.find((w) => w.index === wall.index - 1);
  if (!prev || prev.turn !== "right") return 0;
  let start = 0;
  for (const it of items) {
    if (it.wall !== prev.id || it.level !== level) continue;
    const x = pos.get(it.id);
    if (x !== undefined && x + it.W >= prev.length - 1) start = Math.max(start, it.depth);
  }
  return start;
}

/** Along the wall (from its start) and the distance to the wall's line, for a plan point. */
export function onWall(wall: ArrWall, p: Vec2): { u: number; dist: number } {
  const rx = p[0] - wall.start[0];
  const ry = p[1] - wall.start[1];
  const u = rx * wall.d[0] + ry * wall.d[1];
  const c = Math.min(wall.length, Math.max(0, u));
  return { u, dist: Math.hypot(rx - wall.d[0] * c, ry - wall.d[1] * c) };
}

/**
 * The wall a dragged cabinet belongs to: the one whose inner face is
 * nearest to the pointer. The current wall is kept until another one is
 * nearer by `hysteresis` (no flicker on the diagonal of a corner), and when
 * the pointer is further than `reach` from every wall.
 *
 * `out`: how far in front of its wall the cabinet is held (the 3D view grabs
 * it at its front or top, not at its foot print). Each wall is then measured
 * from the point `out` behind the pointer, as seen from that wall: where the
 * cabinet's back would be if it stood there. So a cabinet in a corner, held
 * at its front, stays on its wall although its front is nearer to the other.
 */
export function nearestWall(walls: readonly ArrWall[], p: Vec2, current: string, hysteresis = 150, reach = 1500, out = 0): string {
  let best = current;
  let bestDist = Infinity;
  for (const w of walls) {
    const n = w.n ?? [w.d[1], -w.d[0]];
    const q: Vec2 = out ? [p[0] - n[0] * out, p[1] - n[1] * out] : p;
    const dist = onWall(w, q).dist - (w.id === current ? hysteresis : 0);
    if (dist < bestDist) {
      bestDist = dist;
      best = w.id;
    }
  }
  return bestDist > reach ? current : best;
}

/** Where a cabinet goes in the project's cabinet list. `null`: it stays where it is. */
export type Anchor = { before: string } | { after: string } | null;

export interface Insertion {
  /** Number of run cabinets left of the dragged one. */
  index: number;
  anchor: Anchor;
  /** The other cabinets of the run, in order. */
  run: string[];
}

/**
 * Where a cabinet whose left side is dragged to `left` (mm along `wall`)
 * goes into the run of that wall and level. `others` are all placed
 * cabinets except the dragged one.
 *
 * A neighbour stays on the left as long as the dragged cabinet's left side
 * is right of the neighbour's middle. With the neighbour standing on the
 * right (moved over by the dragged width) the same line is where the dragged
 * cabinet's right side meets that neighbour's middle: so "dragged past the
 * middle of the neighbour" swaps the two in both directions, without
 * hysteresis and independent of the path.
 */
export function insertion(walls: readonly ArrWall[], others: readonly ArrItem[], wall: string, level: Level, left: number): Insertion {
  const pos = simulate(walls, others);
  const here = others.filter((it) => it.wall === wall && it.level === level);
  const run = here.filter((it) => it.x === undefined);
  let index = 0;
  for (const it of run) if (pos.get(it.id)! + it.W / 2 < left) index++;
  const ids = run.map((it) => it.id);
  if (index > 0) return { index, anchor: { after: ids[index - 1]! }, run: ids };
  // First in the run: before the first run cabinet; with only fixed ones on the
  // wall, before those, so the run does not start behind them.
  const first = run[0] ?? here[0];
  return { index, anchor: first ? { before: first.id } : null, run: ids };
}

/** The cabinets with one more put in at the anchor (as applyMove does in the project). */
export function withInserted(others: readonly ArrItem[], item: ArrItem, anchor: Anchor): ArrItem[] {
  const list = [...others];
  const ref = anchor ? ("before" in anchor ? anchor.before : anchor.after) : undefined;
  const at = list.findIndex((it) => it.id === ref);
  if (!anchor || at < 0) list.push(item);
  else list.splice("before" in anchor ? at : at + 1, 0, item);
  return list;
}

/** The neighbour to step over when a run cabinet moves one place towards the wall's start (-1) or end (+1). */
export function stepAnchor(items: readonly ArrItem[], id: string, by: -1 | 1): Anchor {
  const me = items.find((it) => it.id === id);
  if (!me || me.x !== undefined) return null;
  const run = items.filter((it) => it.wall === me.wall && it.level === me.level && it.x === undefined);
  const nb = run[run.indexOf(me) + by];
  return nb ? (by < 0 ? { before: nb.id } : { after: nb.id }) : null;
}

/**
 * Moves a cabinet document in the list (in place) next to the anchor and
 * puts it on `wall`. `x` undefined: into the run (no position is kept).
 * Returns whether anything changed.
 */
export function applyMove<T extends { id: string; place?: Record<string, unknown> }>(list: T[], id: string, wall: string, anchor: Anchor, x?: number): boolean {
  const from = list.findIndex((c) => c.id === id);
  if (from < 0) return false;
  const c = list[from]!;
  let changed = false;
  if (c.place?.wall !== wall || c.place?.x !== x) {
    c.place = x === undefined ? { wall } : { wall, x };
    changed = true;
  }
  if (!anchor) return changed;
  const ref = "before" in anchor ? anchor.before : anchor.after;
  const at = list.findIndex((q) => q.id === ref);
  if (at < 0 || at === from) return changed;
  // Index of the cabinet once it is taken out of the list.
  let to = "before" in anchor ? at : at + 1;
  if (from < to) to--;
  if (to === from) return changed;
  list.splice(from, 1);
  list.splice(to, 0, c);
  return true;
}

export interface Snap {
  x: number;
  /** What the cabinet snapped to, if anything. */
  to?: "wall_start" | "wall_end" | "cabinet" | "opening";
  /** Position along the wall of the edge it snapped to (for a guide line). */
  edge?: number;
}

/**
 * Position of a freely placed cabinet dragged to `left`: its left or right
 * side snaps to the wall's ends, to the sides of the other cabinets of its
 * level on that wall (butting, never over them) and to the edges of
 * openings, when within `tol`; the
 * nearest candidate wins, walls and cabinets before openings on a tie.
 * Otherwise x is rounded to `grid` and kept on the wall.
 */
export function snapX(
  left: number,
  W: number,
  wallLength: number,
  cabinets: readonly { x: number; W: number }[],
  openings: readonly { x: number; width: number }[],
  tol: number,
  grid = 5,
): Snap {
  // x for the cabinet's left side, and the edge it meets there. Cabinets butt
  // against each other (left side to a right side and the reverse); the wall's
  // start takes the left side, its end the right side; openings take either.
  const cands: { x: number; at: number; to: NonNullable<Snap["to"]> }[] = [
    { x: 0, at: 0, to: "wall_start" },
    { x: wallLength - W, at: wallLength, to: "wall_end" },
    ...cabinets.flatMap((c) => [
      { x: c.x + c.W, at: c.x + c.W, to: "cabinet" as const },
      { x: c.x - W, at: c.x, to: "cabinet" as const },
    ]),
    ...openings.flatMap((o) => [o.x, o.x + o.width].flatMap((at) => [{ x: at, at, to: "opening" as const }, { x: at - W, at, to: "opening" as const }])),
  ];
  let best: Snap | undefined;
  let bestDist = tol;
  for (const c of cands) {
    // No snap that would put the cabinet past the wall's ends.
    if (wallLength >= W && (c.x < -1e-6 || c.x + W > wallLength + 1e-6)) continue;
    const dist = Math.abs(c.x - left);
    if (dist < bestDist - 1e-9 || (dist <= bestDist && !best)) {
      best = { x: c.x, to: c.to, edge: c.at };
      bestDist = dist;
    }
  }
  if (best) return best;
  const max = Math.max(0, wallLength - W);
  return { x: Math.min(max, Math.max(0, Math.round(left / grid) * grid)) };
}

/**
 * Where a pointer ray of the 3D view meets the horizontal plane at `height`,
 * as a plan point (D28). The scene has plan X as X, up as Y and plan Y
 * (north) as −Z. `null` when the ray runs level, away from the plane or
 * meets it further than `reach` away (a pointer near the horizon).
 */
export function rayToPlan(origin: readonly [number, number, number], dir: readonly [number, number, number], height: number, reach = 60000): Vec2 | null {
  if (Math.abs(dir[1]) < 1e-9) return null;
  const k = (height - origin[1]) / dir[1];
  if (!(k > 0) || k * Math.hypot(dir[0], dir[1], dir[2]) > reach) return null;
  return [origin[0] + dir[0] * k, -(origin[2] + dir[2] * k)];
}
