/**
 * Dragging in the front builder (D73): a front up or down to reorder the
 * stack, the line between two fronts to set their heights. Pure list logic;
 * the component turns pointer positions into millimetres.
 */

/** Smallest front height a drag leaves (editor limit while dragging; the engine checks the real sizes). */
export const DRAG_MIN_H = 30;

/** Position a dragged item would take in the list without it: before the first other item whose middle is below `pos`. */
export function dropSlot(from: number, pos: number, mids: readonly number[]): number {
  const others = mids.filter((_, k) => k !== from);
  const at = others.findIndex((m) => pos < m);
  return at < 0 ? others.length : at;
}

/** Moves item `from` to position `to` of the list without it (in place). Returns false when nothing moved. */
export function moveItem<T>(list: T[], from: number, to: number): boolean {
  if (from < 0 || from >= list.length) return false;
  const at = Math.max(0, Math.min(to, list.length - 1));
  if (at === from) return false;
  list.splice(at, 0, ...list.splice(from, 1));
  return true;
}

/**
 * Height of the upper of two fronts after its lower line moved by `delta` mm (down is positive):
 * whole multiples of `grid`, each front at least `min`, the two together keep their sum.
 */
export function edgeHeight(a0: number, b0: number, delta: number, grid: number, min = DRAG_MIN_H): number {
  const total = a0 + b0;
  const lo = Math.min(min, total / 2);
  const want = Math.round((a0 + delta) / grid) * grid;
  return Math.min(total - lo, Math.max(lo, want));
}

export interface HeightZone {
  h?: number | string;
}

/**
 * Sets the heights of zone i (above) and i + 1 after the line between them moved to `a` / `b`.
 * A zone with a height keeps having one; a "rest" zone (no `h`) stays rest while it is the only
 * rest zone of the stack, because then it takes up the difference by itself.
 */
export function setBoundary(list: HeightZone[], i: number, a: number, b: number): void {
  const up = list[i];
  const low = list[i + 1];
  if (!up || !low) return;
  const rests = list.filter((z) => z.h === undefined).length;
  const upRest = up.h === undefined;
  const lowRest = low.h === undefined;
  if (upRest && lowRest) {
    // Two rest zones share the rest: the upper gets a height; the lower stays rest if no other rest zone is left.
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
}
