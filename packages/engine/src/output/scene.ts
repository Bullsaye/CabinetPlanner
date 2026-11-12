import type { HandlePlacement } from "../cabinet/machining.ts";
import type { Library } from "../library.ts";
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
  /** Goes through the whole part (D23). */
  through?: true;
  /** The far opening of a through bore: the same hole seen from the opposite face (not a second bore). */
  exit?: true;
}

export interface ScenePart {
  id: string;
  code: string;
  role: PartRole;
  material: string;
  /** Display colour (#rrggbb) from the surface finish, else the board (D67). */
  color?: string;
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

export function sceneOf(c: CabinetResult, library?: Library): Scene {
  const colorOf = (p: Part): string | undefined =>
    (p.surface ? library?.surfaces.get(p.surface)?.color : undefined) ?? library?.materials.get(p.material)?.color;
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
      ...(colorOf(p) ? { color: colorOf(p)! } : {}),
      box: p.box,
      ...(p.outline
        ? { outline: { points: p.outline.map(([u, v]) => toCabinet(p, { u, v, w: 0 })), normal: cabinetAxisOf(p, "w"), thickness: p.thickness } }
        : {}),
      bores: p.operations.flatMap((o) => {
        if (o.kind !== "bore") return [];
        const { normal } = faceAxes(o.face);
        const axis = cabinetAxisOf(p, normal);
        const sign = atMax(o.face) ? -1 : 1;
        const entry: SceneBore = {
          at: toCabinet(p, o),
          dir: { axis, sign },
          d: o.d,
          depth: o.depth,
          source: o.sources.map((s) => `${s.kind}:${s.ref}`).join("+"),
          ...(o.through ? { through: true as const } : {}),
        };
        if (!o.through) return [entry];
        // A through bore opens on both faces: its far opening is listed too,
        // seen from that face, so a view that marks openings shows both.
        const far = { ...entry.at };
        far[axis] += sign * o.depth;
        return [entry, { ...entry, at: far, dir: { axis, sign: sign === 1 ? -1 : 1 }, exit: true as const }];
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
