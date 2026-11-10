import type { Operation } from "./ops.ts";

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
  | "top_slope"
  | "rail_front"
  | "rail_rear"
  | "rail_bottom"
  | "back"
  | "shelf"
  | "partition"
  | "fixed_shelf"
  | "door"
  | "blind_panel"
  | "appliance_front"
  | "flap"
  | "ceiling_filler"
  | "worktop"
  | "plinth"
  | "drawer_front"
  | "drawer_side_left"
  | "drawer_side_right"
  | "drawer_inner"
  | "drawer_back"
  | "drawer_bottom";

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
  top_slope: "TS",
  rail_front: "RF",
  rail_rear: "RR",
  rail_bottom: "RB",
  back: "BK",
  shelf: "SH",
  partition: "MP",
  fixed_shelf: "FS",
  door: "DO",
  blind_panel: "BP",
  appliance_front: "AF",
  flap: "FL",
  ceiling_filler: "PB",
  worktop: "WT",
  plinth: "PL",
  drawer_front: "DF",
  drawer_side_left: "DL",
  drawer_side_right: "DR",
  drawer_inner: "DI",
  drawer_back: "DB",
  drawer_bottom: "DT",
};

/** Stable sort order of roles in lists. */
export const ROLE_ORDER: readonly PartRole[] = [
  "side_left",
  "side_right",
  "bottom",
  "top",
  "top_slope",
  "rail_front",
  "rail_rear",
  "rail_bottom",
  "back",
  "partition",
  "fixed_shelf",
  "shelf",
  "door",
  "blind_panel",
  "appliance_front",
  "flap",
  "ceiling_filler",
  "drawer_front",
  "drawer_side_left",
  "drawer_side_right",
  "drawer_inner",
  "drawer_back",
  "drawer_bottom",
  "worktop",
  "plinth",
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
  /** Machining in part-local coordinates (see ops.ts). */
  operations: Operation[];
  /**
   * Non-rectangular parts (D43): the contour in part-local (u, v), counter-
   * clockwise, inside 0…length × 0…width. Sizes and cut sizes stay the
   * bounding rectangle.
   */
  outline?: [number, number][];
  /**
   * Parts cut by a sloped top (D47): the cross-section in cabinet X/Y,
   * counter-clockwise, extruded along Z over the box's Z range. With
   * `rotated` the part lies at an angle: its box is the board laid flat in
   * the top plane, the frame for its operations, part sheet and DXF; only
   * the profile shows where it really is (3D view, assembly drawing).
   */
  profile?: { points: [number, number][]; rotated?: boolean };
  /** Bevel (mitre) cuts at the ends or edges, in degrees from square; the long point is on the outer face (D47). */
  bevels?: Partial<Record<"l1" | "l2" | "w1" | "w2", number>>;
  note?: string;
}

/** Rounds to 0.01 mm to remove floating-point noise from derived sizes. */
export const roundMm = (x: number): number => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
};

export const boxSize = (b: Box, axis: Axis): number => (axis === "x" ? b.dx : axis === "y" ? b.dy : b.dz);

export const thicknessAxis = (l: Axis, w: Axis): Axis => (["x", "y", "z"] as const).find((a) => a !== l && a !== w)!;
