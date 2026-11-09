import { z } from "zod";
import type { Diagnostic } from "../diagnostics.ts";
import { evaluateGraph } from "../graph.ts";
import type { CabinetResult } from "../project.ts";
import { roundMm } from "../part.ts";

/**
 * Room planning (DECISIONS.md D28). Plan coordinates: X east, Y north, mm,
 * origin at the start of the first wall's inner face. Walls run clockwise
 * (the room interior is on the right of each wall's direction); lengths are
 * measured along the inner face. A cabinet stands with its back on a wall:
 * its X runs along the wall, its front (+Z) faces into the room.
 */
const VarInput = z.union([z.number(), z.string().trim().min(1)]);

export const WallSchema = z.object({
  id: z.string().min(1).max(8),
  length: VarInput,
  height: VarInput.optional(),
  thickness: z.number().positive().default(100),
  /** Turn at the end of this wall into the next one. */
  turn: z.enum(["right", "left"]).default("right"),
});

export const OpeningSchema = z.object({
  wall: z.string().min(1),
  kind: z.enum(["window", "door", "opening"]),
  /** From the wall's start to the opening's left edge (as seen from inside). */
  x: VarInput,
  width: VarInput,
  /** Sill height above the floor (doors: 0). */
  sill: VarInput.default(0),
  height: VarInput,
  /** Doors: hinge side as seen from inside the room. */
  hinge: z.enum(["left", "right"]).default("left"),
});

export const RoomSchema = z.object({
  walls: z.array(WallSchema).min(1).max(24),
  openings: z.array(OpeningSchema).default([]),
});
export type RoomInput = z.infer<typeof RoomSchema>;

export const PlacementSchema = z.object({
  wall: z.string().min(1),
  /** From the wall's start to the cabinet's left side; empty = next in the run. */
  x: VarInput.optional(),
});
export type PlacementInput = z.infer<typeof PlacementSchema>;

type Vec2 = [number, number];

export interface WallLayout {
  id: string;
  index: number;
  start: Vec2;
  end: Vec2;
  /** Unit direction along the wall and towards the room. */
  d: Vec2;
  n: Vec2;
  length: number;
  height: number;
  thickness: number;
}

export interface OpeningLayout {
  wall: string;
  kind: "window" | "door" | "opening";
  x: number;
  width: number;
  sill: number;
  height: number;
  hinge: "left" | "right";
}

export interface CabinetPlacement {
  cabinet: string;
  kind: "base" | "wall" | "tall";
  wall: string;
  /** Along the wall from its start. */
  x: number;
  /** Plan position of the cabinet's rear-left corner. */
  origin: Vec2;
  d: Vec2;
  n: Vec2;
  /** Height of the carcase underside above the floor. */
  baseY: number;
  W: number;
  H: number;
  /** Depth including fronts. */
  depth: number;
}

export interface RoomLayout {
  walls: WallLayout[];
  openings: OpeningLayout[];
  placements: CabinetPlacement[];
  /** Outline of the inner faces (closed when the walls close). */
  closed: boolean;
  diagnostics: Diagnostic[];
}

const evalIn = (v: string | number, values: ReadonlyMap<string, number>): number | undefined => {
  const r = evaluateGraph(new Map([["__v", v]]), values);
  return r.diagnostics.length ? undefined : r.values.get("__v");
};

