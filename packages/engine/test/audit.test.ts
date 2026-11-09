import { describe, expect, it } from "vitest";
import type { Part } from "../src/index.ts";
import { buildOne, partsByCode } from "./helpers.ts";

/** Regression tests for bugs found in the logic audit of the cabinet rules and machining. */

/** True when the two parts' boxes share volume (more than rounding). */
const intersect = (a: Part, b: Part): boolean =>
  (["x", "y", "z"] as const).every((k) => Math.min(a.box[k] + a.box[`d${k}`], b.box[k] + b.box[`d${k}`]) - Math.max(a.box[k], b.box[k]) > 0.02);

const errors = (r: ReturnType<typeof buildOne>): string[] => r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);

describe("middle panels at widths that do not divide evenly", () => {
  it("builds a wardrobe whose sections are a third of a millimetre off (no crash, panels meet)", () => {
    // (1373 − 2·19 − 2·19) / 3 = 432.33…: section and panel positions round separately.
    const r = buildOne({ vars: { W: 1373, H: 1120, D: 405, partition_count: 2, door_count: 0 }, options: { interior: "hanging" } });
    expect(errors(r)).toEqual([]);
    const p = partsByCode(r);
    // Every fixed shelf ends exactly on the faces of the panels beside it.
    const faces = ["SL", "MP1", "MP2", "SR"].map((c) => p[c]!.box);
    for (const [k, code] of ["FS1", "FS2", "FS3"].entries()) {
      const b = p[code]!.box;
      expect(b.x, code).toBeCloseTo(faces[k]!.x + faces[k]!.dx, 6);
      expect(b.x + b.dx, code).toBeCloseTo(faces[k + 1]!.x, 6);
    }
    // … and is dowelled into both of them.
    for (const code of ["MP1", "MP2"]) {
      const refs = new Set(p[code]!.operations.flatMap((o) => o.sources.map((s) => s.ref)));
      expect([...refs].filter((x) => x.startsWith(`${code}-FS`)).length, code).toBe(2);
    }
  });

  it("mills connector grooves at such widths (no crash)", () => {
    const r = buildOne({
      vars: { W: 2790, H: 2196, D: 363, partition_count: 2 },
      options: { joint_method: "connector", "hardware.fastener": "lamello-clamex-p14", system_holes: "none", interior: "hanging_first" },
      fronts: [{ type: "open", h: 175 }, { type: "door" }],
    });
    expect(r.diagnostics.map((d) => d.code)).not.toContain("joint_no_dowels");
    expect(r.parts.length).toBeGreaterThan(0);
  });
});

describe("blind corner units", () => {
  it("refuses two doors beside the blind panel: the inner one has no side to hang on", () => {
    const r = buildOne({ vars: { W: 1300, door_count: 2 }, options: { corner: "blind_left" } });
    expect(errors(r)).toContain("blind_corner_two_doors");
    // One door (hinged away from the blind panel) stays fine.
    expect(errors(buildOne({ vars: { W: 1000, door_count: 1 }, options: { corner: "blind_left" } }))).toEqual([]);
  });
});

describe("connectors on upright rails", () => {
  it("puts the housing on the rail's inner face whatever the cabinet height (D36)", () => {
    for (const H of [720, 2000]) {
      const r = buildOne({
        kind: "tall",
        vars: { W: 600, H, D: 560 },
        options: { top: "rails", "rail.front": "upright", "rail.rear": "upright", joint_method: "connector" },
      });
      expect(errors(r)).toEqual([]);
      const p = partsByCode(r);
      const housing = (code: string): string[] => p[code]!.operations.filter((o) => o.kind === "bore" && o.d === 15).map((o) => o.face);
      // Upright rails: thickness along Z, t0 is the rear face. Front rail: inner = rear; rear rail: inner = front.
      expect(housing("RF"), `RF at H ${H}`).toEqual(["t0", "t0"]);
      expect(housing("RR"), `RR at H ${H}`).toEqual(["t1", "t1"]);
    }
  });
});

describe("rear rail at the bottom with a back panel", () => {
  const sink = (rail: string, back: string) =>
    buildOne({ vars: { W: 800, bottom_setback_rear: 120 }, options: { "rail.bottom": rail, back_mount: back } });

  it("grooves (or rebates) a flat bottom rail for the back", () => {
    for (const back of ["groove", "rebate"]) {
      const r = sink("flat", back);
      expect(errors(r)).toEqual([]);
      const p = partsByCode(r);
      // The back reaches into the rail like into a bottom …
      expect(p.BK!.box.y).toBeLessThan(p.RB!.box.y + p.RB!.box.dy);
      // … so the rail carries the same pocket as the sides.
      const pocket = p.RB!.operations.find((o) => o.kind === "pocket" && o.sources[0]!.kind === "back");
      expect(pocket, back).toBeDefined();
      const side = p.SL!.operations.find((o) => o.kind === "pocket" && o.sources[0]!.kind === "back")!;
      if (pocket?.kind === "pocket" && side.kind === "pocket") {
        expect(pocket.w1 - pocket.w0, back).toBeCloseTo(side.w1 - side.w0, 6);
        expect(pocket.v1 - pocket.v0, back).toBeCloseTo(side.v1 - side.v0, 6);
      }
    }
  });

  it("stands an upright bottom rail in front of the back, not in its place", () => {
    for (const back of ["groove", "rebate", "surface", "none"]) {
      const r = sink("upright", back);
      expect(errors(r), back).toEqual([]);
      const p = partsByCode(r);
      const bk = p.BK?.box;
      if (bk) expect(p.RB!.box.z, back).toBeGreaterThanOrEqual(bk.z + bk.dz);
      expect(p.RB!.box.z + p.RB!.box.dz, back).toBeLessThanOrEqual(p.BO!.box.z);
      expect(p.SL!.operations.some((o) => o.sources.some((s) => s.ref === "SL-RB")), back).toBe(true);
    }
  });

  it("asks for the bottom to clear an upright rail that stands in front of the back", () => {
    const r = buildOne({ vars: { W: 800, bottom_setback_rear: 19 }, options: { "rail.bottom": "upright" } });
    expect(r.diagnostics.find((d) => d.code === "bottom_rail_overlap")?.params).toEqual({ need: 37, setback: 19 });
  });
});

