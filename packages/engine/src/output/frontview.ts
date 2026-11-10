import type { CabinetResult } from "../project.ts";
import { toCabinet } from "../ops.ts";
import type { PartRole } from "../part.ts";

/**
 * Front elevation of one cabinet, taken from its built parts (D54): every
 * part as its rectangle in the X/Y plane of the cabinet (D2), back to front,
 * plus hinge and handle positions as they are drilled. Holds no styling and
 * no text; the app draws it.
 */
export interface FrontViewPart {
  id: string;
  code: string;
  role: PartRole;
  /** Fronts (doors, drawer fronts, flaps, panels in the front plane). */
  front: boolean;
  /** Rectangle in cabinet X/Y. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Non-rectangular parts lying in the front plane: their contour in X/Y. */
  points?: [number, number][];
  /** Fronts: index into the front stack (`CabinetResult.layout.zones`, top to bottom). */
  zone?: number;
  /** Edge the front turns on: doors left or right, flaps at the top. */
  hinge?: "left" | "right" | "top";
}

export interface FrontViewHinge {
  part: string;
  edge: "left" | "right" | "top";
  /** Centre of the cup bore. */
  x: number;
  y: number;
  /** Cup diameter. */
  d: number;
}

export interface FrontViewHandle {
  part: string;
  /** Bar from (x1, y1) to (x2, y2); a knob has both ends at its centre. */
  kind: "bar" | "knob";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Bar diameter or knob size. */
  d: number;
}

export interface FrontView {
  cabinet: string;
  kind: "base" | "wall" | "tall";
  W: number;
  H: number;
  /** Height of the carcase underside above the floor; 0 for wall units (no floor drawn). */
  plinth: number;
  /** Extent of everything drawn, floor included. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Back to front: later parts cover earlier ones. */
  parts: FrontViewPart[];
  hinges: FrontViewHinge[];
  handles: FrontViewHandle[];
  legs: { x: number; y0: number; y1: number; d: number }[];
}

const FRONT_ROLES: readonly PartRole[] = ["door", "drawer_front", "blind_panel", "appliance_front", "flap", "ceiling_filler"];

/** Whether a role is a front (hidden by "show fronts" in the views). */
export const isFrontRole = (role: PartRole): boolean => FRONT_ROLES.includes(role);

export function frontViewOf(c: CabinetResult): FrontView {
  const v = (n: string): number => c.resolved.values.get(n) ?? 0;
  const kind = c.resolved.cabinet.kind;
  const zones = c.layout?.zones ?? [];
  const hingeOf = new Map<string, "left" | "right" | "top">();
  for (const d of c.layout?.doors ?? []) hingeOf.set(d.code, d.hinge);
  for (const d of c.layout?.applianceFronts ?? []) hingeOf.set(d.code, d.hinge);
  for (const f of c.layout?.flaps ?? []) hingeOf.set(f.code, "top");
  const hingeItem = c.resolved.options.get("hardware.hinge")?.value;

  const parts: (FrontViewPart & { z: number })[] = [];
  const hinges: FrontViewHinge[] = [];
  for (const p of c.parts) {
    const b = p.box;
    const front = isFrontRole(p.role);
    const out: FrontViewPart & { z: number } = { id: p.id, code: p.code, role: p.role, front, x: b.x, y: b.y, w: b.dx, h: b.dy, z: b.z + b.dz };
    if (p.outline && p.lengthAxis !== "z" && p.widthAxis !== "z") {
      out.points = p.outline.map(([u, w]) => {
        const q = toCabinet(p, { u, v: w, w: 0 });
        return [q.x, q.y];
      });
    }
    if (front) {
      const yc = b.y + b.dy / 2;
      const zi = zones.findIndex((z) => yc >= z.y0 && yc <= z.y1);
      if (zi >= 0) out.zone = zi;
      const edge = hingeOf.get(p.code);
      if (edge) {
        out.hinge = edge;
        // The cup is the largest bore the hinge item drills into the front.
        const cups = p.operations.filter((o) => o.kind === "bore" && o.sources.some((s) => s.kind === "hardware" && s.ref === hingeItem));
        const d = Math.max(0, ...cups.map((o) => (o.kind === "bore" ? o.d : 0)));
        for (const o of cups) {
          if (o.kind !== "bore" || o.d !== d) continue;
          const q = toCabinet(p, o);
          hinges.push({ part: p.id, edge, x: q.x, y: q.y, d });
        }
      }
    }
    parts.push(out);
  }
  // Painter's order by the face towards the viewer; fronts always last.
  parts.sort((a, b) => Number(a.front) - Number(b.front) || a.z - b.z);

  const handles: FrontViewHandle[] = c.handles.flatMap((h): FrontViewHandle[] => {
    const a = h.points[0];
    const b = h.points[h.points.length - 1];
    if (!a || !b) return [];
    if (h.points.length === 1) return [{ part: h.part, kind: "knob", x1: a.x, y1: a.y, x2: a.x, y2: a.y, d: h.size ?? 30 }];
    const cc = Math.hypot(b.x - a.x, b.y - a.y);
    const len = Math.max(h.length ?? cc + 40, cc);
    const k = cc > 0 ? (len - cc) / 2 / cc : 0;
    const ex = (b.x - a.x) * k;
    const ey = (b.y - a.y) * k;
    return [{ part: h.part, kind: "bar", x1: a.x - ex, y1: a.y - ey, x2: b.x + ex, y2: b.y + ey, d: h.barD ?? 12 }];
  });

  const legs = c.fittings.flatMap((f) => (f.kind === "leg" && f.h ? [{ x: f.x, y0: f.y - f.h, y1: f.y, d: f.d }] : []));
  const plinth = kind === "wall" ? 0 : v("plinth_h");
  const bounds = { x0: 0, y0: -plinth, x1: v("W"), y1: v("H") };
  for (const p of parts) {
    bounds.x0 = Math.min(bounds.x0, p.x);
    bounds.y0 = Math.min(bounds.y0, p.y);
    bounds.x1 = Math.max(bounds.x1, p.x + p.w);
    bounds.y1 = Math.max(bounds.y1, p.y + p.h);
  }
  return {
    cabinet: c.resolved.cabinet.id,
    kind,
    W: v("W"),
    H: v("H"),
    plinth,
    bounds,
    parts: parts.map(({ z: _z, ...rest }) => rest),
    hinges,
    handles,
    legs,
  };
}
