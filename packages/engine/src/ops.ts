import type { Diagnostic } from "./diagnostics.ts";
import { roundMm, type Axis, type Part } from "./part.ts";

/**
 * Machining operations, stored in part-local coordinates (DECISIONS.md D13):
 *   u along the part length, v along the width, w along the thickness,
 *   origin at the part's minimum corner in cabinet coordinates.
 * Faces: t0 (w = 0), t1 (w = thickness), l1 (v = 0), l2 (v = width),
 *        w1 (u = 0), w2 (u = length).
 * Machine faces (A/B) and origins are mapped at export time, not here.
 */
export type Face = "t0" | "t1" | "l1" | "l2" | "w1" | "w2";

/** Why an operation exists; used for labels, BOM and collision messages. */
export interface OpSource {
  kind: "system" | "joint" | "hardware" | "back";
  /** e.g. "SL-BO" for a joint, a hardware item id, "rows" for system holes. */
  ref: string;
  /** Operations of one fitting that are meant to meet (cam housing and bolt hole). */
  group?: string;
}

export interface Bore {
  kind: "bore";
  face: Face;
  /** Entry point on the face. */
  u: number;
  v: number;
  w: number;
  d: number;
  depth: number;
  sources: OpSource[];
  /** Goes through the whole thickness, drilled from this face (D23). */
  through?: boolean;
  /** Half of a hole drilled from both faces; its partner sits on the opposite face. */
  split?: boolean;
}

/** Rectangular material removal open to a face: grooves, rebates, pockets. */
export interface Pocket {
  kind: "pocket";
  face: Face;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  w0: number;
  w1: number;
  /** Corner radius in the face plane (cutouts); square corners when absent. */
  r?: number;
  sources: OpSource[];
}

export type Operation = Bore | Pocket;

export type Direction = `${"+" | "-"}${Axis}`;
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

const EPS = 1e-6;

type LocalAxis = "u" | "v" | "w";

/** Which local axis a cabinet axis maps to for this part. */
function localAxis(part: Part, axis: Axis): LocalAxis {
  if (axis === part.lengthAxis) return "u";
  if (axis === part.widthAxis) return "v";
  return "w";
}

const minOf = (part: Part, axis: Axis): number => part.box[axis];
const sizeOf = (part: Part, a: LocalAxis): number =>
  a === "u" ? part.length : a === "v" ? part.width : part.thickness;

/** Cabinet point → part-local (u, v, w). */
export function toLocal(part: Part, p: Point3): { u: number; v: number; w: number } {
  const out = { u: 0, v: 0, w: 0 };
  for (const axis of ["x", "y", "z"] as const) {
    out[localAxis(part, axis)] = roundMm(p[axis] - minOf(part, axis));
  }
  return out;
}

/** Part-local (u, v, w) → cabinet point. */
export function toCabinet(part: Part, l: { u: number; v: number; w: number }): Point3 {
  const out = { x: 0, y: 0, z: 0 };
  for (const axis of ["x", "y", "z"] as const) out[axis] = l[localAxis(part, axis)] + minOf(part, axis);
  return out;
}

/** Face a bore enters through when drilling in direction `dir` (cabinet axes). */
export function entryFace(part: Part, dir: Direction): Face {
  const a = localAxis(part, dir[1] as Axis);
  const positive = dir[0] === "+";
  if (a === "w") return positive ? "t0" : "t1";
  if (a === "v") return positive ? "l1" : "l2";
  return positive ? "w1" : "w2";
}

/** Local axis normal to a face, and the axes spanning it. */
export function faceAxes(face: Face): { normal: LocalAxis; plane: [LocalAxis, LocalAxis] } {
  if (face === "t0" || face === "t1") return { normal: "w", plane: ["u", "v"] };
  if (face === "l1" || face === "l2") return { normal: "v", plane: ["u", "w"] };
  return { normal: "u", plane: ["v", "w"] };
}

const faceAtMax = (face: Face): boolean => face === "t1" || face === "l2" || face === "w2";

