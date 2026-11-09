import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_VIEW_FLAT,
  ASSEMBLY_VIEW_UPRIGHT,
  drawPart,
  findPatterns,
  MACHINE_VIEW,
  partView,
  resolveStyle,
  rulesFor,
  sceneOf,
  type DFeature,
  type DrawingText,
} from "../src/index.ts";
import { spread, spreadVar } from "../src/drawing/render.ts";
import { buildOne, partsByCode } from "./helpers.ts";

const cab = { W: 600, H: 720, D: 560 };
const text: DrawingText = { t: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k) };

describe("view orientation (D19)", () => {
  const p = partsByCode(buildOne({ options: { top: "full" } }));

  it("machine view: front edge on the reference, inner face up", () => {
    const sr = partView(p.SR!, MACHINE_VIEW, cab);
    // Right side: origin at the lower front corner.
    expect(sr.sides).toEqual({ bottom: "front", top: "rear", left: "bottom", right: "top" });
    expect(sr.face).toBe("t0"); // inner face of the right side
    expect(sr.project({ x: 600, y: 0, z: 560 })).toEqual({ X: 0, Y: 0 });
    // Left side, same face up: the true mirror, origin at the upper front corner.
    const sl = partView(p.SL!, MACHINE_VIEW, cab);
    expect(sl.sides).toEqual({ bottom: "front", top: "rear", left: "top", right: "bottom" });
    expect(sl.project({ x: 19, y: 720, z: 560 })).toEqual({ X: 0, Y: 0 });
    // Bottom: inner (top) face up, front on the reference, left on the left.
    expect(partView(p.BO!, MACHINE_VIEW, cab).sides).toMatchObject({ bottom: "front", left: "left" });
    // Parts without a front edge fall back to their bottom edge.
    expect(partView(p.BK!, MACHINE_VIEW, cab).sides).toMatchObject({ bottom: "bottom" });
  });

  it("assembly view: sides upright and folded out, flat parts flipped", () => {
    expect(partView(p.SL!, ASSEMBLY_VIEW_UPRIGHT, cab).sides).toMatchObject({ bottom: "bottom", left: "front" });
    expect(partView(p.SR!, ASSEMBLY_VIEW_UPRIGHT, cab).sides).toMatchObject({ bottom: "bottom", right: "front" });
    expect(partView(p.BO!, ASSEMBLY_VIEW_FLAT, cab).sides).toMatchObject({ left: "left", bottom: "front" }); // seen from above
    expect(partView(p.TO!, ASSEMBLY_VIEW_FLAT, cab).sides).toMatchObject({ left: "left", top: "front" }); // seen from below
  });
});

describe("patterns", () => {
  const f = (X: number, Y: number): DFeature => ({ op: "bore", where: "face", X, Y, d: 5, depth: 13, sources: [] });

  it("finds rows, then columns, and keeps the rest single", () => {
    const row = [73.5, 105.5, 137.5, 169.5].map((x) => f(x, 37));
    const col = [37, 197, 357].map((y) => f(9.5, y));
    const { patterns, singles } = findPatterns([...row, ...col, f(300, 300)], 3);
    expect(patterns).toEqual([
      { axis: "x", at: 37, start: 73.5, pitch: 32, count: 4 },
      { axis: "y", at: 9.5, start: 37, pitch: 160, count: 3 },
    ]);
    expect(singles.map((s) => [s.X, s.Y])).toEqual([[300, 300]]);
  });

  it("splits a row at a change of pitch", () => {
    const { patterns } = findPatterns([0, 32, 64, 96, 200, 232, 264].map((x) => f(x, 0)), 3);
    expect(patterns.map((p) => [p.start, p.count])).toEqual([
      [0, 4],
      [200, 3],
    ]);
  });
});

