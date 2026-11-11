import { describe, expect, it } from "vitest";
import type { Operation, Part } from "../src/index.ts";
import { buildOne, partsByCode, size } from "./helpers.ts";

const refs = (p: Part, ref: string): Operation[] => p.operations.filter((o) => o.sources.some((s) => s.ref === ref));
const hw = (p: Part, item: string): Operation[] => p.operations.filter((o) => o.sources.some((s) => s.kind === "hardware" && s.ref === item));

/** The wardrobe from the sketch: two sections, each open / door / two drawers. */
const stack = [{ type: "open", shelves: 0 }, { type: "door", h: 1025 }, { type: "drawer", h: 161 }, { type: "drawer", h: 235 }];
const wardrobe = (extra: Record<string, unknown> = {}) =>
  buildOne({
    kind: "tall",
    presets: ["tall-unit"],
    vars: { W: 1050, H: 1720, D: 475, front_gap: 4, front_gap_v: 4, front_gap_side: 2, front_gap_bottom: 4.5, shelf_gap: 0.5, ...((extra.vars as object) ?? {}) },
    options: { hat_shelf: false, ...((extra.options as object) ?? {}) },
    sections: [
      { fronts: stack, interior: "shelves", shelves: 3 },
      { fronts: stack, interior: "hanging" },
    ],
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "vars" && k !== "options")),
  });

describe("sections (D46)", () => {
  it("keeps the middle panel with drawers and gives every section its own fronts", () => {
    const r = wardrobe();
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.diagnostics.map((d) => d.code)).not.toContain("partitions_with_drawers");
    const p = partsByCode(r);
    expect(size(p.MP1)).toBe("1682 × 457 × 19");
    // Fronts meet at the middle of the middle panel: 2 + 521 + 4 + 521 + 2.
    expect([p.DO1!.box.x, p.DO1!.box.dx, p.DO2!.box.x, p.DO2!.box.dx]).toEqual([2, 521, 527, 521]);
    const drawerFronts = r.parts.filter((x) => x.role === "drawer_front");
    expect(drawerFronts.map((x) => `${x.width}×${x.length}`).sort()).toEqual(["161×521", "161×521", "235×521", "235×521"]);
    // Drawers sized to their section: Dynapro-style inner width over LWK = 496.5.
    expect(r.parts.filter((x) => x.role === "drawer_side_left").map((x) => x.box.x < 525)).toEqual([true, true, false, false]);
  });

  it("puts shelves and the rail in their sections; no hat shelf when hat_shelf is off", () => {
    const r = wardrobe();
    const p = partsByCode(r);
    const shelves = r.parts.filter((x) => x.role === "shelf");
    expect(shelves).toHaveLength(3);
    expect(shelves.every((s) => s.box.x < 525)).toBe(true);
    // Fixed shelves: per section above the door and between door and drawers.
    expect(r.parts.filter((x) => x.role === "fixed_shelf")).toHaveLength(4);
    // Rail end support in the middle panel's right face and in the right side.
    expect(hw(p.MP1!, "generic-wardrobe-rail").length).toBeGreaterThan(0);
    expect(hw(p.SR!, "generic-wardrobe-rail").length).toBeGreaterThan(0);
    expect(hw(p.SL!, "generic-wardrobe-rail")).toEqual([]);
  });

  it("adds a hat shelf in the hanging section by default", () => {
    const r = wardrobe({ options: { hat_shelf: true } });
    expect(r.parts.filter((x) => x.role === "fixed_shelf")).toHaveLength(5);
  });

  it("mounts slides on the sides and on both faces of the middle panel", () => {
    const r = wardrobe();
    const p = partsByCode(r);
    const slide = "generic-undermount";
    expect(hw(p.SL!, slide).length).toBeGreaterThan(0);
    expect(hw(p.SR!, slide).length).toBeGreaterThan(0);
    const faces = new Set(hw(p.MP1!, slide).map((o) => (o.kind === "bore" ? o.face : "")));
    expect([...faces].sort()).toEqual(["t0", "t1"]);
  });

  it("hinges single doors on the outer sides; a door hinged at a middle panel drills it", () => {
    const outer = partsByCode(wardrobe());
    expect(outer.MP1!.operations.some((o) => o.sources.some((s) => s.ref === "generic-hinge-110"))).toBe(false);
    const r = buildOne({ kind: "tall", presets: ["tall-unit"], vars: { W: 1000 }, sections: [{ fronts: [{ type: "door", hinge: "right" }] }, { fronts: [{ type: "door" }] }] });
    const p = partsByCode(r);
    // A door hinged on a middle panel gets the half-overlay hinge (D57); the other door the normal one.
    expect(hw(p.MP1!, "generic-hinge-110-half").length).toBeGreaterThan(0);
    expect(hw(p.SR!, "generic-hinge-110").length).toBeGreaterThan(0);
  });

  it("takes section widths; the others share the rest", () => {
    const r = buildOne({ kind: "tall", presets: ["tall-unit"], vars: { W: 1000 }, sections: [{ w: 300 }, {}] });
    const p = partsByCode(r);
    expect(p.MP1!.box.x).toBe(19 + 300);
    expect(r.diagnostics).toEqual([]);
    const bad = buildOne({ kind: "tall", presets: ["tall-unit"], vars: { W: 1000 }, sections: [{ w: 300 }, { w: 300 }] });
    expect(bad.diagnostics.map((d) => d.code)).toContain("sections_width_mismatch");
  });

  it("bounds zones by extra construction panels", () => {
    // Fixed shelves replaced by panels at the sketch's clear heights: 375 above the bottom, 269 under the top.
    const r = wardrobe({ construction: { fixed: { "1": { panel: false }, "2": { panel: false } }, panels: [{ y: "H - 2 * t_carcase - 269" }, { y: "t_carcase + 375" }] } });
    const p = partsByCode(r);
    const fs = r.parts.filter((x) => x.role === "fixed_shelf").map((x) => x.box.y);
    expect([...new Set(fs)].sort((a, b) => a - b)).toEqual([394, 1413]);
    // Shelves between the panels (413…1413), the rail under the upper one.
    for (const s of r.parts.filter((x) => x.role === "shelf")) expect(s.box.y > 413 && s.box.y < 1413).toBe(true);
    const rail = r.cabinets[0]!.fittings.find((f) => f.kind === "rail");
    expect(rail?.y).toBe(1413 - 50);
    expect(p.DF1).toBeDefined();
  });
});

