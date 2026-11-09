import { describe, expect, it } from "vitest";
import { FACTORY_TEMPLATES, buildProject, dowelPositions, loadProject, neighbours } from "../src/index.ts";
import { buildOne, partsByCode } from "./helpers.ts";

import type { Operation, Part } from "../src/index.ts";
const refs = (p: Part, ref: string): Operation[] => p.operations.filter((o) => o.sources.some((s) => s.ref === ref));

describe("back behind top and bottom (D35)", () => {
  it("runs the back full height between the sides; bottom and top end at its front face", () => {
    const r = buildOne({ options: { top: "full", back_extent: "behind_horizontals" } });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    // Groove at 10 from the rear, back 8: the horizontals start at 18.
    expect(p.BK!.box).toMatchObject({ y: 0, dy: 720, z: 10, dz: 8 });
    expect(p.BO!.box).toMatchObject({ z: 18, dz: 560 - 18 });
    expect(p.TO!.box).toMatchObject({ z: 18, dz: 560 - 18 });
    // Grooves only in the sides, over their full height.
    expect(refs(p.BO!, "groove")).toEqual([]);
    expect(refs(p.SL!, "groove")[0]).toMatchObject({ kind: "pocket", u0: 0, u1: 720 });
  });

  it("needs sides running full height", () => {
    const r = buildOne({ options: { back_extent: "behind_horizontals", carcase_joint: "sides_between" } });
    expect(r.diagnostics.map((d) => d.code)).toContain("back_behind_needs_sides_over");
  });
});

describe("dowel sequence (D35)", () => {
  const o = { pitch: 32, offsetFront: 32, offsetRear: 40, maxSpacing: 160, minCount: 2, sequence: { second: 32, spacing: 128 } };
  // Positions measured from the front end of a joint 0…L (front at L).
  const fromFront = (L: number, opts = o) => dowelPositions(0, L, opts).map((z) => L - z);

  it("places 32, 64, then every 128", () => {
    expect(fromFront(542)).toEqual([32, 64, 192, 320, 448]);
  });
  it("moves the rearmost dowel forward in 32 steps when it comes too close to the back", () => {
    // 448 would be 32 from the back of a 480 joint: moves to 416.
    expect(fromFront(480)).toEqual([32, 64, 192, 320, 416]);
    // …and is dropped when that brings it within 32 of the one before.
    expect(fromFront(355)).toEqual([32, 64, 192, 288]);
    expect(fromFront(100)).toEqual([32]); // 64 → 32 meets the first one: dropped
  });
  it("is chosen per shop with dowel_pattern", () => {
    const r = buildOne({ options: { dowel_pattern: "sequence" }, vars: { dowel_offset_front: 32, dowel_offset_rear: 30 } });
    expect(r.diagnostics).toEqual([]);
    const sl = partsByCode(r).SL!;
    // Bottom joint: bottom 18…560 (groove at 10, back 8), so 542 long.
    expect(refs(sl, "SL-BO").map((b) => (b.kind === "bore" ? 560 - (b.v as number) : 0)).sort((a, b) => a - b)).toEqual([32, 64, 192, 320, 448]);
  });
});

describe("front gaps (D35)", () => {
  it("takes left, right and middle gaps separately", () => {
    const r = buildOne({ vars: { W: 800, door_count: 2, front_gap_left: 1, front_gap_right: 5, front_gap_middle: 4 } });
    const p = partsByCode(r);
    expect(p.DO1!.box.x).toBe(1);
    expect(p.DO2!.box.x + p.DO2!.box.dx).toBe(795);
    expect(p.DO2!.box.x - (p.DO1!.box.x + p.DO1!.box.dx)).toBe(4);
  });
  it("derives side gaps from the vertical gap", () => {
    const r = buildOne({ vars: { front_gap_v: 4 } });
    expect(partsByCode(r).DO1!.box.x).toBe(2);
  });
});

