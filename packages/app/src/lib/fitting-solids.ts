/**
 * Fittings as simple solids for the 3D view (D58): cylinders and boxes in
 * cabinet coordinates, built from the engine's view fittings. Positions come
 * from the engine (the drilled holes); only the look of a solid (how thick
 * an arm is drawn) is decided here. Pure: no three.js, no store.
 */
import type { ViewFitting } from "@cabinet-planner/engine";

export type P3 = [number, number, number];
export type Tone = "steel" | "zinc" | "dark";

export interface Solid {
  /** `cyl`: axis from a to b with diameter d. `box`: opposite corners a and b. */
  shape: "cyl" | "box";
  a: P3;
  b: P3;
  d?: number;
  tone: Tone;
  /** The part the solid moves with (explode). */
  follow?: string;
  /** Parts that must be visible for the solid to show. */
  need: string[];
}

const AXES = ["x", "y", "z"] as const;
type Axis = (typeof AXES)[number];
const unit = (dir: string): P3 => {
  const s = dir[0] === "-" ? -1 : 1;
  return [dir[1] === "x" ? s : 0, dir[1] === "y" ? s : 0, dir[1] === "z" ? s : 0];
};
const pt = (q: { x: number; y: number; z: number }): P3 => [q.x, q.y, q.z];
const add = (p: P3, v: P3, k: number): P3 => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];
const dot = (p: P3, v: P3): number => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];

/** Sizes of the drawn solids (mm): typical fittings, not product data. */
const LOOK = {
  cupRim: 1.5,
  plateT: 6,
  plateBarT: 3,
  armT: 11,
  armW: 16,
  pinOut: 9,
  pinIn: 6,
  slideH: 36,
  slideT: 12.7,
  legPlate: 4,
  legFoot: 8,
};

export function fittingSolids(f: ViewFitting): Solid[] {
  switch (f.kind) {
    case "hinge": {
      const C = pt(f.at);
      const nd = unit(f.normal);
      const out: Solid[] = [{ shape: "cyl", a: add(C, nd, -f.depth), b: add(C, nd, LOOK.cupRim), d: f.d, tone: "steel", follow: f.part, need: [f.part] }];
      const pl = f.plate;
      if (!pl || pl.normal[1] === f.normal[1]) {
        // No plate drilled: the arm as a stub towards the hinge edge.
        const e = unit(f.edge);
        const h = unit(`+${AXES.find((a) => a !== f.normal[1] && a !== f.edge[1])!}`);
        out.push({ shape: "box", a: add(add(C, h, -LOOK.armW / 2), nd, LOOK.cupRim), b: add(add(add(C, h, LOOK.armW / 2), e, f.d / 2 + 6), nd, LOOK.armT), tone: "steel", follow: f.part, need: [f.part] });
        return out;
      }
      const P = pt(pl.at);
      const ns = unit(pl.normal);
      const ha: Axis = AXES.find((a) => a !== f.normal[1] && a !== pl.normal[1])!;
      const h = unit(`+${ha}`);
      // Coordinates along nd (from the door into the cabinet), ns (off the carcase face) and the hinge axis.
      const at = (a: number, b: number, c: number): P3 => add(add(add([0, 0, 0], nd, a), ns, b), h, c);
      const a0 = dot(C, nd);
      const a1 = dot(P, nd);
      const b0 = dot(P, ns);
      const hc = dot(C, h);
      const hp = dot(P, h);
      const need = [pl.part];
      // Cross mounting plate: the bar over its holes, the body along the arm.
      out.push({ shape: "box", a: at(a1 - 7, b0, hp - pl.span / 2 - 7), b: at(a1 + 7, b0 + LOOK.plateBarT, hp + pl.span / 2 + 7), tone: "zinc", follow: pl.part, need });
      out.push({ shape: "box", a: at(a1 - 16, b0, hp - 9), b: at(a1 + 20, b0 + LOOK.plateT, hp + 9), tone: "zinc", follow: pl.part, need });
      // Arm from the door's inner face back over the plate.
      out.push({ shape: "box", a: at(a0, b0 + LOOK.plateT, hc - LOOK.armW / 2), b: at(a1 + 12, b0 + LOOK.plateT + LOOK.armT, hc + LOOK.armW / 2), tone: "steel", follow: pl.part, need: [pl.part, f.part] });
      return out;
    }
    case "shelf_pin": {
      const A = pt(f.at);
      const n = unit(f.normal);
      return [{ shape: "cyl", a: add(A, n, -LOOK.pinIn), b: add(A, n, LOOK.pinOut), d: f.d, tone: "steel", follow: f.host, need: [f.host, f.part] }];
    }
    case "slide": {
      const A = pt(f.at);
      const n = unit(f.normal);
      // As thick as the space beside the drawer box allows, at most a ball-bearing rail.
      const th = f.gap > 2 ? Math.min(f.gap - 0.5, LOOK.slideT) : LOOK.slideT;
      return [{ shape: "box", a: add(A, [0, 1, 0], -LOOK.slideH / 2), b: add(add(add(A, n, th), [0, 1, 0], LOOK.slideH / 2), [0, 0, 1], -f.length), tone: "steel", follow: f.part, need: [f.part] }];
    }
    case "leg": {
      const A = pt(f.at);
      const need = f.part ? [f.part] : [];
      const base = { tone: "dark" as const, ...(f.part ? { follow: f.part } : {}), need };
      const up: P3 = [0, 1, 0];
      return [
        // Fixing plate under the bottom, stem, foot on the floor.
        { shape: "box", a: [A[0] - f.d / 2, A[1] - LOOK.legPlate, A[2] - f.d / 2], b: [A[0] + f.d / 2, A[1], A[2] + f.d / 2], ...base },
        { shape: "cyl", a: add(A, up, -LOOK.legPlate), b: add(A, up, -(f.h - LOOK.legFoot)), d: f.d * 0.6, ...base },
        { shape: "cyl", a: add(A, up, -(f.h - LOOK.legFoot)), b: add(A, up, -f.h), d: f.d * 0.85, ...base },
      ];
    }
    case "rail":
      return [{ shape: "cyl", a: pt(f.at), b: add(pt(f.at), [1, 0, 0], f.length), d: f.d, tone: "steel", need: [] }];
    case "connector": {
      const A = pt(f.at);
      const n = unit(f.normal);
      return [{ shape: "cyl", a: add(A, n, -Math.min(f.depth, 12)), b: add(A, n, 0.8), d: f.d, tone: "zinc", follow: f.part, need: [f.part] }];
    }
  }
}
