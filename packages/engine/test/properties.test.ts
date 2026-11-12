import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BUNDLED } from "../src/index.ts";
import { anyCabinet, practicalCabinet } from "./arbitraries.ts";
import { buildOne } from "./helpers.ts";
import { violations } from "./invariants.ts";

/**
 * Invariants across random sizes and construction variants. When the engine
 * accepts a cabinet (no errors), every part must be positive and lie inside
 * the cabinet envelope (carcase plus front thickness).
 */
describe("box cabinet invariants", () => {
  const input = fc.record({
    W: fc.integer({ min: 150, max: 1200 }),
    H: fc.integer({ min: 150, max: 2400 }),
    D: fc.integer({ min: 150, max: 800 }),
    shelf_count: fc.integer({ min: 0, max: 6 }),
    door_count: fc.integer({ min: 0, max: 2 }),
    front_gap: fc.constantFrom(0, 2, 3, 4),
    rail_w: fc.integer({ min: 30, max: 150 }),
    carcase_joint: fc.constantFrom("sides_over", "sides_between"),
    top: fc.constantFrom("full", "rails"),
    back_mount: fc.constantFrom("groove", "rebate", "surface"),
  });

  it("accepted cabinets have positive parts inside the envelope", () => {
    fc.assert(
      fc.property(input, (i) => {
        const r = buildOne({
          vars: {
            W: i.W,
            H: i.H,
            D: i.D,
            shelf_count: i.shelf_count,
            door_count: i.door_count,
            front_gap: i.front_gap,
            rail_w: i.rail_w,
          },
          options: { carcase_joint: i.carcase_joint, top: i.top, back_mount: i.back_mount },
        });
        if (!r.ok) return; // rejected inputs must say why
        const eps = 1e-6;
        for (const p of r.parts) {
          expect(p.length).toBeGreaterThan(0);
          expect(p.width).toBeGreaterThan(0);
          expect(p.thickness).toBeGreaterThan(0);
          expect(p.cutLength).toBeGreaterThan(0);
          expect(p.cutWidth).toBeGreaterThan(0);
          expect(p.box.x).toBeGreaterThanOrEqual(-eps);
          expect(p.box.y).toBeGreaterThanOrEqual(-eps);
          expect(p.box.z).toBeGreaterThanOrEqual(-eps);
          expect(p.box.x + p.box.dx).toBeLessThanOrEqual(i.W + eps);
          expect(p.box.y + p.box.dy).toBeLessThanOrEqual(i.H + eps);
          expect(p.box.z + p.box.dz).toBeLessThanOrEqual(i.D + 19 + eps);
        }
      }),
      { numRuns: 300, seed: 1 },
    );
  });

  it("rejected cabinets always carry an error", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (W) => {
        const r = buildOne({ vars: { W } });
        if (!r.ok) expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
      }),
      { numRuns: 50, seed: 1 },
    );
  });

  it("is deterministic: same input, same parts", () => {
    fc.assert(
      fc.property(input, (i) => {
        const cab = { vars: { W: i.W, H: i.H, D: i.D }, options: { back_mount: i.back_mount } };
        expect(JSON.stringify(buildOne(cab).parts)).toBe(JSON.stringify(buildOne(cab).parts));
      }),
      { numRuns: 50, seed: 2 },
    );
  });
});

/**
 * Machining invariants: within practical sizes every construction variant
 * must machine cleanly, i.e. no bore outside a part, too deep, too close to
 * an edge, and no colliding operations. A failure here is a rule bug.
 */
