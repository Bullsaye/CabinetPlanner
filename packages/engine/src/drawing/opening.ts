/**
 * Opening symbol of a hinged front in a front elevation (D68, D73, D78): two
 * lines forming an open triangle between the hinge edge and the opposite
 * (opening, handle) edge. `tip_at_handle` (default): from the corners of the
 * hinge edge to the middle of the opening edge, as on German window
 * elevations and European kitchen plans. `tip_at_hinge`: from the corners of
 * the opening edge to the middle of the hinge edge, as in US practice. Lift-up
 * flaps turn on their top edge, so with the tip at the handle the triangle
 * points down. Drawers, fixed panels and open zones get no symbol.
 *
 * Paper coordinates, Y down; `r` is the front's rectangle on paper.
 */
export type OpeningSymbol = "tip_at_handle" | "tip_at_hinge";

export function openingSymbolPoints(
  r: { x: number; y: number; w: number; h: number },
  hinge: "left" | "right" | "top",
  symbol: OpeningSymbol = "tip_at_handle",
): [number, number][] {
  const atHandle = symbol === "tip_at_handle";
  if (hinge === "top") {
    // Base on one horizontal edge, tip in the middle of the other.
    const base = atHandle ? r.y : r.y + r.h;
    const tip = atHandle ? r.y + r.h : r.y;
    return [[r.x, base], [r.x + r.w / 2, tip], [r.x + r.w, base]];
  }
  const hingeX = hinge === "left" ? r.x : r.x + r.w;
  const openX = hinge === "left" ? r.x + r.w : r.x;
  const base = atHandle ? hingeX : openX;
  const tip = atHandle ? openX : hingeX;
  return [[base, r.y], [tip, r.y + r.h / 2], [base, r.y + r.h]];
}
