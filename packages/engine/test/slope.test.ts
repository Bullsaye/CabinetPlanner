import { describe, expect, it } from "vitest";
import { buildOne, partsByCode, size } from "./helpers.ts";

/** Tall unit 1050 × 1720 × 475 with the top right corner cut at 45°, 280 down (the attic wardrobe). */
const sloped = (vars: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  buildOne({ kind: "tall", presets: ["tall-unit"], vars: { W: 1050, H: 1720, D: 475, door_count: 0, shelf_count: 0, slope_right_drop: 280, ...vars }, ...extra });

describe("sloped top corner (D47)", () => {
  it("shortens the side and the top to the mitres and adds the sloped panel", () => {
    const r = sloped();
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const p = partsByCode(r);
    // Long points on the outer faces: side 1720 − 280, top from the left side to 1050 − 280.
    expect(size(p.SR)).toBe("1440 × 475 × 19");
    expect(size(p.TO)).toBe("751 × 475 × 19");
    expect(p.TS!.length).toBeCloseTo(280 * Math.SQRT2, 1);
    expect(p.TS!.width).toBe(475);
    expect(p.TS!.thickness).toBe(19);
    // 45° slope: every mitre is 22.5°.
    expect(p.SR!.bevels).toEqual({ w2: 22.5 });
    expect(p.TO!.bevels).toEqual({ w2: 22.5 });
    expect(p.TS!.bevels).toEqual({ w1: 22.5, w2: 22.5 });
    expect(p.SL!.bevels).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toContain("slope_joints_manual");
  });

  it("gives the cut parts their cross-section for 3D and drawings", () => {
    const p = partsByCode(sloped());
    // Side: inner face ends 19·tan(22.5°) lower than the outer.
    expect(p.SR!.profile!.points).toEqual([[1031, 0], [1050, 0], [1050, 1440], [1031, 1432.13]]);
    expect(p.TS!.profile!.rotated).toBe(true);
    expect(p.TS!.profile!.points).toHaveLength(4);
  });

  it("cuts the back along the slope, into the sloped panel's groove", () => {
    const p = partsByCode(sloped());
    const bk = p.BK!;
    expect(bk.outline).toBeDefined();
    expect(bk.outline!.length).toBe(5);
    // The sloped panel carries the groove on its inner face, full length.
    const g = p.TS!.operations.find((o) => o.kind === "pocket");
    expect(g).toMatchObject({ face: "t0", u0: 0, u1: p.TS!.length, w0: 0, w1: 8 });
  });

  it("keeps system holes below the side's shortened inner face", () => {
    const p = partsByCode(sloped({ shelf_count: 3, door_count: 1 }));
    const tops = p.SR!.operations.filter((o) => o.kind === "bore" && o.sources.some((s) => s.kind === "system")).map((o) => (o.kind === "bore" ? o.u : 0));
    expect(Math.max(...tops)).toBeLessThanOrEqual(1432.13 - 40);
  });

  it("mirrors for a left slope and allows both", () => {
    const r = sloped({ slope_right_drop: 0, slope_left_drop: 200, slope_left_angle: 30 });
    const p = partsByCode(r);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(size(p.SL)).toBe("1520 × 475 × 19");
    expect(p.TO!.box.x).toBeCloseTo(200 / Math.tan(Math.PI / 6), 1);
    // 30° slope: 15° at the top, 30° at the side.
    expect(p.TS!.bevels).toEqual({ w1: 15, w2: 30 });
    const both = partsByCode(sloped({ slope_left_drop: 200 }));
    expect(both.TS1).toBeDefined();
    expect(both.TS2).toBeDefined();
  });

  it("reports parts the slope would cut and slopes that do not fit", () => {
    const tooBig = sloped({ slope_right_drop: 1600 });
    expect(tooBig.diagnostics.map((d) => d.code)).toContain("slope_too_large");
    // A middle panel right under the slope.
    const cut = sloped({ partition_count: 1 }, { construction: { panels: [] } });
    expect(cut.diagnostics.map((d) => d.code)).not.toContain("slope_cuts_part");
    const cut2 = buildOne({ kind: "tall", presets: ["tall-unit"], vars: { W: 600, H: 1720, D: 475, door_count: 0, shelf_count: 0, partition_count: 1, slope_right_drop: 400 } });
    expect(cut2.diagnostics.map((d) => d.code)).toContain("slope_cuts_part");
    const rails = sloped({}, { options: { top: "rails" } });
    expect(rails.diagnostics.map((d) => d.code)).toContain("slope_needs_full_top");
  });

  it("checks the room ceiling against the cut corner, not the full height", () => {
    const room = { walls: [{ id: "A", length: 3000 }, { id: "B", length: 2500 }, { id: "C", length: 3000 }, { id: "D", length: 2500 }], ceiling: { slopes: [{ wall: "B", knee: 1500, angle: 45 }] } };
    const base = { kind: "tall", presets: ["tall-unit"], place: { wall: "A", x: 1950 } };
    const flat = buildOne({ ...base, vars: { W: 1050, H: 1720, D: 475, plinth_h: 60 } }, { room });
    expect(flat.diagnostics.map((d) => d.code)).toContain("room_above_ceiling");
    const cut = buildOne({ ...base, vars: { W: 1050, H: 1720, D: 475, plinth_h: 60, slope_right_drop: "max(0, H + plinth_h - ceiling_h)" } }, { room });
    expect(cut.diagnostics.map((d) => d.code)).not.toContain("room_above_ceiling");
    expect(partsByCode(cut).SR!.length).toBe(1440);
  });
});
