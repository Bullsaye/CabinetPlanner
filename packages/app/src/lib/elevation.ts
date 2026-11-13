import { openingSymbolPoints } from "@cabinet-planner/engine";
import type { HingeSymbol } from "./store.svelte.ts";

/**
 * Opening symbol of a front in the app's front views (paper coordinates, Y
 * down) as SVG polyline points. The geometry is the engine's
 * (`openingSymbolPoints`), so the app and the wall elevation sheets draw the
 * same triangle (D68, D73, D78). Hinge marks and the handle are drawn besides.
 */
export function swingPoints(r: { x: number; y: number; w: number; h: number }, hinge: "left" | "right" | "top", symbol: HingeSymbol): string {
  return openingSymbolPoints(r, hinge, symbol)
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}