/**
 * Adds a bore given in cabinet coordinates. The entry point must lie on the
 * part surface; anything else is a bug in a rule, not user data, so it throws.
 */
export function addBore(
  part: Part,
  entry: Point3,
  dir: Direction,
  d: number,
  depth: number,
  source: OpSource,
): Bore {
  const face = entryFace(part, dir);
  const l = toLocal(part, entry);
  const { normal } = faceAxes(face);
  const expected = faceAtMax(face) ? sizeOf(part, normal) : 0;
  if (Math.abs(l[normal] - expected) > 1e-3) {
    throw new Error(`bore entry not on face ${face} of ${part.id}: ${JSON.stringify(l)}`);
  }
  const bore: Bore = { kind: "bore", face, ...l, d: roundMm(d), depth: roundMm(depth), sources: [source] };
  addOperation(part, bore);
  return bore;
}

/**
 * Adds a pocket for the intersection of a cabinet-space box with the part.
 * Returns undefined when they do not overlap. The face is the one the
 * pocket opens to (thickness faces preferred).
 */
export function addPocketFromBox(
  part: Part,
  box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number },
  source: OpSource,
): Pocket | undefined {
  const lo: Point3 = {
    x: Math.max(box.x0, part.box.x),
    y: Math.max(box.y0, part.box.y),
    z: Math.max(box.z0, part.box.z),
  };
  const hi: Point3 = {
    x: Math.min(box.x1, part.box.x + part.box.dx),
    y: Math.min(box.y1, part.box.y + part.box.dy),
    z: Math.min(box.z1, part.box.z + part.box.dz),
  };
  if (hi.x - lo.x <= EPS || hi.y - lo.y <= EPS || hi.z - lo.z <= EPS) return undefined;
  const a = toLocal(part, lo);
  const b = toLocal(part, hi);
  const r = { u0: a.u, u1: b.u, v0: a.v, v1: b.v, w0: a.w, w1: b.w };
  const touches: Face[] = [];
  if (r.w0 <= EPS) touches.push("t0");
  if (r.w1 >= part.thickness - EPS) touches.push("t1");
  if (r.v0 <= EPS) touches.push("l1");
  if (r.v1 >= part.width - EPS) touches.push("l2");
  if (r.u0 <= EPS) touches.push("w1");
  if (r.u1 >= part.length - EPS) touches.push("w2");
  // A pocket through the whole thickness would split the part; rules must not create one.
  if (touches.includes("t0") && touches.includes("t1")) {
    throw new Error(`pocket cuts through ${part.id}`);
  }
  const face = touches.find((f) => f === "t0" || f === "t1") ?? touches[0];
  if (!face) throw new Error(`closed pocket inside ${part.id}`);
  const pocket: Pocket = { kind: "pocket", face, ...r, sources: [source] };
  addOperation(part, pocket);
  return pocket;
}

/**
 * Adds an operation, merging concentric bores (same face and position) so a
 * hinge plate screw that lands in a system hole is one hole with two
 * sources. The larger diameter and the deeper depth win: drilling Ø10 over
 * a Ø5 system hole leaves a Ø10 hole.
 */
function addOperation(part: Part, op: Operation): void {
  if (op.kind === "bore") {
    const same = part.operations.find(
      (o): o is Bore =>
        o.kind === "bore" &&
        o.face === op.face &&
        Math.abs(o.u - op.u) < 1e-3 &&
        Math.abs(o.v - op.v) < 1e-3 &&
        Math.abs(o.w - op.w) < 1e-3,
    );
    if (same) {
      same.depth = Math.max(same.depth, op.depth);
      same.d = Math.max(same.d, op.d);
      for (const s of op.sources) {
        if (!same.sources.some((x) => x.kind === s.kind && x.ref === s.ref)) same.sources.push(s);
      }
      return;
    }
  }
  part.operations.push(op);
}

// ---------------------------------------------------------------------------
// Checks

interface Aabb {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  w0: number;
  w1: number;
}

