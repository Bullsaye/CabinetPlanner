import { toCabinet, type Face, type Point3 } from "../ops.ts";
import { thicknessAxis, type Axis, type Part } from "../part.ts";

/**
 * Part semantics and view orientation for drawings (DECISIONS.md D19).
 *
 * Every part edge and face is named by the cabinet direction it faces
 * (front, rear, left, right, top, bottom), so a drawing can say "front edge
 * at the reference" without knowing the part's role.
 */
export type Dir = "left" | "right" | "bottom" | "top" | "rear" | "front";
export type Side = "bottom" | "top" | "left" | "right";
export type Vec = readonly [number, number, number];

export const DIR_VEC: Readonly<Record<Dir, Vec>> = {
  left: [-1, 0, 0],
  right: [1, 0, 0],
  bottom: [0, -1, 0],
  top: [0, 1, 0],
  rear: [0, 0, -1],
  front: [0, 0, 1],
};

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const neg = (a: Vec): Vec => [-a[0], -a[1], -a[2]];

export function dirOf(v: Vec): Dir | undefined {
  for (const [d, w] of Object.entries(DIR_VEC) as [Dir, Vec][]) {
    if (Math.abs(w[0] - v[0]) < 1e-9 && Math.abs(w[1] - v[1]) < 1e-9 && Math.abs(w[2] - v[2]) < 1e-9) return d;
  }
  return undefined;
}

const axisVec = (a: Axis, sign: 1 | -1): Vec => {
  const v: [number, number, number] = [0, 0, 0];
  v[AXIS_INDEX[a]] = sign;
  return v;
};

/** Outward normal of a part face (thickness faces and edges) in cabinet axes. */
export function faceNormal(part: Part, face: Face): Vec {
  const axis =
    face === "t0" || face === "t1"
      ? thicknessAxis(part.lengthAxis, part.widthAxis)
      : face === "l1" || face === "l2"
        ? part.widthAxis
        : part.lengthAxis;
  const max = face === "t1" || face === "l2" || face === "w2";
  return axisVec(axis, max ? 1 : -1);
}

/** The cabinet direction a face or edge faces. */
export const faceDir = (part: Part, face: Face): Dir => dirOf(faceNormal(part, face))!;

/**
 * The thickness face that looks into the cabinet: the face on the side of
 * the cabinet centre. For parts centred in the cabinet (shelves), the face
 * with more machining, else t1.
 */
export function innerFace(part: Part, cabinet: { W: number; H: number; D: number }): "t0" | "t1" {
  const a = thicknessAxis(part.lengthAxis, part.widthAxis);
  const size = a === "x" ? cabinet.W : a === "y" ? cabinet.H : cabinet.D;
  const lo = part.box[a];
  const hi = lo + (a === "x" ? part.box.dx : a === "y" ? part.box.dy : part.box.dz);
  const centre = size / 2;
  const free = part.role === "shelf"; // shelves sit anywhere; use their machined face
  if (!free && hi <= centre + 1e-6) return "t1";
  if (!free && lo >= centre - 1e-6) return "t0";
  const n0 = part.operations.filter((o) => o.face === "t0").length;
  const n1 = part.operations.filter((o) => o.face === "t1").length;
  return n0 > n1 ? "t0" : "t1";
}

/**
 * How to lay a part out on paper: which face looks at the viewer, and which
 * edge goes to which side of the drawing. Anchors are tried in order; the
 * first edge the part actually has (perpendicular to the viewed face) wins.
 * Views are never mirrored: what you see is the real face.
 */
export interface ViewSpec {
  /** machined: the inner face, unless only the outer face has machining. */
  face: "machined" | "inner" | "outer" | "t0" | "t1";
  anchors: { edge: Dir; side: Side }[];
}

export interface PartView {
  part: Part;
  /** Face towards the viewer. */
  face: "t0" | "t1";
  /** Drawing axes in cabinet coordinates: right, up, towards the viewer. */
  r: Vec;
  p: Vec;
  n: Vec;
  width: number;
  height: number;
  /** Cabinet direction of each drawing side, e.g. bottom → "front". */
  sides: Record<Side, Dir>;
  /** Projects a cabinet point to drawing mm (origin bottom-left, Y up). */
  project(pt: Point3): { X: number; Y: number };
  /** Projects a part-local point. */
  projectLocal(l: { u: number; v: number; w: number }): { X: number; Y: number };
}

