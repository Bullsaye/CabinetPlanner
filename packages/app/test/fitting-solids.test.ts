import { buildProject, loadProject, sceneOf, viewFittingsOf } from "@cabinet-planner/engine";
import { describe, expect, it } from "vitest";
import { fittingSolids } from "../src/lib/fitting-solids.ts";
import wardrobe from "../../../examples/wardrobe-5-sections-clamex.project.json" with { type: "json" };
import example from "../../../examples/kitchen-basic.project.json" with { type: "json" };

const finite = (p: readonly number[]): boolean => p.every(Number.isFinite);

describe("fitting solids for the 3D view (D74)", () => {
  it("every fitting of the examples gives finite solids that follow and need existing parts", () => {
    for (const doc of [wardrobe, example]) {
      for (const c of buildProject(loadProject(doc)).cabinets) {
        const ids = new Set(c.parts.map((p) => p.id));
        for (const f of sceneOf(c).fittings) {
          const solids = fittingSolids(f);
          expect(solids.length).toBeGreaterThan(0);
          for (const s of solids) {
            expect(finite(s.a) && finite(s.b)).toBe(true);
            if (s.shape === "cyl") expect(s.d).toBeGreaterThan(0);
            if (s.follow) expect(ids.has(s.follow)).toBe(true);
            for (const id of s.need) expect(ids.has(id)).toBe(true);
          }
        }
      }
    }
  });

  it("a hinge: the cup in the door, the plate and arm on the carcase part with the plate", () => {
    const c = buildProject(loadProject(example)).cabinets.find((x) => x.resolved.cabinet.id === "B01")!;
    const h = viewFittingsOf(c).find((f) => f.kind === "hinge")!;
    if (h.kind !== "hinge") throw new Error("no hinge");
    const [cup, ...rest] = fittingSolids(h);
    expect(cup!.shape).toBe("cyl");
    expect(cup!.d).toBe(h.d);
    expect(cup!.follow).toBe(h.part);
    // Cup from inside the door (its depth) to just out of its inner face.
    expect(Math.min(cup!.a[2], cup!.b[2])).toBeLessThan(h.at.z);
    expect(rest.length).toBe(3);
    expect(rest.every((s) => s.follow === h.plate!.part)).toBe(true);
    // The arm needs both the door and the side.
    expect(rest[2]!.need).toEqual([h.plate!.part, h.part]);
  });

  it("a slide lies against its panel, as long as its nominal length, behind the front", () => {
    const c = buildProject(loadProject(example)).cabinets.find((x) => x.resolved.cabinet.id === "B03")!;
    for (const f of viewFittingsOf(c)) {
      if (f.kind !== "slide") continue;
      const [s] = fittingSolids(f);
      expect(s!.shape).toBe("box");
      expect(Math.abs(s!.a[2] - s!.b[2])).toBe(f.length);
      expect(Math.max(s!.a[2], s!.b[2])).toBe(f.at.z);
      // On the drawer's side of the panel face, not inside the panel.
      const xs = [s!.a[0], s!.b[0]];
      if (f.normal === "+x") expect(Math.min(...xs)).toBeCloseTo(f.at.x, 6);
      else expect(Math.max(...xs)).toBeCloseTo(f.at.x, 6);
    }
  });
});