/** Axis-aligned bounds of the material an operation removes. */
export function opBounds(part: Part, op: Operation): Aabb {
  if (op.kind === "pocket") return op;
  const { normal, plane } = faceAxes(op.face);
  const r = op.d / 2;
  const b: Aabb = { u0: op.u, u1: op.u, v0: op.v, v1: op.v, w0: op.w, w1: op.w };
  for (const a of plane) {
    b[`${a}0`] = op[a] - r;
    b[`${a}1`] = op[a] + r;
  }
  if (faceAtMax(op.face)) b[`${normal}0`] = op[normal] - op.depth;
  else b[`${normal}1`] = op[normal] + op.depth;
  return b;
}

const overlaps = (a: Aabb, b: Aabb): boolean =>
  a.u0 < b.u1 - EPS &&
  b.u0 < a.u1 - EPS &&
  a.v0 < b.v1 - EPS &&
  b.v0 < a.v1 - EPS &&
  a.w0 < b.w1 - EPS &&
  b.w0 < a.w1 - EPS;

/**
 * True when a bore drilled as described would come closer than `margin` to
 * any existing operation of the part. Rules use this to choose free
 * positions before committing a bore.
 */
export function boreWouldCollide(
  part: Part,
  entry: Point3,
  dir: Direction,
  d: number,
  depth: number,
  margin: number,
): boolean {
  const face = entryFace(part, dir);
  const l = toLocal(part, entry);
  const trial: Bore = { kind: "bore", face, ...l, d, depth, sources: [] };
  const b = opBounds(part, trial);
  const grown: Aabb = {
    u0: b.u0 - margin,
    u1: b.u1 + margin,
    v0: b.v0 - margin,
    v1: b.v1 + margin,
    w0: b.w0 - margin,
    w1: b.w1 + margin,
  };
  return part.operations.some((o) => overlaps(grown, opBounds(part, o)));
}

const isSplitPair = (a: Operation, b: Operation): boolean =>
  a.kind === "bore" &&
  b.kind === "bore" &&
  !!a.split &&
  !!b.split &&
  ((a.face === "t0" && b.face === "t1") || (a.face === "t1" && b.face === "t0")) &&
  Math.abs(a.u - b.u) < 1e-3 &&
  Math.abs(a.v - b.v) < 1e-3;

export type ThroughMode = "one_side" | "both_sides";

/**
 * A hole through the whole thickness. one_side: one bore from the entry
 * face. both_sides: two bores, one from each face, meeting in the middle
 * with `overlap` mm in total, so both faces come out clean.
 */
export function addThroughBore(
  part: Part,
  entry: Point3,
  dir: Direction,
  d: number,
  mode: ThroughMode,
  overlap: number,
  source: OpSource,
): void {
  const face = entryFace(part, dir);
  if (face !== "t0" && face !== "t1") throw new Error(`through bore must enter a thickness face of ${part.id}`);
  const t = part.thickness;
  if (mode === "one_side") {
    const b = addBore(part, entry, dir, d, t, source);
    b.through = true;
    return;
  }
  const half = roundMm(t / 2 + overlap / 2);
  const a = addBore(part, entry, dir, d, half, source);
  a.split = true;
  const axis = dir[1] as Axis;
  const sign = dir[0] === "+" ? 1 : -1;
  const far = { ...entry, [axis]: entry[axis] + sign * t } as Point3;
  const b = addBore(part, far, `${sign > 0 ? "-" : "+"}${axis}` as Direction, d, half, source);
  b.split = true;
}

export type OpposingMode = "both_sides" | "through" | "error";

/**
 * Coaxial bores from opposite faces that together leave less than
 * `minWall` between them (e.g. shelf-pin rows on both faces of a middle
 * panel) become one hole: drilled from both sides meeting in the middle,
 * or one through hole from the face of the first bore. "error" leaves them,
 * so the check reports the collision.
 */