describe("legs that meet other machining", () => {
  it("move sideways only where the bottom is, never off its end", () => {
    // The leg at leg_inset_side meets the connector at the rear; one pitch outwards is under the side panel.
    for (const cab of [
      { vars: { W: 600, leg_inset_side: 40 }, options: { joint_method: "connector" } },
      { vars: { W: 600, t_carcase: 25 }, options: { joint_method: "connector" } },
    ]) {
      const r = buildOne(cab);
      expect(errors(r)).toEqual([]);
      const bo = partsByCode(r).BO!;
      const legs = bo.operations.filter((o) => o.sources.some((s) => s.ref === "generic-leg-100"));
      expect(legs.length).toBe(4);
      for (const o of legs) {
        if (o.kind !== "bore") continue;
        expect(o.u - o.d / 2).toBeGreaterThanOrEqual(2);
        expect(o.u + o.d / 2).toBeLessThanOrEqual(bo.length - 2);
      }
    }
  });
});

describe("upright rails and the interior", () => {
  const upright = { top: "rails", "rail.front": "upright", "rail.rear": "upright" };

  it("notches middle panels around upright rails", () => {
    const r = buildOne({
      vars: { W: 1200, partition_count: 1, bottom_setback_rear: 120 },
      options: { ...upright, "rail.bottom": "upright" },
    });
    expect(errors(r)).toEqual([]);
    const p = partsByCode(r);
    const mp = p.MP1!;
    const notches = mp.operations.filter((o) => o.kind === "pocket" && o.w0 === 0 && o.w1 === mp.thickness);
    expect(notches.length).toBe(3);
    for (const code of ["RF", "RR", "RB"]) {
      const b = p[code]!.box;
      // Part-local: u up from the panel's lower end, v forward from its rear edge.
      const want = { u0: Math.max(0, b.y - mp.box.y), u1: Math.min(mp.length, b.y + b.dy - mp.box.y), v0: b.z - mp.box.z, v1: b.z + b.dz - mp.box.z };
      expect(notches.some((o) => o.kind === "pocket" && o.u0 === want.u0 && o.u1 === want.u1 && o.v0 === want.v0 && o.v1 === want.v1), code).toBe(true);
    }
  });

  it("keeps the top drawer below an upright front rail", () => {
    const r = buildOne({ vars: { W: 600 }, options: upright, fronts: [{ type: "drawer", h: 250 }, { type: "door" }] });
    expect(errors(r)).toEqual([]);
    const p = partsByCode(r);
    for (const code of ["DL1", "DR1", "DI1", "DB1"]) {
      expect(intersect(p[code]!, p.RF!), code).toBe(false);
      expect(intersect(p[code]!, p.RR!), code).toBe(false);
    }
    expect(p.DL1!.box.y + p.DL1!.box.dy).toBeLessThanOrEqual(p.RF!.box.y - 3);
  });

  it("keeps shelves out of the height of upright rails", () => {
    const r = buildOne({
      vars: { W: 600, H: 400, shelf_count: 4, door_count: 0, bottom_setback_rear: 120, rail_w: 120 },
      options: { ...upright, "rail.bottom": "upright", system_holes: "none" },
    });
    expect(errors(r)).toEqual([]);
    const p = partsByCode(r);
    for (const sh of r.parts.filter((x) => x.role === "shelf")) {
      for (const rail of ["RF", "RR", "RB"]) expect(intersect(sh, p[rail]!), sh.code + "/" + rail).toBe(false);
    }
  });

  it("reports shelves that cannot fit instead of stacking them into each other", () => {
    // 6 shelves of 19 mm in 262 mm with pins on a 32 mm grid: several land on the same holes.
    const r = buildOne({ vars: { W: 600, H: 300, shelf_count: 6, door_count: 0 }, options: { top: "full" } });
    expect(errors(r)).toEqual(["shelves_too_close"]);
    const free = buildOne({ vars: { W: 600, H: 300, shelf_count: 14, door_count: 0 }, options: { top: "full", system_holes: "none" } });
    expect(errors(free)).toContain("shelves_too_close");
    expect(errors(buildOne({ vars: { W: 600, H: 300, shelf_count: 3, door_count: 0 }, options: { top: "full" } }))).toEqual([]);
  });

  it("refuses a fixed shelf in the height of an upright rail", () => {
    const r = buildOne({ vars: { W: 600 }, options: upright, fronts: [{ type: "open", h: 60 }, { type: "door" }] });
    expect(errors(r)).toContain("fixed_shelf_outside");
  });
});