describe("connectors (D36)", () => {
  const bores = (p: Part, ref: string) => refs(p, ref).filter((o) => o.kind === "bore");

  it("drills Minifix: housing in the bottom's top face 24 from the end, Ø8 into the end, Ø5 in the side", () => {
    const r = buildOne({ options: { joint_method: "connector", "hardware.fastener": "hafele-minifix-15", top: "full" } });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const bo = bores(p.BO!, "hafele-minifix-15");
    // Bottom from x 19: housing centre at x 19 + 24, on the top face, Ø15 × 14.
    const housing = bo.filter((b) => b.kind === "bore" && b.d === 15);
    expect(housing.length).toBe(6); // three per side (≤ 300 apart)
    expect(housing[0]).toMatchObject({ face: "t1", u: 24, d: 15, depth: 14 });
    expect(bo.filter((b) => b.kind === "bore" && b.d === 8)[0]).toMatchObject({ face: "w1", depth: 24, w: 9.5 });
    expect(bores(p.SL!, "hafele-minifix-15").every((b) => b.kind === "bore" && b.d === 5 && b.depth === 13)).toBe(true);
    // Defaults: first 50 from the front, then the rear one (≤ 300 apart → a middle one on a 560 deep joint).
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "hafele-minifix-15")?.qty).toBe(12); // bottom + top, 3 per side
  });

  it("mills Clamex P-System grooves in both parts and the lever hole in the panel", () => {
    const r = buildOne({ options: { joint_method: "connector", "hardware.fastener": "lamello-clamex-p14" } });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const grooves = refs(p.SL!, "lamello-clamex-p14").filter((o) => o.kind === "pocket");
    expect(grooves.length).toBeGreaterThan(0);
    const g = grooves[0]!;
    if (g.kind !== "pocket") throw new Error();
    expect(g.w1 - g.w0).toBe(14);
    expect(g.v1 - g.v0).toBeCloseTo(69.6);
    const lever = bores(p.BO!, "lamello-clamex-p14");
    expect(lever[0]).toMatchObject({ d: 6, u: 7.5 });
  });

  it("combines connectors at the ends with dowels between", () => {
    const r = buildOne({ options: { joint_method: "connector_dowel", top: "full" } });
    expect(r.diagnostics).toEqual([]);
    const sl = partsByCode(r).SL!;
    expect(bores(sl, "hafele-minifix-15").length).toBe(4); // front and back, bottom and top
    expect(bores(sl, "SL-BO").length).toBeGreaterThan(0);
  });

  it("drills confirmat clearance holes through the side and pilots into the end", () => {
    const r = buildOne({ options: { joint_method: "connector", "hardware.fastener": "generic-confirmat-7x50", top: "full" } });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    expect(bores(p.SL!, "generic-confirmat-7x50").every((b) => b.kind === "bore" && b.d === 7 && b.through)).toBe(true);
    expect(bores(p.BO!, "generic-confirmat-7x50")[0]).toMatchObject({ d: 5, depth: 33 });
  });
});

describe("neighbours and cabinet screws (D37)", () => {
  const room = { walls: [{ id: "A", length: 3000 }, { id: "B", length: 2000 }, { id: "C", length: 3000 }, { id: "D", length: 2000 }] };
  const build = (cabinets: unknown[], shop: Record<string, unknown> = {}) =>
    buildProject(loadProject({ schemaVersion: 1, name: "n", room, shop: { presets: [], vars: {}, options: shop }, cabinets }));

  it("knows visible ends of a run", () => {
    const r = build([
      { id: "B01", type: "box", place: { wall: "A", x: 600 } },
      { id: "B02", type: "box", place: { wall: "A" } },
    ]);
    const near = neighbours(r.room!);
    expect(near.get("B01")!.visible).toEqual({ left: true, right: false });
    expect(near.get("B02")!.visible).toEqual({ left: false, right: true });
  });

  it("screws neighbours together through both sides at the same heights", () => {
    const r = build(
      [
        { id: "B01", type: "box", place: { wall: "A", x: 600 } },
        { id: "B02", type: "box", place: { wall: "A" } },
      ],
      { cabinet_link: "screws" },
    );
    expect(r.diagnostics).toEqual([]);
    const sr = r.parts.find((p) => p.id === "B01-SR")!;
    const sl = r.parts.find((p) => p.id === "B02-SL")!;
    const a = sr.operations.filter((o) => o.sources.some((s) => s.ref === "generic-cabinet-connector-screw"));
    const b = sl.operations.filter((o) => o.sources.some((s) => s.ref === "generic-cabinet-connector-screw"));
    expect(a.length).toBe(2);
    expect(a.map((o) => (o.kind === "bore" ? o.u : 0))).toEqual(b.map((o) => (o.kind === "bore" ? o.u : 0)));
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "generic-cabinet-connector-screw")?.qty).toBe(2);
  });
});