describe("middle panels through (D46)", () => {
  it("runs the middle panel full height and splits bottom and top", () => {
    const r = wardrobe({ options: { partition_joint: "through" } });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const p = partsByCode(r);
    expect(p.MP1!.box).toMatchObject({ y: 0, dy: 1720 });
    expect(size(p.BO1)).toBe("496.5 × 475 × 19");
    expect(size(p.BO2)).toBe("496.5 × 475 × 19");
    expect(size(p.TO1)).toBe("496.5 × 475 × 19");
    expect(p.BO).toBeUndefined();
    // The bottoms' ends are dowelled into the middle panel's faces.
    expect(refs(p.MP1!, "MP1-BO1").length).toBeGreaterThan(0);
    expect(refs(p.MP1!, "MP1-BO2").length).toBeGreaterThan(0);
    expect(refs(p.SL!, "SL-BO1").length).toBeGreaterThan(0);
    expect(refs(p.SR!, "SR-BO2").length).toBeGreaterThan(0);
    // Legs go into the bottom pieces, none under the middle panel.
    const legs = r.cabinets[0]!.fittings.filter((f) => f.kind === "leg");
    expect(legs.length).toBeGreaterThan(0);
    for (const l of legs) expect(l.x < p.MP1!.box.x || l.x > p.MP1!.box.x + 19).toBe(true);
  });

  it("runs the middle panel full depth and splits a grooved back per section", () => {
    const p = partsByCode(wardrobe({ options: { partition_joint: "through" } }));
    expect(p.MP1!.box).toMatchObject({ z: 0, dz: 475 });
    expect(p.BK).toBeUndefined();
    // Section 496.5 + into the side (groove 8 − play 1) + into the middle panel (19 / 3 − play 1), D56.
    expect(p.BK1!.width).toBe(508.83);
    expect(p.BK2!.width).toBe(508.83);
    const grooves = p.MP1!.operations.filter((o) => o.kind === "pocket" && o.sources.some((s) => s.kind === "back"));
    expect(grooves.map((o) => o.face).sort()).toEqual(["t0", "t1"]);
    // A third of the panel stays between the two grooves.
    for (const g of grooves) if (g.kind === "pocket") expect(g.w1 - g.w0).toBeCloseTo(19 / 3, 1);
    // Deep grooves in the sides do not make the middle panel's deeper.
    const deep = wardrobe({ options: { partition_joint: "through" }, vars: { back_groove_depth: 10 } });
    expect(deep.diagnostics.map((d) => d.code)).not.toContain("back_grooves_meet");
    // Set too deep on purpose: still an error.
    const forced = wardrobe({ options: { partition_joint: "through" }, vars: { back_groove_depth_middle: 9 } });
    expect(forced.diagnostics.map((d) => d.code)).toContain("back_grooves_meet");
  });

  it("runs through from bottom to top edge with sides between too", () => {
    const r = wardrobe({ options: { partition_joint: "through", carcase_joint: "sides_between" }, vars: { back_groove_depth: 8 } });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const p = partsByCode(r);
    expect(p.MP1!.box).toMatchObject({ y: 0, dy: 1720 });
    // Bottom pieces run under the sides, up to the middle panel.
    expect(p.BO1!.box).toMatchObject({ x: 0, dx: 19 + 496.5 });
  });

  it("keeps one bottom and top without middle panels", () => {
    const p = partsByCode(buildOne({ options: { partition_joint: "through" } }));
    expect(p.BO).toBeDefined();
    expect(p.BO1).toBeUndefined();
  });
});

