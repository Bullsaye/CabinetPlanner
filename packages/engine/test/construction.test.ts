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