export function layoutRoom(
  room: RoomInput,
  cabinets: readonly CabinetResult[],
  placements: ReadonlyMap<string, PlacementInput | undefined>,
  projectValues: ReadonlyMap<string, number>,
): RoomLayout {
  const diagnostics: Diagnostic[] = [];
  const num = (v: string | number, what: string): number => {
    const x = evalIn(v, projectValues);
    if (x === undefined) {
      diagnostics.push({ severity: "error", code: "room_value_invalid", params: { what, expr: String(v) } });
      return 0;
    }
    return x;
  };
  const roomH = projectValues.get("room_height") ?? 2500;

  // Walls.
  const walls: WallLayout[] = [];
  let p: Vec2 = [0, 0];
  let d: Vec2 = [1, 0];
  room.walls.forEach((w, i) => {
    const length = num(w.length, `wall ${w.id} length`);
    const n: Vec2 = [d[1] + 0, -d[0] + 0]; // right of the direction (+0 clears -0)
    const end: Vec2 = [roundMm(p[0] + d[0] * length), roundMm(p[1] + d[1] * length)];
    walls.push({
      id: w.id,
      index: i,
      start: p,
      end,
      d,
      n,
      length,
      height: w.height === undefined ? roomH : num(w.height, `wall ${w.id} height`),
      thickness: w.thickness,
    });
    p = end;
    d = w.turn === "right" ? [d[1] + 0, -d[0] + 0] : [-d[1] + 0, d[0] + 0];
  });
  const closed = walls.length >= 3 && Math.hypot(p[0], p[1]) < 1;
  const wallById = new Map(walls.map((w) => [w.id, w]));

  // Openings.
  const openings: OpeningLayout[] = room.openings.map((o) => {
    if (!wallById.has(o.wall)) diagnostics.push({ severity: "error", code: "room_unknown_wall", params: { wall: o.wall } });
    return {
      wall: o.wall,
      kind: o.kind,
      x: num(o.x, `opening x`),
      width: num(o.width, `opening width`),
      sill: num(o.sill, `opening sill`),
      height: num(o.height, `opening height`),
      hinge: o.hinge,
    };
  });

  // Cabinets: explicit positions, else next in the run of their wall and level.
  const runEnd = new Map<string, number>(); // `${wall}|floor` or `${wall}|wall`
  const out: CabinetPlacement[] = [];
  for (const c of cabinets) {
    const id = c.resolved.cabinet.id;
    const pl = placements.get(id) ?? { wall: walls[0]!.id };
    const wall = wallById.get(pl.wall);
    if (!wall) {
      diagnostics.push({ severity: "error", code: "room_unknown_wall", params: { wall: pl.wall }, cabinet: id });
      continue;
    }
    const v = (n: string): number => c.resolved.values.get(n) ?? 0;
    const kind = c.resolved.cabinet.kind;
    const level = kind === "wall" ? "wall" : "floor";
    const key = `${wall.id}|${level}`;
    const x = pl.x !== undefined ? num(pl.x, `${id} position`) : (runEnd.get(key) ?? 0);
    const W = v("W");
    runEnd.set(key, Math.max(runEnd.get(key) ?? 0, x + W));
    const front = c.parts.filter((q) => q.role === "door" || q.role === "drawer_front");
    const depth = Math.max(v("D"), ...front.map((q) => q.box.z + q.box.dz));
    out.push({
      cabinet: id,
      kind,
      wall: wall.id,
      x: roundMm(x),
      origin: [roundMm(wall.start[0] + wall.d[0] * x), roundMm(wall.start[1] + wall.d[1] * x)],
      d: wall.d,
      n: wall.n,
      baseY: kind === "wall" ? v("wall_bottom") : v("plinth_h"),
      W,
      H: v("H"),
      depth: roundMm(depth),
    });
    if (x < -1e-6 || x + W > wall.length + 1e-6) {
      diagnostics.push({ severity: "warning", code: "room_cabinet_outside_wall", params: { wall: wall.id, x: roundMm(x), length: roundMm(wall.length) }, cabinet: id });
    }
  }

  // Overlaps in plan (same level band) and in front of openings.
  const rect = (q: CabinetPlacement): [number, number, number, number] => {
    const pts: Vec2[] = [
      q.origin,
      [q.origin[0] + q.d[0] * q.W, q.origin[1] + q.d[1] * q.W],
      [q.origin[0] + q.n[0] * q.depth, q.origin[1] + q.n[1] * q.depth],
      [q.origin[0] + q.d[0] * q.W + q.n[0] * q.depth, q.origin[1] + q.d[1] * q.W + q.n[1] * q.depth],
    ];
    const xs = pts.map((v) => v[0]);
    const ys = pts.map((v) => v[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const vOverlap = (a: CabinetPlacement, b: CabinetPlacement): boolean => a.baseY < b.baseY + b.H - 1e-6 && b.baseY < a.baseY + a.H - 1e-6;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!;
      const b = out[j]!;
      if (!vOverlap(a, b)) continue;
      const [ax0, ay0, ax1, ay1] = rect(a);
      const [bx0, by0, bx1, by1] = rect(b);
      if (ax0 < bx1 - 0.5 && bx0 < ax1 - 0.5 && ay0 < by1 - 0.5 && by0 < ay1 - 0.5) {
        diagnostics.push({ severity: "error", code: "room_cabinets_overlap", params: { a: a.cabinet, b: b.cabinet }, cabinet: a.cabinet });
      }
    }
  }
  for (const q of out) {
    for (const o of openings.filter((x) => x.wall === q.wall)) {
      const alongOverlap = q.x < o.x + o.width - 1e-6 && o.x < q.x + q.W - 1e-6;
      const upOverlap = q.baseY < o.sill + o.height - 1e-6 && o.sill < q.baseY + q.H - 1e-6;
      if (alongOverlap && upOverlap) {
        diagnostics.push({ severity: "warning", code: "room_cabinet_in_opening", params: { kind: o.kind, wall: q.wall }, cabinet: q.cabinet });
      }
    }
  }

  return { walls, openings, placements: out, closed, diagnostics };
}

/** Cabinet coordinates → plan (x, y) and height, for a placed cabinet. */
export function toPlan(q: CabinetPlacement, pt: { x: number; y: number; z: number }): { x: number; y: number; h: number } {
  return {
    x: q.origin[0] + q.d[0] * pt.x + q.n[0] * pt.z,
    y: q.origin[1] + q.d[1] * pt.x + q.n[1] * pt.z,
    h: q.baseY + pt.y,
  };
}
