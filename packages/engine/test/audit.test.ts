import { describe, expect, it } from "vitest";
import { buildOne, partsByCode } from "./helpers.ts";

/** Regression tests for bugs found in the logic audit of the cabinet rules and machining. */

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