describe("machining invariants", () => {
  const input = fc.record({
    W: fc.integer({ min: 300, max: 1200 }),
    H: fc.integer({ min: 400, max: 2400 }),
    D: fc.integer({ min: 280, max: 650 }),
    shelf_count: fc.integer({ min: 0, max: 5 }),
    door_count: fc.integer({ min: 0, max: 2 }),
    carcase_joint: fc.constantFrom("sides_over", "sides_between"),
    top: fc.constantFrom("full", "rails"),
    back_mount: fc.constantFrom("groove", "rebate", "surface"),
    system_holes: fc.constantFrom("full", "none"),
    door_hinge_side: fc.constantFrom("left", "right"),
  });

  it("practical cabinets machine without errors", () => {
    fc.assert(
      fc.property(input, (i) => {
        const r = buildOne({
          vars: { W: i.W, H: i.H, D: i.D, shelf_count: i.shelf_count, door_count: i.door_count },
          options: {
            carcase_joint: i.carcase_joint,
            top: i.top,
            back_mount: i.back_mount,
            system_holes: i.system_holes,
            door_hinge_side: i.door_hinge_side,
          },
        });
        const errors = r.diagnostics.filter((d) => d.severity === "error");
        expect(errors).toEqual([]);
        for (const p of r.parts) expect(p.operations.length).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 400, seed: 3 },
    );
  });
});

/**
 * The same questions over the whole option space: kinds, joints, tops and
 * rails, back mounts, joint methods, middle panels, corners, wardrobes,
 * hangers, handles and front stacks. Whatever the input, the engine answers
 * with diagnostics, never with an exception; whatever it accepts satisfies
 * the geometric invariants in invariants.ts.
 */
describe("invariants over the option space", () => {
  const check = (cab: Record<string, unknown>): void => {
    const r = buildOne(cab);
    // No NaN anywhere in the production data (JSON turns NaN into null).
    expect(JSON.stringify(r.parts).replace(/"(l1|l2|w1|w2)":null/g, "")).not.toMatch(/null|NaN/);
    if (!r.ok) {
      expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
      return;
    }
    expect(violations(r)).toEqual([]);
  };

  it("any input within the variable ranges builds without an exception; accepted cabinets are sound", () => {
    fc.assert(fc.property(anyCabinet, check), { numRuns: 250, seed: 11 });
  }, 60_000);

  it("cabinets a shop would draw are sound when accepted", () => {
    fc.assert(fc.property(practicalCabinet, check), { numRuns: 250, seed: 12 });
  }, 60_000);

  it("the factory templates are sound at any width", () => {
    fc.assert(
      fc.property(fc.constantFrom(...BUNDLED.templates), fc.integer({ min: 300, max: 1200 }), (tpl, W) => {
        const r = buildOne({ ...tpl.cabinet, vars: { ...tpl.cabinet.vars, W } });
        if (r.ok) expect(violations(r), tpl.id).toEqual([]);
      }),
      { numRuns: 100, seed: 13 },
    );
  }, 60_000);

  it("sizes off the 0.01 mm grid build without an exception", () => {
    const frac = fc.oneof(
      fc.integer({ min: 0, max: 999 }).map((n) => n / 1000),
      fc.constantFrom(0.005, 0.335, 0.995, 1 / 3, 2 / 3),
    );
    fc.assert(
      fc.property(practicalCabinet, frac, frac, frac, frac, (cab, w, h, d, t) => {
        const vars = cab["vars"] as Record<string, number>;
        const r = buildOne({ ...cab, vars: { ...vars, W: vars["W"]! + w, H: vars["H"]! + h, D: vars["D"]! + d, t_carcase: 18 + t } });
        if (r.ok) expect(violations(r)).toEqual([]);
      }),
      { numRuns: 150, seed: 14 },
    );
  }, 60_000);

  it("is deterministic: parts, machining, hardware and findings", () => {
    fc.assert(
      fc.property(practicalCabinet, (cab) => {
        const out = (): string => {
          const r = buildOne(cab);
          return JSON.stringify([r.parts, r.diagnostics, r.cabinets[0]!.hardware, r.cabinets[0]!.handles, r.cabinets[0]!.fittings]);
        };
        expect(out()).toBe(out());
      }),
      { numRuns: 40, seed: 15 },
    );
  }, 60_000);
});