describe("handle per front zone (D48)", () => {
  it("drills the zone's own handle, or none, instead of the cabinet's", () => {
    const r = buildOne({
      kind: "tall",
      presets: ["tall-unit"],
      vars: { W: 1000 },
      options: { "hardware.handle": "generic-bar-160" },
      sections: [
        { fronts: [{ type: "door", handle: null }, { type: "drawer", h: 200, handle: "generic-knob" }] },
        { fronts: [{ type: "door" }, { type: "drawer", h: 200 }] },
      ],
    });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const c = r.cabinets[0]!;
    const by = Object.fromEntries(c.handles.map((h) => [h.part.split("-")[1], h.item]));
    expect(by.DO1).toBeUndefined();
    expect(by.DF1).toBe("generic-knob");
    expect(by.DO2).toBe("generic-bar-160");
    expect(by.DF2).toBe("generic-bar-160");
    const bad = buildOne({ fronts: [{ type: "door", handle: "generic-hinge-110" }] });
    expect(bad.diagnostics.map((d) => d.code)).toContain("hardware_wrong_category");
  });
});

describe("system holes only where there are shelves (D52)", () => {
  it("drills rows beside shelf zones only: not in open, hanging or drawer zones", () => {
    const r = wardrobe({ options: { system_holes: "shelves" } });
    const p = partsByCode(r);
    const rows = (part: string, face: string) =>
      p[part]!.operations.filter((o) => o.kind === "bore" && o.face === face && o.sources.some((s) => s.kind === "system")).map((o) => (o.kind === "bore" ? o.u : 0));
    // Left section has the shelves: left side inner face and the middle panel's left face (t0).
    expect(rows("SL", "t1").length).toBeGreaterThan(0);
    expect(rows("MP1", "t0").length).toBeGreaterThan(0);
    // Right section hangs: no rows on the middle panel's right face or the right side.
    expect(rows("MP1", "t1")).toEqual([]);
    expect(rows("SR", "t0")).toEqual([]);
    // Rows stay within the door zone, not in the open compartment above or the drawers below.
    const fs = r.parts.filter((x) => x.role === "fixed_shelf").map((x) => x.box.y).sort((a, b) => a - b);
    for (const y of rows("SL", "t1")) expect(y > fs[0]! && y < fs[fs.length - 1]!).toBe(true);
  });
  it("is the tall unit default; full rows stay the factory default", () => {
    const tall = buildOne({ kind: "tall", presets: ["tall-unit"] });
    expect(tall.cabinets[0]!.resolved.options.get("system_holes")!.value).toBe("shelves");
    expect(buildOne({}).cabinets[0]!.resolved.options.get("system_holes")!.value).toBe("full");
  });
});

