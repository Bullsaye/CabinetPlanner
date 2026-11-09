import { describe, expect, it } from "vitest";
import { type Bore, type Part } from "../src/index.ts";
import { buildOne, partsByCode, size } from "./helpers.ts";

const bores = (p: Part, ref?: string): Bore[] =>
  p.operations.filter((o): o is Bore => o.kind === "bore" && (!ref || o.sources.some((s) => s.ref === ref)));

describe("middle panels", () => {
  // Tall 1000: LW 962, one panel → two sections of (962 − 19) / 2 = 471.5.
  const r = buildOne({ presets: ["tall-unit"], vars: { W: 1000, partition_count: 1, door_count: 2 } });
  const p = partsByCode(r);

  it("builds without findings and splits the interior", () => {
    expect(r.diagnostics).toEqual([]);
    expect(p.MP1!.box.x).toBe(490.5); // 19 + 471.5
    expect(size(p.MP1)).toBe("2062 × 542 × 19"); // between bottom and top, back to front
  });

  it("puts the shelves in each section", () => {
    const shelves = r.parts.filter((x) => x.role === "shelf");
    expect(shelves).toHaveLength(8); // 4 per section
    expect(shelves.every((s) => s.length === 469.5)).toBe(true); // 471.5 − 2 · 1
  });

  it("dowels the panel to bottom and top", () => {
    expect(bores(p.BO!, "BO-MP1").length).toBe(4);
    expect(bores(p.MP1!, "BO-MP1").every((b) => b.face === "w1" && b.depth === 25)).toBe(true);
    expect(bores(p.MP1!, "TO-MP1").every((b) => b.face === "w2")).toBe(true);
  });

  it("drills shelf-pin rows on both faces from both sides (bore.opposite)", () => {
    const sys = bores(p.MP1!, "rows");
    expect(sys.length).toBeGreaterThan(0);
    expect(sys.every((b) => b.split && b.depth === 10)).toBe(true);
    expect(new Set(sys.map((b) => b.face))).toEqual(new Set(["t0", "t1"]));
    const thru = partsByCode(buildOne({ presets: ["tall-unit"], vars: { W: 1000, partition_count: 1 }, options: { "bore.opposite": "through" } }));
    expect(bores(thru.MP1!, "rows").every((b) => b.through && b.depth === 19)).toBe(true);
  });

  it("is left out with drawers", () => {
    const d = buildOne({ vars: { partition_count: 1 }, fronts: [{ type: "drawer" }] });
    expect(d.diagnostics.map((x) => x.code)).toContain("partitions_with_drawers");
    expect(d.parts.some((x) => x.role === "partition")).toBe(false);
  });
});

describe("handles", () => {
  it("bar handle on a base door: vertical at the opening edge, top hole 60 below the top, through from the front", () => {
    const r = buildOne({ options: { "hardware.handle": "generic-bar-128" } });
    expect(r.diagnostics).toEqual([]);
    const h = bores(partsByCode(r).DO1!, "generic-bar-128");
    // Door 717 × 597, hinged left → opening edge right: x = 597 − 40.
    expect(h.map((b) => [b.u, b.v, b.face, b.through])).toEqual([
      [529, 557, "t1", true],
      [657, 557, "t1", true],
    ]);
  });

  it("wall units get the handle low; two doors at their opening edges", () => {
    const r = buildOne({ kind: "wall", presets: ["wall-unit"], vars: { W: 800, door_count: 2 }, options: { "hardware.handle": "generic-bar-128" } });
    const p = partsByCode(r);
    expect(bores(p.DO1!).filter((b) => b.d === 5).map((b) => [b.u, b.v])).toEqual([
      [60, 357],
      [188, 357],
    ]);
    expect(bores(p.DO2!).filter((b) => b.d === 5).map((b) => b.v)).toEqual([40, 40]);
  });

  it("drawer fronts: centred; knobs: one hole; horizontal door handles", () => {
    const r = buildOne({ fronts: [{ type: "drawer", h: 150 }, { type: "door" }], options: { "hardware.handle": "generic-knob", "handle.drawer": "top" } });
    const p = partsByCode(r);
    expect(bores(p.DF1!).map((b) => [b.u, b.v])).toEqual([[298.5, 110]]);
    expect(bores(p.DO1!, "generic-knob")).toHaveLength(1);
    const hz = partsByCode(buildOne({ options: { "hardware.handle": "generic-bar-128", "handle.door": "horizontal" } }));
    expect(bores(hz.DO1!, "generic-bar-128").map((b) => [b.u, b.v])).toEqual([
      [657, 557],
      [657, 429],
    ]);
  });

  it("through holes can be drilled from both faces (bore.through)", () => {
    const r = buildOne({ options: { "hardware.handle": "generic-bar-128", "bore.through": "both_sides" } });
    const h = bores(partsByCode(r).DO1!, "generic-bar-128");
    expect(h).toHaveLength(4);
    expect(h.every((b) => b.split && b.depth === 10)).toBe(true);
    expect(r.ok).toBe(true);
  });
});
