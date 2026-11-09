import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildOne } from "./helpers.ts";

/** Free parts are user data: whatever is entered, the engine answers with parts and diagnostics, never an exception. */
describe("free parts never throw", () => {
  const expr = fc.oneof(
    fc.integer({ min: -50, max: 900 }),
    fc.constantFrom("t_carcase", "W - 2 * t_carcase", "H / 2", "D - 40", "H - t_carcase", "W / 3", "i * 100", "D", "H", "0", "W - t_carcase", "nope"),
  );
  const part = fc.record({
    id: fc.constantFrom("A", "B", "C", "P1", "QQ"),
    plane: fc.constantFrom("horizontal", "vertical", "frontal"),
    x: expr,
    y: expr,
    z: expr,
    dx: fc.option(expr, { nil: undefined }),
    dy: fc.option(expr, { nil: undefined }),
    dz: fc.option(expr, { nil: undefined }),
    joint: fc.constantFrom("auto", "none"),
    repeat: fc.option(fc.constantFrom(1, 2, 3), { nil: undefined }),
    grain: fc.option(fc.constantFrom("x", "y", "z"), { nil: undefined }),
  });
  const bore = fc.record({
    part: fc.constantFrom("SL", "BO", "A", "B1", "DO1"),
    face: fc.constantFrom("t0", "t1", "l1", "l2", "w1", "w2"),
    u: expr,
    v: expr,
    d: fc.constantFrom(5, 8, 35, 0),
    depth: fc.constantFrom(0, 5, 13, 40, "through"),
  });
  it("any mix of parts, bores, omitted parts and joint methods", () => {
    fc.assert(
      fc.property(
        fc.array(part, { maxLength: 4 }),
        fc.array(bore, { maxLength: 4 }),
        fc.subarray(["SL", "SR", "BO", "TO", "RF", "RR", "BK", "DO1", "SH1"]),
        fc.constantFrom("dowel", "connector", "connector_dowel", "none"),
        fc.constantFrom("groove", "rebate", "surface", "none"),
        fc.constantFrom("base", "wall", "tall"),
        (parts, bores, omit, joint_method, back_mount, kind) => {
          const cab = { kind, vars: { W: 800 }, options: { joint_method, back_mount }, construction: { parts, bores, omit } };
          const r = buildOne(cab);
          for (const p of r.parts) {
            for (const v of [p.length, p.width, p.thickness, p.cutLength, p.cutWidth, ...Object.values(p.box)]) expect(Number.isFinite(v)).toBe(true);
            for (const o of p.operations) for (const v of Object.values(o)) if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
          }
          // Deterministic.
          expect(JSON.stringify(buildOne(cab).parts)).toBe(JSON.stringify(r.parts));
        },
      ),
      { numRuns: 400 },
    );
  });
});
