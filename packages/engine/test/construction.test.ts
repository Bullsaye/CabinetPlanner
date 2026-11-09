import { describe, expect, it } from "vitest";
import { dowelPositions } from "../src/index.ts";
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
