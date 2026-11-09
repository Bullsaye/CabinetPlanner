import { z } from "zod";
import type { Diagnostic } from "../diagnostics.ts";
import { evaluateGraph } from "../graph.ts";
import type { CabinetResult } from "../project.ts";
import type { Operation } from "../ops.ts";
import { roundMm, type Part } from "../part.ts";

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
  turn: "right" | "left";
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
  /** Carcase depth without fronts. */
  carcaseD: number;
  /** Sink or hob cutout in the worktop above (D31). */
  cutout?: { kind: "sink" | "hob"; w: number; d: number; front: number; offset: number; r: number };
}

/** Plinth panel along a run of floor units (D31). */
export interface PlinthLayout {
  id: string;
  wall: string;
  x0: number;
  x1: number;
  /** Distance of the panel's front face from the wall. */
  front: number;
  /** Bottom edge above the floor. */
  y: number;
  h: number;
  t: number;
}

/** A worktop over a run of base units on one wall (D29). */
export interface WorktopLayout {
  id: string;
  wall: string;
  /** Along the wall from its start. */
  x0: number;
  x1: number;
  depth: number;
  /** Underside above the floor. */
  y: number;
  t: number;
  /** Plan outline: rear-left, rear-right, front-right, front-left. */
  outline: Vec2[];
  /** Sink/hob cutouts: u along the wall from x0, v from the wall. */
  cutouts: { kind: string; u0: number; u1: number; v0: number; v1: number; r: number }[];
}

/** Worktop and plinth settings, resolved from the project/shop layers. */
export interface WorktopSettings {
  material: string;
  depth: number;
  thickness: number;
  /** Overhang past the last unit at open ends. */
  overhangEnd: number;
  plinth?: { material: string; thickness: number; setback: number; floorGap: number };
}