export function resolveOpposing(part: Part, mode: OpposingMode, overlap: number, minWall: number): number {
  if (mode === "error") return 0;
  const bores = part.operations.filter((o): o is Bore => o.kind === "bore" && (o.face === "t0" || o.face === "t1"));
  const remove = new Set<Bore>();
  let n = 0;
  for (const a of bores) {
    if (remove.has(a) || a.face !== "t0" || a.through || a.split) continue;
    const b = bores.find(
      (o) =>
        !remove.has(o) &&
        o.face === "t1" &&
        !o.through &&
        !o.split &&
        Math.abs(o.u - a.u) < 1e-3 &&
        Math.abs(o.v - a.v) < 1e-3 &&
        Math.abs(o.d - a.d) < 1e-3,
    );
    if (!b || a.depth + b.depth <= part.thickness - minWall + 1e-9) continue;
    n++;
    if (mode === "both_sides") {
      const half = roundMm(part.thickness / 2 + overlap / 2);
      a.depth = half;
      b.depth = half;
      a.split = true;
      b.split = true;
    } else {
      // Keep the bore that was added first, drill it through.
      const keep = part.operations.indexOf(a) < part.operations.indexOf(b) ? a : b;
      const drop = keep === a ? b : a;
      keep.depth = part.thickness;
      keep.through = true;
      for (const s of drop.sources) if (!keep.sources.some((x) => x.kind === s.kind && x.ref === s.ref)) keep.sources.push(s);
      remove.add(drop);
    }
  }
  if (remove.size) part.operations = part.operations.filter((o) => !remove.has(o as Bore));
  return n;
}

const describe = (op: Operation): string => op.sources.map((s) => `${s.kind}:${s.ref}`).join("+");

/**
 * Checks every operation of a part:
 * - a bore keeps at least `minWall` mm of material to every part surface
 *   it does not enter through (no breakout, no drilling through);
 * - no two operations remove overlapping material, except identical bores
 *   (already merged) and bores of the same source group.
 */
const sameGroup = (a: Operation, b: Operation): boolean =>
  a.sources.some((s) => s.group !== undefined && b.sources.some((t) => t.group === s.group));

export function checkOperations(part: Part, minWall: number): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const at = { cabinet: part.cabinet, part: part.id };
  const sizes = { u: part.length, v: part.width, w: part.thickness };

  for (const op of part.operations) {
    if (op.kind !== "bore") continue;
    const b = opBounds(part, op);
    const { normal } = faceAxes(op.face);
    for (const a of ["u", "v", "w"] as const) {
      const lo = b[`${a}0`];
      const hi = b[`${a}1`];
      // The entry face side is open by definition; a through hole is open at both ends.
      const openLo = a === normal && (op.through || !faceAtMax(op.face));
      const openHi = a === normal && (op.through || faceAtMax(op.face));
      const wallLo = openLo ? Infinity : lo;
      const wallHi = openHi ? Infinity : sizes[a] - hi;
      const wall = Math.min(wallLo, wallHi);
      if (wall < -EPS) {
        diags.push({
          severity: "error",
          code: "bore_outside_part",
          params: { part: part.id, op: describe(op), d: op.d },
          ...at,
        });
        break;
      }
      if (wall < minWall - EPS) {
        diags.push({
          severity: "error",
          code: a === normal ? "bore_too_deep" : "bore_too_close_to_edge",
          params: { part: part.id, op: describe(op), d: op.d, wall: roundMm(wall), min: minWall },
          ...at,
        });
        break;
      }
    }
  }

  const ops = part.operations;
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i]!;
      const b = ops[j]!;
      if (a.kind === "pocket" && b.kind === "pocket") continue; // pockets may join (e.g. groove corners)
      if (isSplitPair(a, b)) continue; // the two halves of one hole drilled from both faces
      if (sameGroup(a, b)) continue; // parts of one fitting that join by design
      if (overlaps(opBounds(part, a), opBounds(part, b))) {
        diags.push({
          severity: "error",
          code: "ops_collide",
          params: { part: part.id, a: describe(a), b: describe(b) },
          ...at,
        });
      }
    }
  }
  return diags;
}