/** A pocket through the whole thickness (notch, cutout): it can be cut from either face. */
export const isThroughPocket = (part: Part, o: Part["operations"][number]): boolean =>
  o.kind === "pocket" && (o.face === "t0" || o.face === "t1") && o.w0 <= 1e-6 && o.w1 >= part.thickness - 1e-6;

/**
 * Thickness faces that have machining entering through them. Through
 * pockets do not count: they are cut from whichever face is up (D45).
 */
export function machinedFaces(part: Part): Set<"t0" | "t1"> {
  const out = new Set<"t0" | "t1">();
  for (const o of part.operations) if ((o.face === "t0" || o.face === "t1") && !isThroughPocket(part, o)) out.add(o.face);
  return out;
}

export const otherFace = (f: "t0" | "t1"): "t0" | "t1" => (f === "t0" ? "t1" : "t0");

export function partView(
  part: Part,
  spec: ViewSpec,
  cabinet: { W: number; H: number; D: number },
  /** Force the viewed face (second side of a two-sided part). */
  forceFace?: "t0" | "t1",
): PartView {
  const inner = innerFace(part, cabinet);
  const machined = machinedFaces(part);
  const face: "t0" | "t1" =
    forceFace ??
    (spec.face === "inner"
      ? inner
      : spec.face === "outer"
        ? otherFace(inner)
        : spec.face === "machined"
          ? machined.has(inner) || !machined.has(otherFace(inner))
            ? inner
            : otherFace(inner)
          : spec.face);
  const n = faceNormal(part, face);

  let r: Vec | undefined;
  let p: Vec | undefined;
  for (const a of spec.anchors) {
    const e = DIR_VEC[a.edge];
    if (Math.abs(dot(e, n)) > 1e-9) continue; // edge must lie in the viewed face
    if (a.side === "bottom" || a.side === "top") {
      p = a.side === "bottom" ? neg(e) : e;
      r = cross(p, n);
    } else {
      r = a.side === "left" ? neg(e) : e;
      p = cross(n, r);
    }
    break;
  }
  if (!r || !p) {
    // Fallback: part length to the right.
    r = axisVec(part.lengthAxis, 1);
    if (Math.abs(dot(r, n)) > 1e-9) r = axisVec(part.widthAxis, 1);
    p = cross(n, r);
  }

  const b = part.box;
  const corners: Vec[] = [];
  for (const x of [b.x, b.x + b.dx]) for (const y of [b.y, b.y + b.dy]) for (const z of [b.z, b.z + b.dz]) corners.push([x, y, z]);
  const xs = corners.map((c) => dot(c, r!));
  const ys = corners.map((c) => dot(c, p!));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const round = (v: number): number => {
    const x = Math.round(v * 100) / 100;
    return x === 0 ? 0 : x;
  };
  const project = (pt: Point3) => ({
    X: round(dot([pt.x, pt.y, pt.z], r!) - minX),
    Y: round(dot([pt.x, pt.y, pt.z], p!) - minY),
  });
  return {
    part,
    face,
    r,
    p,
    n,
    width: round(Math.max(...xs) - minX),
    height: round(Math.max(...ys) - minY),
    sides: { bottom: dirOf(neg(p))!, top: dirOf(p)!, left: dirOf(neg(r))!, right: dirOf(r)! },
    project,
    projectLocal: (l) => project(toCabinet(part, l)),
  };
}

/** Factory view specs. */
export const MACHINE_VIEW: ViewSpec = {
  // Inner face up (or the machined face if only that one has work), front
  // edge on the reference (drawing bottom = machine Y 0).
  face: "machined",
  anchors: [
    { edge: "front", side: "bottom" },
    { edge: "bottom", side: "bottom" },
    { edge: "left", side: "left" },
  ],
};

export const ASSEMBLY_VIEW_UPRIGHT: ViewSpec = {
  // Upright parts seen from inside the cabinet, as if folded outwards.
  face: "machined",
  anchors: [
    { edge: "bottom", side: "bottom" },
    { edge: "left", side: "left" },
  ],
};

export const ASSEMBLY_VIEW_FLAT: ViewSpec = {
  // Horizontal parts flipped down (bottom, seen from above) or up (top, seen
  // from below); left stays left as in the front view.
  face: "inner",
  anchors: [{ edge: "left", side: "left" }],
};
