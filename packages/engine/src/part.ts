/**
 * A finished part. Geometry is an axis-aligned box in cabinet coordinates
 * (see DECISIONS.md: origin rear-left-bottom of the carcase, X right, Y up,
 * Z towards the front, mm).
 */

export type PartRole =
  | "side_left"
  | "side_right"
  | "bottom"
  | "top"
  | "rail_front"
  | "rail_rear"
  | "back"
  | "shelf"
  | "door";

/**
 * Part codes are fixed per role (plus a 1-based index for repeated roles),
 * so a part keeps its number when other parts are added or removed.
 * Part id = `<cabinet id>-<code>`, e.g. `B01-SL`, `B01-SH2`.
 */
export const ROLE_CODES: Readonly<Record<PartRole, string>> = {
  side_left: "SL",
  side_right: "SR",
  bottom: "BO",
  top: "TO",
  rail_front: "RF",
  rail_rear: "RR",
  back: "BK",
  shelf: "SH",
  door: "DO",
};

/** Stable sort order of roles in lists. */
export const ROLE_ORDER: readonly PartRole[] = [
  "side_left",
  "side_right",
  "bottom",
  "top",
  "rail_front",
  "rail_rear",
  "back",
  "shelf",
  "door",
];

export type Axis = "x" | "y" | "z";

export interface Box {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
}

/**
 * Edge names of a part, independent of where it sits in the cabinet:
 * - `l1`, `l2`: the two long edges (parallel to the length), at width 0 and width max.
 * - `w1`, `w2`: the two short edges (parallel to the width), at length 0 and length max.
 * Each holds an edgeband id or null.
 */
export interface PartEdges {
  l1: string | null;
  l2: string | null;
  w1: string | null;
  w2: string | null;
}

export interface Part {
  id: string;
  code: string;
  cabinet: string;
  role: PartRole;
  /** 1-based index for repeated roles (shelves, doors). */
  index?: number;
  material: string;
  /** Finished sizes in mm. Length runs along the grain when the material has one. */
  length: number;
  width: number;
  thickness: number;
  /** Cut sizes: finished size minus edgeband thickness when deduction is on. */
  cutLength: number;
  cutWidth: number;
  lengthAxis: Axis;
  widthAxis: Axis;
  /** True when the material has grain; it then runs along the length. */
  grain: boolean;
  edges: PartEdges;
  box: Box;
  note?: string;
}

/** Rounds to 0.01 mm to remove floating-point noise from derived sizes. */
export const roundMm = (x: number): number => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
};

export const boxSize = (b: Box, axis: Axis): number => (axis === "x" ? b.dx : axis === "y" ? b.dy : b.dz);

export const thicknessAxis = (l: Axis, w: Axis): Axis => (["x", "y", "z"] as const).find((a) => a !== l && a !== w)!;