export interface RoomLayout {
  walls: WallLayout[];
  openings: OpeningLayout[];
  placements: CabinetPlacement[];
  worktops: WorktopLayout[];
  plinths: PlinthLayout[];
  /** Worktops and plinth panels as parts (cabinet "ROOM") for cutlists and CNC files. */
  parts: Part[];
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
  worktop?: WorktopSettings,
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
      turn: w.turn,
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
  // Walls are filled in order so a run can start behind the units of the
  // previous wall in an inside corner (D29); cabinets keep project order per wall.
  const runEnd = new Map<string, number>(); // `${wall}|floor` or `${wall}|wall`
  const out: CabinetPlacement[] = [];
  const wallOf = (c: CabinetResult): string => (placements.get(c.resolved.cabinet.id) ?? { wall: walls[0]!.id }).wall;
  const order = cabinets
    .map((c, i) => ({ c, i, w: wallById.get(wallOf(c))?.index ?? -1 }))
    .sort((a, b) => a.w - b.w || a.i - b.i)
    .map((e) => e.c);
  const cornerStart = (wall: WallLayout, level: string): number => {
    const prev = walls[wall.index - 1];
    if (!prev || prev.turn !== "right") return 0;
    let start = 0;
    for (const q of out) {
      if (q.wall !== prev.id || (q.kind === "wall" ? "wall" : "floor") !== level) continue;
      if (q.x + q.W >= prev.length - 1) start = Math.max(start, q.depth);
    }
    return start;
  };
  for (const c of order) {
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
    if (!runEnd.has(key)) runEnd.set(key, cornerStart(wall, level));
    const x = pl.x !== undefined ? num(pl.x, `${id} position`) : runEnd.get(key)!;
    const W = v("W");
    runEnd.set(key, Math.max(runEnd.get(key) ?? 0, x + W));
    const front = c.parts.filter((q) => q.role === "door" || q.role === "drawer_front" || q.role === "blind_panel");
    const depth = Math.max(v("D"), ...front.map((q) => q.box.z + q.box.dz));
    const cut = c.resolved.options.get("worktop_cutout")?.value;
    out.push({
      cabinet: id,
      kind,
      wall: wall.id,
      carcaseD: v("D"),
      ...(kind === "base" && (cut === "sink" || cut === "hob")
        ? { cutout: { kind: cut, w: v("cutout_w"), d: v("cutout_d"), front: v("cutout_front"), offset: v("cutout_offset"), r: v("cutout_r") } }
        : {}),
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

  const { worktops, plinths, parts } = worktop ? layoutWorktops(walls, out, worktop, diagnostics) : { worktops: [], plinths: [], parts: [] };
  return { walls, openings, placements: out, worktops, plinths, parts, closed, diagnostics };
}

/**
 * Worktops (D29, D31): one per contiguous run of base units on a wall with
 * the same top height. In an inside corner the earlier wall's worktop runs
 * through to the wall; the next one butts against its front edge. Open ends
 * (no wall, no neighbouring floor unit) overhang by `overhangEnd`. Sink and
 * hob cutouts of the units below become through pockets.
 * Plinth panels: one per run of floor units on the same plinth height, set
 * back from the carcase front; in an inside corner the earlier panel runs
 * to the next panel's front face.
 */
function layoutWorktops(
  walls: readonly WallLayout[],
  placements: readonly CabinetPlacement[],
  s: WorktopSettings,
  diagnostics: Diagnostic[],
): { worktops: WorktopLayout[]; plinths: PlinthLayout[]; parts: Part[] } {
  const floorOf = (w: WallLayout | undefined) => (w ? placements.filter((q) => q.wall === w.id && q.kind !== "wall") : []);
  /** Something stands at this end of a run: a floor unit beside it or a unit of the adjoining wall in the corner. */
  const blockedStart = (wall: WallLayout, x0: number): boolean => {
    if (x0 <= 1) return true;
    if (floorOf(wall).some((q) => Math.abs(q.x + q.W - x0) < 1)) return true;
    const prev = walls[wall.index - 1];
    return !!prev && prev.turn === "right" && floorOf(prev).some((q) => q.x + q.W >= prev.length - 1 && q.depth >= x0 - 1);
  };
  const blockedEnd = (wall: WallLayout, x1: number): boolean => {
    if (x1 >= wall.length - 1) return true;
    if (floorOf(wall).some((q) => Math.abs(q.x - x1) < 1)) return true;
    const next = walls[wall.index + 1];
    return wall.turn === "right" && !!next && floorOf(next).some((q) => q.x <= s.depth + 1 && q.depth >= wall.length - x1 - 1);
  };
  const runsOf = (list: CabinetPlacement[], key: (q: CabinetPlacement) => number) => {
    const runs: { x0: number; x1: number; key: number; units: CabinetPlacement[] }[] = [];
    for (const q of [...list].sort((a, b) => a.x - b.x)) {
      const last = runs[runs.length - 1];
      if (last && q.x <= last.x1 + 1 && Math.abs(last.key - key(q)) < 1) {
        last.x1 = Math.max(last.x1, q.x + q.W);
        last.units.push(q);
      } else runs.push({ x0: q.x, x1: q.x + q.W, key: key(q), units: [q] });
    }
    return runs;
  };

  const worktops: WorktopLayout[] = [];
  const cutouts = new Map<string, Operation[]>();
  for (const wall of walls) {
    const runs = runsOf(placements.filter((q) => q.wall === wall.id && q.kind === "base"), (q) => q.baseY + q.H);
    const prev = walls[wall.index - 1];
    const prevTop = prev && prev.turn === "right" ? worktops.find((w) => w.wall === prev.id && w.x1 >= prev.length - 1) : undefined;
    for (const r of runs) {
      let x0 = r.x0;
      let x1 = r.x1;
      if (prevTop && x0 < prevTop.depth) x0 = prevTop.depth;
      else if (x0 <= 1) x0 = 0;
      else if (!blockedStart(wall, x0)) x0 = Math.max(0, x0 - s.overhangEnd);
      if (x1 >= wall.length - 1) x1 = wall.length;
      else if (!blockedEnd(wall, x1)) x1 = Math.min(wall.length, x1 + s.overhangEnd);
      if (x1 - x0 < 1) continue;
      const at = (x: number, z: number): Vec2 => [
        roundMm(wall.start[0] + wall.d[0] * x + wall.n[0] * z),
        roundMm(wall.start[1] + wall.d[1] * x + wall.n[1] * z),
      ];
      const id = `WT${worktops.length + 1}`;
      worktops.push({
        id,
        wall: wall.id,
        x0: roundMm(x0),
        x1: roundMm(x1),
        depth: s.depth,
        y: roundMm(r.key),
        t: s.thickness,
        outline: [at(x0, 0), at(x1, 0), at(x1, s.depth), at(x0, s.depth)],
        cutouts: [],
      });
      // Cutouts in part-local coordinates: u along the wall from x0, v from the wall.
      const ops: Operation[] = [];
      for (const q of r.units) {
        if (!q.cutout) continue;
        const c = q.cutout;
        const u0 = q.x + q.W / 2 + c.offset - c.w / 2 - x0;
        const v1 = s.depth - c.front;
        const v0 = v1 - c.d;
        if (c.r > Math.min(c.w, c.d) / 2) {
          diagnostics.push({ severity: "error", code: "worktop_cutout_radius", params: { r: c.r, max: Math.min(c.w, c.d) / 2 }, cabinet: q.cabinet });
          continue;
        }
        if (u0 < 0 || u0 + c.w > x1 - x0 || v0 < 0) {
          diagnostics.push({ severity: "warning", code: "worktop_cutout_outside", params: { kind: c.kind, worktop: id }, cabinet: q.cabinet });
          continue;
        }
        ops.push({
          kind: "pocket",
          face: "t1",
          u0: roundMm(u0),
          u1: roundMm(u0 + c.w),
          v0: roundMm(v0),
          v1: roundMm(v1),
          w0: 0,
          w1: s.thickness,
          ...(c.r > 0 ? { r: c.r } : {}),
          sources: [{ kind: "hardware", ref: `cutout:${c.kind}:${q.cabinet}` }],
        });
      }
      cutouts.set(id, ops);
      worktops[worktops.length - 1]!.cutouts = ops.map((o) => {
        const q = o as Extract<Operation, { kind: "pocket" }>;
        return { kind: q.sources[0]!.ref.split(":")[1]!, u0: q.u0, u1: q.u1, v0: q.v0, v1: q.v1, r: q.r ?? 0 };
      });
    }
  }

  // Plinth panels.
  const plinths: PlinthLayout[] = [];
  const pl = s.plinth;
  if (pl) {
    const last = new Map<string, PlinthLayout>(); // wall → panel reaching its end
    for (const wall of walls) {
      const runs = runsOf(placements.filter((q) => q.wall === wall.id && q.kind !== "wall" && q.baseY > 0), (q) => q.baseY);
      const prev = walls[wall.index - 1];
      const prevPanel = prev && prev.turn === "right" ? last.get(prev.id) : undefined;
      for (const r of runs) {
        const front = Math.min(...r.units.map((q) => q.carcaseD)) - pl.setback;
        let x0 = r.x0 <= 1 ? 0 : r.x0;
        if (prevPanel && r.x0 <= s.depth + 1) {
          // Corner: this panel starts at the earlier panel's front face, the
          // earlier panel ends in this panel's front plane.
          x0 = prevPanel.front;
          prevPanel.x1 = roundMm(prev!.length - front);
        }
        const x1 = r.x1 >= wall.length - 1 ? wall.length : r.x1;
        const panel: PlinthLayout = { id: "", wall: wall.id, x0: roundMm(x0), x1: roundMm(x1), front: roundMm(front), y: pl.floorGap, h: roundMm(r.key - pl.floorGap), t: pl.thickness };
        plinths.push(panel);
        if (x1 >= wall.length - 1) last.set(wall.id, panel);
      }
    }
    plinths.forEach((p, i) => (p.id = `PL${i + 1}`));
  }

  const part = (id: string, role: "worktop" | "plinth", index: number, material: string, length: number, width: number, t: number, ops: Operation[]): Part => {
    const l = roundMm(length);
    return {
      id: `ROOM-${id}`,
      code: id,
      cabinet: "ROOM",
      role,
      index,
      material,
      length: l,
      width,
      thickness: t,
      cutLength: l,
      cutWidth: width,
      lengthAxis: "x",
      widthAxis: role === "worktop" ? "z" : "y",
      grain: false,
      edges: { l1: null, l2: null, w1: null, w2: null },
      box: role === "worktop" ? { x: 0, y: 0, z: 0, dx: l, dy: t, dz: width } : { x: 0, y: 0, z: 0, dx: l, dy: width, dz: t },
      operations: ops,
    };
  };
  const parts: Part[] = [
    ...worktops.map((w, i) => part(w.id, "worktop", i + 1, s.material, w.x1 - w.x0, w.depth, w.t, cutouts.get(w.id) ?? [])),
    ...(pl ? plinths.map((p, i) => part(p.id, "plinth", i + 1, pl.material, p.x1 - p.x0, p.h, p.t, [])) : []),
  ];
  return { worktops, plinths, parts };
}

/** Cabinet coordinates → plan (x, y) and height, for a placed cabinet. */
export function toPlan(q: CabinetPlacement, pt: { x: number; y: number; z: number }): { x: number; y: number; h: number } {
  return {
    x: q.origin[0] + q.d[0] * pt.x + q.n[0] * pt.z,
    y: q.origin[1] + q.d[1] * pt.x + q.n[1] * pt.z,
    h: q.baseY + pt.y,
  };
}
