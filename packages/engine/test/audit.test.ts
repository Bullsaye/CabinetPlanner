import { describe, expect, it } from "vitest";
import type { Part } from "../src/index.ts";
import { dowelPositions } from "../src/cabinet/machining.ts";
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

describe("sizes from formulas (thousandths of a millimetre)", () => {
  it("builds and machines cabinets whose sizes do not end on 0.01 mm", () => {
    const cases = [
      { vars: { W: "2000 / 3", H: "2200 / 3", D: "1700 / 3", t_carcase: "55 / 3" } },
      { vars: { W: 900.342, H: 720.802, D: 560.991, t_carcase: 18.288 }, options: { back_mount: "surface" } },
      { vars: { W: 900.002, H: 720.497, D: "1682 / 3", t_carcase: 18.335, partition_count: 1 }, options: { carcase_joint: "sides_between", back_mount: "surface", joint_method: "connector" } },
      { vars: { W: 900.083, H: 720.096, D: 560.229, t_carcase: 18.008 }, options: { back_mount: "surface" } },
      { vars: { W: 900.037, H: 720.103, D: 560.233, t_carcase: 18.33, partition_count: 3 }, options: { carcase_joint: "sides_between", back_mount: "surface" } },
    ];
    for (const cab of cases) {
      const r = buildOne(cab);
      expect(errors(r), JSON.stringify(cab.vars)).toEqual([]);
      const p = partsByCode(r);
      // The horizontals end exactly on the sides' inner faces.
      if (!("options" in cab) || cab.options?.carcase_joint !== "sides_between") {
        expect(p.BO!.box.x).toBe(p.SL!.box.x + p.SL!.box.dx);
        expect(Math.abs(p.BO!.box.x + p.BO!.box.dx - p.SR!.box.x)).toBeLessThan(1e-9);
      }
      // Board thickness is the variable, not a difference of rounded faces.
      expect(p.SR!.thickness).toBe(p.SL!.thickness);
    }
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

describe("dowel sequence pattern (D35)", () => {
  const o = { pitch: 32, offsetFront: 37, offsetRear: 20, maxSpacing: 160, minCount: 2, sequence: { second: 32, spacing: 128 } };

  it("moves a blocked front position to the rear, never in front of dowel_offset_front", () => {
    // Positions from the front: 37, 69, 197, 325, 453 — all taken (e.g. by the shelf on the other face of a middle panel).
    // 37 and 69 cannot move forward (D64): half a pitch back (D45); the others one pitch forward.
    const taken = new Set([37, 69, 197, 325, 453].map((p) => 562 - p));
    const zs = dowelPositions(0, 562, o, (z) => !taken.has(z));
    const fromFront = zs.map((z) => 562 - z);
    expect(fromFront).toEqual([53, 85, 165, 293, 421]);
    expect(Math.min(...fromFront)).toBeGreaterThanOrEqual(o.offsetFront);
  });

  it("drops the only position of a joint too short for the rear offset instead of moving it out", () => {
    expect(dowelPositions(0, 50, o)).toEqual([]);
    expect(dowelPositions(0, 60, o).map((z) => 60 - z)).toEqual([37]);
  });

  it("dowels fixed shelves on both faces of a middle panel", () => {
    const r = buildOne({
      kind: "tall",
      presets: ["tall-unit", "wardrobe"],
      vars: { W: 1000, partition_count: 1 },
      options: { dowel_pattern: "sequence" },
    });
    expect(errors(r)).toEqual([]);
    const mp = partsByCode(r).MP1!;
    for (const ref of ["MP1-FS1", "MP1-FS2"]) {
      const front = mp.operations.filter((x) => x.kind === "bore" && x.sources.some((s) => s.ref === ref)).map((x) => (x.kind === "bore" ? mp.width - x.v : 0));
      expect(front.length, ref).toBeGreaterThanOrEqual(4);
      expect(Math.min(...front), ref).toBeGreaterThanOrEqual(37);
    }
  });
});

describe("connector slots (Clamex)", () => {
  it("keeps slots of one joint apart at every depth", () => {
    // The grid leaves the rearmost position one pitch (D 430) or two (D 460) behind the one before: 69.6 mm slots overlap.
    for (const D of [430, 460, 560]) {
      const r = buildOne({ vars: { W: 600, D }, options: { joint_method: "connector", "hardware.fastener": "lamello-clamex-p14", system_holes: "none", "hardware.shelf_support": null } });
      expect(r.diagnostics, `D ${D}`).toEqual([]);
      const slots = partsByCode(r)
        .SL!.operations.filter((o) => o.kind === "pocket" && o.sources.some((s) => s.group?.startsWith("SL-BO@")))
        .map((o) => (o.kind === "pocket" ? [o.v0, o.v1] : [0, 0]))
        .sort((a, b) => a[0]! - b[0]!);
      expect(slots.length, `D ${D}`).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < slots.length; i++) expect(slots[i]![0]!, `D ${D}`).toBeGreaterThanOrEqual(slots[i - 1]![1]! + 2);
    }
  });
});

describe("hardware items with data that cannot be machined", () => {
  const withItem = (drilling: Record<string, unknown>[], options: Record<string, unknown> = { joint_method: "connector", "hardware.fastener": "x" }) =>
    buildOne({ options }, { library: { hardware: [{ id: "x", name: { en: "x" }, category: "connector", drilling }] } });

  it("reports a through hole into a panel end instead of crashing", () => {
    const r = withItem([{ mount: "edge", d: 5, depth: 0, a: 0, b: 0, through: true }]);
    expect(r.diagnostics.filter((d) => d.code === "hardware_drill_invalid").map((d) => d.params)).toEqual([{ item: "x", index: 1, field: "through", detail: "edge" }]);
    const screws = withItem([{ mount: "edge", d: 3, depth: 0, a: 0, b: 0, through: true }], { joint_screws: "between_dowels", "hardware.joint_screw": "x" });
    expect(errors(screws)).toEqual(["hardware_drill_invalid"]);
  });

  it("does not mill a slot through the panel it is cut into", () => {
    const r = withItem([{ mount: "face", op: "groove", d: 7, depth: 30, len: 60, a: 0, b: 0 }]);
    expect(errors(r)).toContain("joint_no_dowels");
    expect(r.parts.every((p) => p.operations.every((o) => o.kind !== "pocket" || o.sources[0]!.kind !== "hardware"))).toBe(true);
  });

  it("reports diameters, depths and slot lengths that are not positive", () => {
    const fields = (drilling: Record<string, unknown>[]): unknown[] => [...new Set(withItem(drilling).diagnostics.filter((d) => d.code === "hardware_drill_invalid").map((d) => d.params["field"]))];
    expect(fields([{ mount: "face", d: -5, depth: 10, a: 0, b: 0 }])).toEqual(["d"]);
    expect(fields([{ mount: "face", d: 5, depth: -3, a: 0, b: 0 }])).toEqual(["depth"]);
    expect(fields([{ mount: "face", op: "groove", d: 7, depth: 10, a: 0, b: 0 }])).toEqual(["len"]);
    // Through holes carry no depth.
    expect(fields([{ mount: "face", d: 5, depth: 0, a: 0, b: 0, through: true }])).toEqual([]);
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

  it("refuses upright rails higher than the carcase leaves room for", () => {
    const r = buildOne({ vars: { W: 600, H: 154, rail_w: 199, door_count: 0, shelf_count: 0 }, options: upright });
    expect(r.diagnostics.find((d) => d.code === "upright_rails_too_high")?.params).toEqual({ height: 154, over: 64 });
  });

  it("refuses a fixed shelf in the height of an upright rail", () => {
    const r = buildOne({ vars: { W: 600 }, options: upright, fronts: [{ type: "open", h: 60 }, { type: "door" }] });
    expect(errors(r)).toContain("fixed_shelf_outside");
  });
});

describe("hinges and fixed panels (D65)", () => {
  it("moves a hinge whose plate would sit on the end of a fixed panel towards the door's middle", async () => {
    const { BUNDLED, buildProject, loadProject } = await import("../src/index.ts");
    const tpl = BUNDLED.templates.find((t) => t.id === "tall-fridge")!;
    const r = buildProject(loadProject({ schemaVersion: 1, name: "T", cabinets: [{ id: "X1", type: "box", ...tpl.cabinet }] }));
    expect(r.diagnostics).toEqual([]);
    const side = r.parts.find((p) => p.code === "SL")!;
    const panels = r.parts.filter((p) => p.role === "fixed_shelf");
    const plate = side.operations.filter((o) => o.kind === "bore" && o.sources.some((s) => s.kind === "hardware" && s.ref.includes("hinge")));
    expect(plate.length).toBeGreaterThan(0);
    for (const o of plate) {
      const y = side.box.y + (o as { u: number }).u;
      // Clear of the panel end by the hole radius plus the remaining wall (2.5 + 2).
      for (const p of panels) expect(y <= p.box.y - 4.5 || y >= p.box.y + p.box.dy + 4.5).toBe(true);
    }
    // The fridge front itself carries no hinges: it is fixed to the appliance door (D30).
    const front = r.parts.find((p) => p.role === "appliance_front")!;
    expect(front.operations.filter((o) => o.sources.some((s) => s.ref.includes("hinge")))).toEqual([]);
  });
});

describe("door handles by grip height (D66)", () => {
  const ys = (r: ReturnType<typeof buildOne>, part: string): number[] => r.cabinets[0]!.handles.filter((h) => h.part === part).flatMap((h) => h.points.map((p) => p.y));
  const handle = { "hardware.handle": "generic-bar-160" };
  it("upper door of a tall unit: at grip height, not at its top; lower door: at the top; full-height door: at grip height", () => {
    const r = buildOne({ kind: "tall", presets: ["tall-unit"], options: handle, fronts: [{ type: "door" }, { type: "door", h: 717 }] });
    const [up, low] = [r.parts.find((p) => p.code === "DO1")!, r.parts.find((p) => p.code === "DO2")!];
    // The upper door starts at 720 and spans the grip height (950 in the cabinet): centred on it, not 2 m up.
    expect(ys(r, up.id)).toEqual([870, 1030]);
    expect(ys(r, low.id)).toEqual([low.box.y + low.box.dy - 220, low.box.y + low.box.dy - 60]);
    const one = buildOne({ kind: "tall", presets: ["tall-unit"], options: handle });
    // Centred on 1050 above the floor, plinth 100: 950 in the cabinet.
    expect(ys(one, "C1-DO1")).toEqual([870, 1030]);
  });
  it("base and wall units keep their handle ends", () => {
    const b = buildOne({ options: handle });
    const d = b.parts.find((p) => p.code === "DO1")!;
    expect(ys(b, d.id)[1]).toBe(d.box.y + d.box.dy - 60);
    const w = buildOne({ kind: "wall", presets: ["wall-unit"], options: handle });
    const dw = w.parts.find((p) => p.code === "DO1")!;
    expect(ys(w, dw.id)[0]).toBe(dw.box.y + 60);
  });
  it("handle.door_y end keeps the handle at the door end by cabinet kind (D51, D72)", () => {
    const r = buildOne({ kind: "tall", presets: ["tall-unit"], options: { ...handle, "handle.door_y": "end" } });
    const d = r.parts.find((p) => p.code === "DO1")!;
    expect(ys(r, d.id)).toEqual([d.box.y + d.box.dy - 220, d.box.y + d.box.dy - 60]);
  });
});

describe("upright rails and middle panels through (D46, D64)", () => {
  it("rails split per section end at the panel: no notch in it, joints found", () => {
    const r = buildOne({ kind: "base", vars: { W: 1000, partition_count: 1 }, options: { partition_joint: "through", top: "rails", "rail.front": "upright", "rail.rear": "upright", carcase_joint: "sides_over" } });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const mp = partsByCode(r).MP1!;
    expect(mp.operations.filter((o) => o.kind === "pocket" && o.sources.some((s) => /^R[FR]\d/.test(s.ref)))).toEqual([]);
  });
});
