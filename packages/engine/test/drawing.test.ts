import { describe, expect, it } from "vitest";
import {
  addBore,
  ASSEMBLY_VIEW_FLAT,
  drawAssembly,
  drawPartSheets,
  stackSheets,
  ASSEMBLY_VIEW_UPRIGHT,
  drawPart,
  findPatterns,
  MACHINE_VIEW,
  partView,
  resolveStyle,
  rulesFor,
  sceneOf,
  type DFeature,
  type Part,
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
    const d = drawPart({ part: p.SL!, cabinet: cab, style: resolveStyle("upright", [{ id: "upright-table", name: "T", extends: "upright", show: { table: true }, rules: [] }]), text });
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

describe("part sheet styles agree on flat parts", () => {
  it("draws bottom, top, rails and shelves identically in machine and upright styles", () => {
    const r = buildOne({ vars: { shelf_count: 1 } });
    const by = partsByCode(r);
    for (const code of ["BO", "RF", "RR", "SH1"]) {
      const a = drawPart({ part: by[code]!, cabinet: cab, style: resolveStyle("machine"), text }).view.sides;
      const b = drawPart({ part: by[code]!, cabinet: cab, style: resolveStyle("upright"), text }).view.sides;
      expect(b, code).toEqual(a);
    }
    // Sides differ on purpose: upright vs. lying on the machine.
    const sl = drawPart({ part: by.SL!, cabinet: cab, style: resolveStyle("upright"), text }).view.sides;
    expect(sl).toMatchObject({ bottom: "bottom", left: "front" });
  });

  it("ends overall dimensions with ticks by default, arrows on request", () => {
    const sr = partsByCode(buildOne()).SR!;
    expect(drawPart({ part: sr, cabinet: cab, style: resolveStyle("machine"), text }).svg).not.toContain(`class="pd-arrow"`);
    const arrows = resolveStyle("a", [{ id: "a", name: "A", extends: "machine", dims: { terminator: "arrow" }, rules: [] }]);
    expect(drawPart({ part: sr, cabinet: cab, style: arrows, text }).svg).toContain(`class="pd-arrow"`);
  });
});

describe("machined faces and two-sided parts (D22)", () => {
  const src = { kind: "joint" as const, ref: "test" };

  it("shows the outer face when only the outer face has machining", () => {
    const sr = JSON.parse(JSON.stringify(partsByCode(buildOne()).SR!)) as Part;
    sr.operations = [];
    addBore(sr, { x: 600, y: 300, z: 300 }, "-x", 8, 12, src); // outer face of the right side
    expect(partView(sr, MACHINE_VIEW, cab).face).toBe("t1");
    expect(partView(sr, MACHINE_VIEW, cab).sides.bottom).toBe("front"); // still front on the reference
    sr.operations = [];
    addBore(sr, { x: 581, y: 300, z: 300 }, "+x", 8, 12, src); // inner face
    expect(partView(sr, MACHINE_VIEW, cab).face).toBe("t0");
  });

  it("gives a part machined on both faces one sheet per side, front edge on the reference on both", () => {
    const sh = JSON.parse(JSON.stringify(partsByCode(buildOne()).SH1!)) as Part;
    const top = sh.box.y + sh.box.dy;
    addBore(sh, { x: 100, y: top, z: 300 }, "-y", 5, 10, src);
    addBore(sh, { x: 200, y: sh.box.y, z: 300 }, "+y", 8, 10, src);
    const sheets = drawPartSheets({ part: sh, cabinet: cab, style: resolveStyle("machine"), text });
    expect(sheets.map((x) => x.view.face)).toEqual(["t1", "t0"]);
    expect(sheets.map((x) => x.view.sides.bottom)).toEqual(["front", "front"]);
    // Each sheet dimensions and tags only its own side.
    for (const x of sheets) expect(x.groups.filter((g) => g.tag).map((g) => g.where)).toEqual(["face"]);
    expect(sheets[0]!.svg).toContain("drawing.side");
    const both = stackSheets(sheets);
    expect((both.match(/<svg /g) ?? []).length).toBe(3);
    // Turned off by style: one sheet.
    const one = resolveStyle("o", [{ id: "o", name: "O", extends: "machine", show: { bothSides: false }, rules: [] }]);
    expect(drawPartSheets({ part: sh, cabinet: cab, style: one, text })).toHaveLength(1);
  });

  it("does not count a through notch as machining of the other face", () => {
    const w = partsByCode(buildOne({ kind: "wall", presets: ["wall-unit"], options: { "hardware.hanger": "hettich-sah-130" } }));
    for (const side of [w.SL!, w.SR!]) {
      const sheets = drawPartSheets({ part: side, cabinet: { W: 600, H: 720, D: 320 }, style: resolveStyle("machine"), text });
      expect(sheets).toHaveLength(1);
      expect(sheets[0]!.view.face).toBe(side.role === "side_left" ? "t1" : "t0");
      expect(sheets[0]!.svg).not.toContain('class="pd-pocket-far"');
    }
  });

  it("keeps one-sided parts on one sheet", () => {
    expect(drawPartSheets({ part: partsByCode(buildOne()).SL!, cabinet: cab, style: resolveStyle("machine"), text })).toHaveLength(1);
  });
});

describe("assembly drawing (D21)", () => {
  const r = buildOne({ vars: { W: 800, door_count: 2, shelf_count: 2 } });
  const c = r.cabinets[0]!;
  const input = {
    cabinet: { id: "C1", W: 800, H: 720, D: 560 },
    parts: c.parts,
    hardware: c.hardware,
    library: r.library,
    text,
  };

  it("numbers identical parts once and puts a balloon on every part", () => {
    const d = drawAssembly(input);
    expect(d.rows.map((x) => [x.pos, x.role, x.qty])).toEqual([
      [1, "side_left", 2],
      [2, "bottom", 1],
      [3, "rail_front", 1],
      [4, "rail_rear", 1],
      [5, "back", 1],
      [6, "shelf", 2],
      [7, "door", 2],
    ]);
    expect((d.svg.match(/class="asm-balloon"/g) ?? []).length).toBe(c.parts.length);
    expect(d.svg).toContain("dowel-8x35");
  });

  it("is deterministic, finite and on A3", () => {
    const a = drawAssembly(input).svg;
    expect(a).toBe(drawAssembly(input).svg);
    expect(a).not.toMatch(/NaN|Infinity|undefined/);
    expect(a).toContain('width="420mm"');
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