describe("construction elements (D38)", () => {
  const fridge = FACTORY_TEMPLATES.find((t) => t.id === "tall-fridge")!.cabinet;

  it("builds the fridge housing: set-back board, gap, full board, back only above", () => {
    const r = buildOne(fridge as never);
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const [fs1, fs2] = [p.FS1!, p.FS2!];
    // FS1: automatic shelf over the fridge, 50 shorter at the rear.
    expect(fs1.box.z).toBe(18 + 50);
    // FS2: one gap (50) above FS1, reaching into the back groove.
    expect(fs2.box.y).toBe(fs1.box.y + 19 + 50);
    expect(fs2.box.z).toBe(0);
    // One back, from FS2 to the top; grooves in FS2 and the top, none in the bottom.
    expect(r.parts.filter((x) => x.role === "back").map((x) => x.code)).toEqual(["BK1"]);
    expect(p.BK1!.box.y).toBe(fs2.box.y + 19 - 7);
    const groove = (x: Part) => x.operations.filter((o) => o.sources.some((s) => s.kind === "back"));
    expect(groove(fs2).length).toBe(1);
    expect(groove(p.BO!)).toEqual([]);
  });

  it("can drop an automatic fixed shelf and add panels at any height", () => {
    const r = buildOne({
      kind: "tall",
      presets: ["tall-unit"],
      fronts: [{ type: "door" }, { type: "door", h: 717 }],
      construction: { fixed: { "1": { panel: false } }, panels: [{ y: 1000, setbackFront: 30 }] },
    });
    expect(r.diagnostics).toEqual([]);
    const fs = r.parts.filter((x) => x.role === "fixed_shelf");
    expect(fs.map((x) => [x.box.y, x.box.z + x.box.dz])).toEqual([[1000, 560 - 30]]);
  });

  it("splits the back around a zone without one", () => {
    const r = buildOne({
      kind: "tall",
      presets: ["tall-unit"],
      vars: { shelf_count: 0 },
      fronts: [{ type: "door" }, { type: "appliance", h: "oven_h" }, { type: "drawer" }],
      construction: { noBack: [2] },
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.parts.filter((x) => x.role === "back").length).toBe(2);
  });
});

describe("cabinet hangers and flaps (D39)", () => {
  const wall = { kind: "wall", presets: ["wall-unit"], vars: { W: 600 }, options: { "hardware.hanger": "hettich-sah-130", back_extent: "behind_horizontals" } };

  it("drills SAH 130 and notches hidden sides for the rail", () => {
    const r = buildOne({ ...wall, options: { ...wall.options, "side.right": "visible" } });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const holes = refs(p.SL!, "hettich-sah-130");
    // 23.7 below the top (720), 20.5 and 52.5 in front of the back's front face (18).
    expect(holes.map((o) => (o.kind === "bore" ? [o.u, o.v, o.d] : []))).toEqual([
      [720 - 23.7, 18 + 20.5, 10],
      [720 - 23.7, 18 + 52.5, 10],
    ].map(([u, z, d]) => [u, z, d]));
    const notch = (x: Part) => refs(x, "hettich-sah-130:notch");
    expect(notch(p.SL!)[0]).toMatchObject({ kind: "pocket", u0: 720 - 29, u1: 720, v0: 0, v1: 18, w0: 0, w1: 19 });
    expect(notch(p.SR!)).toEqual([]); // visible: no notch
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "hettich-sah-130")?.qty).toBe(1);
  });

  it("warns when the top would block the rail, and checks the back setback", () => {
    const r = buildOne({ ...wall, options: { "hardware.hanger": "hettich-sah-130" } });
    expect(r.diagnostics.map((d) => d.code)).toContain("hanger_rail_blocked");
    const r2 = buildOne({ ...wall, vars: { W: 600, back_groove_offset: 5 } });
    expect(r2.diagnostics.map((d) => d.code)).toContain("hardware_limit");
  });

  it("lifts a flap on AVENTOS HK top, mechanism chosen by power factor", () => {
    const r = buildOne({ kind: "wall", presets: ["wall-unit"], vars: { W: 800, H: 400 }, fronts: [{ type: "flap" }] });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    expect(p.FL1).toBeDefined();
    // Ø5 holes 36 below the top edge at 37 / 69 / 133 / 165 from the front (D 320).
    expect(refs(p.SL!, "blum-aventos-hk-top").map((o) => (o.kind === "bore" ? 320 - o.v : 0))).toEqual([37, 69, 133, 165]);
    // Front 797 × 397 × 19 MDF (750 kg/m³) ≈ 4.5 kg + 0.4 handles → LF ≈ 400 × 4.9 ≈ 1960 → 22K2510.
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "blum-aventos-hk-top")).toMatchObject({ qty: 1, article: "22K2510" });
  });
});