describe("drawing styles and rules (D20)", () => {
  it("resolves inheritance; later rules come first", () => {
    const iso = resolveStyle("machine-iso");
    expect(iso.dims.text).toBe("aligned");
    expect(iso.dims.mode).toBe("running");
    const mine = resolveStyle("mine", [
      { id: "mine", name: "Mine", extends: "machine", dims: { textHeight: 3.5 }, rules: [{ match: { ref: "SL-" }, positions: "none" }] },
    ]);
    expect(mine.dims.textHeight).toBe(3.5);
    expect(mine.rules[0]!.match.ref).toBe("SL-");
    expect(mine.rules.length).toBe(resolveStyle("machine").rules.length + 1);
  });

  it("rejects unknown and circular styles", () => {
    expect(() => resolveStyle("nope")).toThrow(/unknown/);
    expect(() => resolveStyle("a", [{ id: "a", name: "A", extends: "a", rules: [] }])).toThrow(/extends itself/);
    expect(() => resolveStyle("b", [{ id: "b", name: "B", extends: "zzz", rules: [] }])).toThrow(/unknown "zzz"/);
  });

  it("cascades rule properties: a taught rule changes only what it names", () => {
    const style = resolveStyle("mine", [
      { id: "mine", name: "Mine", extends: "machine", rules: [{ match: { source: ["joint"], role: ["side_left"] }, positions: "none" }] },
    ]);
    const p = partsByCode(buildOne());
    const joint = { op: "bore", where: "face", d: 8, sources: [{ kind: "joint" as const, ref: "SL-BO" }] };
    expect(rulesFor(style.rules, joint, p.SL!)).toEqual({ positions: "none", tag: true, table: true, hide: false });
    expect(rulesFor(style.rules, joint, p.SR!).positions).toBe("all"); // other role: untouched
    const sys = { op: "bore", where: "face", d: 5, sources: [{ kind: "system" as const, ref: "rows" }] };
    expect(rulesFor(style.rules, sys, p.SL!)).toMatchObject({ positions: "pattern", table: false });
  });
});

describe("part drawing", () => {
  const r = buildOne();
  const p = partsByCode(r);

  it("is deterministic, finite and to scale", () => {
    const style = resolveStyle("machine");
    const a = drawPart({ part: p.SR!, cabinet: cab, style, text }).svg;
    expect(a).toBe(drawPart({ part: p.SR!, cabinet: cab, style, text }).svg);
    expect(a).not.toMatch(/NaN|Infinity|undefined/);
    expect(a).toContain('width="297mm"');
    expect(drawPart({ part: p.SR!, cabinet: cab, style, text }).scale).toBe(5);
  });

  it("dimensions system rows as patterns and tags every group", () => {
    const d = drawPart({ part: p.SR!, cabinet: cab, style: resolveStyle("machine"), text });
    const sys = d.groups.find((g) => g.sources[0]!.kind === "system")!;
    expect(sys.patterns.map((x) => [x.axis, x.at, x.count, x.pitch])).toEqual([
      ["x", 37, 19, 32],
      ["x", 485, 19, 32],
    ]);
    expect(d.groups.every((g) => g.tag !== "")).toBe(true);
    // Only first and last hole of each row appear as positions.
    expect(d.svg).toContain(">73.5<");
    expect(d.svg).toContain(">649.5<");
    expect(d.svg).not.toContain(">105.5<");
  });

  it("uses portrait sheets for upright parts and lists non-system holes in the table", () => {
    const d = drawPart({ part: p.SL!, cabinet: cab, style: resolveStyle("assembly"), text });
    expect(d.svg).toContain('width="210mm"');
    expect(d.scale).toBe(5);
    expect(d.svg).toContain("drawing.table.hole");
    expect(d.svg).not.toMatch(/>F\d+</); // system holes stay out of the table
  });

  it("hides groups a rule hides", () => {
    const style = resolveStyle("x", [{ id: "x", name: "X", extends: "machine", rules: [{ match: { source: ["system"] }, hide: true }] }]);
    const d = drawPart({ part: p.SR!, cabinet: cab, style, text });
    expect(d.svg).not.toContain(">649.5<");
  });
});

describe("label spreading", () => {
  it("keeps free labels and pushes touching ones apart", () => {
    expect(spread([0, 100], 10)).toEqual([0, 100]);
    const s = spreadVar([100, 102], [10, 10], 2);
    expect(s[1]! - s[0]!).toBeCloseTo(12);
    expect((s[0]! + s[1]!) / 2).toBeCloseTo(101);
  });
});

describe("scene", () => {
  it("puts bores on the part surface in cabinet coordinates, pointing inwards", () => {
    const scene = sceneOf(buildOne().cabinets[0]!);
    const sl = scene.parts.find((x) => x.code === "SL")!;
    for (const b of sl.bores) {
      expect(b.at.x).toBe(19);
      expect(b.dir).toEqual({ axis: "x", sign: -1 });
    }
    expect(sl.pockets[0]).toMatchObject({ x: 11, dx: 8, z: 9.75, dz: 8.5 });
  });
});
