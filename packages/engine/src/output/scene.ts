import type { CabinetResult } from "../project.ts";
import { faceAxes, toCabinet, type Face } from "../ops.ts";
import { thicknessAxis, type Axis, type Box, type Part, type PartRole } from "../part.ts";

/**
 * A view-ready description of a cabinet in cabinet coordinates (D2): one box
 * per part plus its machining as simple solids. Used by the 3D view; holds
 * no styling and no text.
 */
export interface SceneBore {
  /** Entry point on the part surface. */
  at: { x: number; y: number; z: number };
  /** Drilling direction into the part. */
  dir: { axis: Axis; sign: 1 | -1 };
  d: number;
  depth: number;
  source: string;
}

export interface ScenePart {
  id: string;
  code: string;
  role: PartRole;
  material: string;
  box: Box;
  bores: SceneBore[];
  pockets: Box[];
}

export interface Scene {
  cabinet: string;
  size: { W: number; H: number; D: number; plinth: number };
  parts: ScenePart[];
}

function cabinetAxisOf(part: Part, local: "u" | "v" | "w"): Axis {
  if (local === "u") return part.lengthAxis;
  if (local === "v") return part.widthAxis;
  return thicknessAxis(part.lengthAxis, part.widthAxis);
}

const atMax = (f: Face): boolean => f === "t1" || f === "l2" || f === "w2";

export function sceneOf(c: CabinetResult): Scene {
  const v = (n: string): number => c.resolved.values.get(n) ?? 0;
  return {
    cabinet: c.resolved.cabinet.id,
    size: { W: v("W"), H: v("H"), D: v("D"), plinth: v("plinth_h") },
    parts: c.parts.map((p) => ({
      id: p.id,
      code: p.code,
      role: p.role,
      material: p.material,
      box: p.box,
      bores: p.operations.flatMap((o) => {
        if (o.kind !== "bore") return [];
        const { normal } = faceAxes(o.face);
        return [
          {
            at: toCabinet(p, o),
            dir: { axis: cabinetAxisOf(p, normal), sign: atMax(o.face) ? -1 : 1 } as const,
            d: o.d,
            depth: o.depth,
            source: o.sources.map((s) => `${s.kind}:${s.ref}`).join("+"),
          },
        ];
      }),
      pockets: p.operations.flatMap((o) => {
        if (o.kind !== "pocket") return [];
        const a = toCabinet(p, { u: o.u0, v: o.v0, w: o.w0 });
        const b = toCabinet(p, { u: o.u1, v: o.v1, w: o.w1 });
        return [
          {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            z: Math.min(a.z, b.z),
            dx: Math.abs(b.x - a.x),
            dy: Math.abs(b.y - a.y),
            dz: Math.abs(b.z - a.z),
          },
        ];
      }),
    })),
  };
}
