import type { HandlePlacement } from "../cabinet/machining.ts";
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
  /** Non-rectangular parts: contour on the t0 face (cabinet coordinates) and the thickness axis. */
  outline?: { points: { x: number; y: number; z: number }[]; normal: Axis; thickness: number };
  bores: SceneBore[];
  pockets: Box[];
}

export interface Scene {
  cabinet: string;
  size: { W: number; H: number; D: number; plinth: number };
  parts: ScenePart[];
  handles: HandlePlacement[];
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
    handles: c.handles,
    parts: c.parts.map((p) => ({
      id: p.id,
      code: p.code,
      role: p.role,
      material: p.material,
      box: p.box,
      // Parts cut by a slope (D47): their cross-section extruded along Z.
      ...(p.profile
        ? p.profile.axis === "x"
          ? { outline: { points: p.profile.points.map(([z, y]) => ({ x: p.box.x, y, z })), normal: "x" as const, thickness: p.box.dx } }
          : { outline: { points: p.profile.points.map(([x, y]) => ({ x, y, z: p.box.z })), normal: "z" as const, thickness: p.box.dz } }
        : p.outline
        ? { outline: { points: p.outline.map(([u, v]) => toCabinet(p, { u, v, w: 0 })), normal: cabinetAxisOf(p, "w"), thickness: p.thickness } }
        : {}),
      bores: p.operations.flatMap((o) => {
        // A part at an angle keeps its operations in its own frame; the scene shows none.
        if (o.kind !== "bore" || p.profile?.rotated) return [];
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
        if (o.kind !== "pocket" || p.profile?.rotated) return [];
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
