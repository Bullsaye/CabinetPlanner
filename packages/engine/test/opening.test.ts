import { describe, expect, it } from "vitest";
import { buildProject, elevationSvg, hingeEdges, loadProject, openingSymbolPoints, type DrawingText } from "../src/index.ts";

const text: DrawingText = { t: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k) };
const r = { x: 0, y: 0, w: 40, h: 80 };
const symbols = (svg: string): number[][][] =>
  [...svg.matchAll(/<polyline class="rm-opening" points="([^"]+)"\/>/g)].map((m) => m[1]!.split(" ").map((p) => p.split(",").map(Number)));

describe("opening symbol (D78)", () => {
  it("puts the tip at the handle by default: base on the hinge edge", () => {
    expect(openingSymbolPoints(r, "left")).toEqual([[0, 0], [40, 40], [0, 80]]);
    expect(openingSymbolPoints(r, "right")).toEqual([[40, 0], [0, 40], [40, 80]]);
    // A lift-up flap turns on its top edge: the tip points down (paper Y down).
    expect(openingSymbolPoints(r, "top")).toEqual([[0, 0], [20, 80], [40, 0]]);
  });

  it("puts the tip at the hinge edge on request", () => {
    expect(openingSymbolPoints(r, "left", "tip_at_hinge")).toEqual([[40, 0], [0, 40], [40, 80]]);
    expect(openingSymbolPoints(r, "top", "tip_at_hinge")).toEqual([[0, 80], [20, 0], [40, 80]]);
  });

  it("draws the symbol on hinged fronts in wall elevations, not on drawers", () => {
    const res = buildProject(
      loadProject({
        schemaVersion: 1,
        name: "R",
        room: { walls: [{ id: "A", length: 3000 }, { id: "B", length: 2000 }, { id: "C", length: 3000 }, { id: "D", length: 2000 }] },
        cabinets: [
          { id: "B01", type: "box", place: { wall: "A" }, vars: { door_count: 1 }, options: { door_hinge_side: "left" } },
          { id: "B02", type: "box", place: { wall: "A" }, fronts: [{ type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer" }] },
        ],
      }),
    );
    expect([...hingeEdges(res.cabinets[0]!).values()]).toEqual(["left"]);
    expect(hingeEdges(res.cabinets[1]!).size).toBe(0);
    const el = symbols(elevationSvg(res.room!, "A", res.cabinets, "R", text));
    expect(el.length).toBe(1);
    // Hinged left, tip at the handle: the tip lies right of the base.
    expect(el[0]![1]![0]!).toBeGreaterThan(el[0]![0]![0]!);
    const hinge = symbols(elevationSvg(res.room!, "A", res.cabinets, "R", text, true, { openingSymbol: "tip_at_hinge" }));
    expect(hinge[0]![1]![0]!).toBeLessThan(hinge[0]![0]![0]!);
    expect(elevationSvg(res.room!, "A", res.cabinets, "R", text, true, { openingSymbol: "none" })).not.toContain('class="rm-opening"');
  });
});