describe("front stack per zone", () => {
  it("builds a tall unit with a door opening right over a large and two small drawers", () => {
    const r = buildOne({
      kind: "tall",
      presets: ["tall-unit"],
      fronts: [{ type: "door", doors: 1, hinge: "right" }, { type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer", h: 300 }],
    });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    expect([p.DF1!.box.dy, p.DF2!.box.dy, p.DF3!.box.dy]).toEqual([150, 150, 300]);
    // Hinges on the right side (cup bores near the door's right edge).
    const plates = refs(p.SR!, "generic-hinge-110");
    expect(plates.length).toBeGreaterThan(0);
    expect(refs(p.SL!, "generic-hinge-110")).toEqual([]);
  });
});

describe("rails, shortened bottom, screws (D41)", () => {
  // A sink unit built only from settings: upright front rail, no rear rail,
  // upright rear rail at the bottom, bottom shortened by a third of the depth, no back.
  const sink = (W: number, D: number) =>
    buildOne({
      vars: { W, D, door_count: 2, shelf_count: 0, bottom_setback_rear: "D / 3", rail_w: 100 },
      options: { top: "rails", "rail.front": "upright", "rail.rear": "none", "rail.bottom": "upright", back_mount: "none" },
    });

  it("builds from settings alone and follows the cabinet size", () => {
    for (const [W, D] of [[800, 560], [1000, 500]] as const) {
      const r = sink(W, D);
      expect(r.diagnostics).toEqual([]);
      const p = partsByCode(r);
      expect(p.RR).toBeUndefined();
      expect(p.BK).toBeUndefined();
      expect(p.RF!.box).toMatchObject({ y: 720 - 100, dy: 100, z: D - 19, dz: 19 });
      expect(p.RB!.box).toMatchObject({ y: 0, dy: 100, z: 0, dz: 19 });
      expect(p.BO!.box.z).toBeCloseTo(D / 3, 1);
      // Upright rails are dowelled along their height: from the top for the front rail, from the bottom for the bottom rail.
      const rfDowels = refs(p.SL!, "SL-RF").filter((o) => o.kind === "bore");
      const rbDowels = refs(p.SL!, "SL-RB").filter((o) => o.kind === "bore");
      expect(rfDowels.length).toBeGreaterThanOrEqual(2);
      expect(rbDowels.length).toBeGreaterThanOrEqual(2);
      // Legs stay under the shortened bottom.
      const legs = r.cabinets[0]!.fittings.filter((f) => f.kind === "leg");
      expect(Math.min(...legs.map((l) => l.z))).toBeGreaterThan(D / 3);
    }
  });

  it("asks for enough shortening for the bottom rail", () => {
    const r = buildOne({ options: { "rail.bottom": "flat" }, vars: { bottom_setback_rear: 50 } });
    expect(r.diagnostics.map((d) => d.code)).toContain("bottom_rail_overlap");
  });

  it("screws through the sides between the dowels, starting between the first two", () => {
    const r = buildOne({
      options: { joint_screws: "between_dowels", dowel_pattern: "sequence", top: "full" },
      vars: { dowel_offset_front: 32, dowel_offset_rear: 30 },
    });
    expect(r.diagnostics).toEqual([]);
    const sl = partsByCode(r).SL!;
    const dowels = refs(sl, "SL-BO").map((o) => (o.kind === "bore" ? 560 - (o.v as number) : 0)).sort((a, b) => a - b);
    const screws = refs(sl, "generic-chipboard-screw-4x50")
      .filter((o) => o.kind === "bore" && o.u < 30)
      .map((o) => (o.kind === "bore" ? 560 - (o.v as number) : 0))
      .sort((a, b) => a - b);
    expect(dowels).toEqual([32, 64, 192, 320, 448]);
    expect(screws).toEqual([48, 128, 256, 384]);
    expect(refs(sl, "generic-chipboard-screw-4x50").every((o) => o.kind === "bore" && o.through)).toBe(true);
    // Every second gap.
    const r2 = buildOne({
      options: { joint_screws: "between_dowels", dowel_pattern: "sequence", top: "full" },
      vars: { dowel_offset_front: 32, dowel_offset_rear: 30, joint_screw_every: 2 },
    });
    expect(refs(partsByCode(r2).SL!, "generic-chipboard-screw-4x50").filter((o) => o.kind === "bore" && o.u < 30).length).toBe(2);
  });
});

describe("Hettich Lift Advanced HK (D42)", () => {
  it("drills sides and flap, hangs the flap on cup hinges in the top, picks the gas springs", () => {
    const r = buildOne({ kind: "wall", presets: ["wall-unit"], vars: { W: 800, H: 500 }, options: { "hardware.flap": "hettich-lift-advanced-hk" }, fronts: [{ type: "flap" }] });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    // Sides: 41 and 85 below the top's underside, 22 / 118 / 75 from the front.
    const side = refs(p.SL!, "hettich-lift-advanced-hk").map((o) => (o.kind === "bore" ? [500 - (o.u as number), 320 - (o.v as number)] : []));
    expect(side).toEqual([[19 + 41, 22], [19 + 41, 118], [19 + 85, 75]]);
    // Flap: two Ø10 per side; cup hinges in the flap, plates in the top.
    expect(refs(p.FL1!, "hettich-lift-advanced-hk").filter((o) => o.kind === "bore" && o.d === 10).length).toBe(4);
    expect(refs(p.FL1!, "generic-hinge-110").length).toBeGreaterThan(0);
    expect(refs(p.TO!, "generic-hinge-110").length).toBeGreaterThan(0);
    // Inside height 462, flap 797 × 497 × 19 MDF ≈ 5.6 kg + 0.4 → 6.0 kg → 300 N is the stronger fit (5.7–7.9).
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "hettich-lift-advanced-hk")).toMatchObject({ article: "9079624" });
  });

  it("reports a flap outside the spring table", () => {
    const r = buildOne({ kind: "wall", presets: ["wall-unit"], vars: { W: 1400, H: 700 }, options: { "hardware.flap": "hettich-lift-advanced-hk" }, fronts: [{ type: "flap" }] });
    // 14.3 kg at 662 inside height: within 17.9 kg overall, but above the 601–720 column (≤ 12.4 kg).
    expect(r.diagnostics.map((d) => d.code)).toEqual(["hardware_no_variant"]);
  });
});