describe("many sections with connectors, sheet sizes (D55)", () => {
  const five = (joint: string) =>
    buildOne({
      kind: "tall",
      presets: ["tall-unit", "wardrobe"],
      vars: { W: 3100, H: 2200, D: 580 },
      options: { partition_joint: joint, joint_method: "connector", "hardware.fastener": "lamello-clamex-p14" },
      sections: [{}, {}, {}, {}, {}],
    });

  it("staggers Clamex grooves of the joints on both faces of a middle panel, each joint holding an end", () => {
    const r = five("through");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const mp = partsByCode(r).MP1!;
    const slots = (face: string) =>
      mp.operations
        .filter((o) => o.kind === "pocket" && o.face === face && o.sources.some((s) => s.ref === "lamello-clamex-p14") && o.u0 < 20)
        .map((o) => (o.kind === "pocket" ? o.v0 : 0))
        .sort((a, b) => a - b);
    const a = slots("t0");
    const b = slots("t1");
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(b.length).toBeGreaterThanOrEqual(3);
    // No groove opposite another (69.6 long + 2 × wall).
    for (const v of a) for (const w of b) expect(Math.abs(v - w)).toBeGreaterThanOrEqual(69.6 + 4 - 1e-6);
  });

  it("refuses parts larger than the board; middle panels through split them", () => {
    expect(five("between").diagnostics.map((d) => d.code)).toContain("part_larger_than_sheet");
    expect(five("through").diagnostics.map((d) => d.code)).not.toContain("part_larger_than_sheet");
  });
});

describe("hole rows per section (D57)", () => {
  const rows = (r: ReturnType<typeof buildOne>, part: string, face: string) =>
    partsByCode(r)[part]!.operations.filter((o) => o.kind === "bore" && o.face === face && o.sources.some((s) => s.kind === "system")).map((o) => (o.kind === "bore" ? o.u : 0));
  it("takes a start and end per section, or none, over the automatic rule", () => {
    const r = buildOne({
      kind: "tall",
      presets: ["tall-unit"],
      vars: { W: 1000, H: 2000 },
      options: { system_holes: "full" },
      sections: [
        { fronts: [{ type: "door" }, { type: "drawer", h: 300 }], holes: { from: 800, to: 1500 } },
        { fronts: [{ type: "door" }, { type: "drawer", h: 300 }], holes: false },
      ],
    });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const left = rows(r, "SL", "t1");
    expect(left.length).toBeGreaterThan(0);
    expect(Math.min(...left)).toBeGreaterThanOrEqual(800);
    expect(Math.max(...left)).toBeLessThanOrEqual(1500);
    expect(rows(r, "SR", "t0")).toEqual([]);
    // The middle panel only on the face of the section that wants them.
    expect(rows(r, "MP1", "t0").length).toBeGreaterThan(0);
    expect(rows(r, "MP1", "t1")).toEqual([]);
  });
  it("applies a cabinet-wide range to sections without their own", () => {
    const r = buildOne({ kind: "tall", presets: ["tall-unit"], vars: { W: 600, H: 2000 }, holes: { from: 400, to: 900 } });
    const left = rows(r, "SL", "t1");
    expect(Math.min(...left)).toBeGreaterThanOrEqual(400);
    expect(Math.max(...left)).toBeLessThanOrEqual(900);
  });
});
