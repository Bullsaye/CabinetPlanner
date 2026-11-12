import type { HingeSymbol } from "./store.svelte.ts";

/**
 * Opening symbol of a front in a front view (paper coordinates, Y down): two
 * lines forming a triangle. `tip_at_hinge` (DIN): from the corners of the
 * opening edge to the middle of the hinge edge. `tip_at_handle`: from the
 * corners of the hinge edge to the middle of the opening edge. Hinge marks
 * and the handle are drawn besides, so either reading is unambiguous (D68).
 */
export function swingPoints(r: { x: number; y: number; w: number; h: number }, hinge: "left" | "right" | "top", symbol: HingeSymbol): string {
  const pt = (x: number, y: number): string => `${x},${y}`;
  const flip = symbol === "tip_at_handle";
  if (hinge === "top") {
    // Base of the triangle on one horizontal edge, tip in the middle of the other.
    const base = flip ? r.y : r.y + r.h;
    const tip = flip ? r.y + r.h : r.y;
    return [pt(r.x, base), pt(r.x + r.w / 2, tip), pt(r.x + r.w, base)].join(" ");
  }
  const hingeX = hinge === "left" ? r.x : r.x + r.w;
  const openX = hinge === "left" ? r.x + r.w : r.x;
  const base = flip ? hingeX : openX;
  const tip = flip ? openX : hingeX;
  return [pt(base, r.y), pt(tip, r.y + r.h / 2), pt(base, r.y + r.h)].join(" ");
}
