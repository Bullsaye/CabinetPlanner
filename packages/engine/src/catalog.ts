import type { VarInput } from "./graph.ts";

/**
 * Catalogue of the variables and options the engine understands. Factory
 * defaults live here; every other layer (shop, project, cabinet) only
 * overrides. Labels are not stored here: the UI looks them up via i18n as
 * `var.<name>`, `var.<name>.hint`, `option.<key>` and `option.<key>.<value>`.
 */

export type VarGroup =
  | "dimensions"
  | "room"
  | "board"
  | "construction"
  | "system"
  | "back"
  | "shelves"
  | "fronts"
  | "hardware"
  | "drawers"
  | "machining";
export type VarUnit = "mm" | "count";

export interface VarDef {
  name: string;
  group: VarGroup;
  unit: VarUnit;
  /** Factory value or expression. */
  factory: VarInput;
  min?: number;
  max?: number;
  /** Suggested increment for steppers in the UI. */
  step?: number;
  integer?: boolean;
  /** Shown in the quick panel / tablet steppers. */
  quick?: boolean;
}

const v = (d: VarDef): VarDef => d;

/** In UI order. */
export const VARIABLES: readonly VarDef[] = [
  // Dimensions. H is the carcase height without plinth; D is the carcase depth without fronts.
  v({ name: "W", group: "dimensions", unit: "mm", factory: 600, min: 100, max: 2800, step: 50, quick: true }),
  v({ name: "H", group: "dimensions", unit: "mm", factory: "base_h", min: 100, max: 2800, step: 10, quick: true }),
  v({ name: "D", group: "dimensions", unit: "mm", factory: "worktop_d - 40", min: 100, max: 1200, step: 10, quick: true }),
  v({ name: "base_h", group: "dimensions", unit: "mm", factory: 720, min: 100, max: 2800, step: 10 }),
  v({ name: "worktop_d", group: "dimensions", unit: "mm", factory: 600, min: 100, max: 1200, step: 10 }),
  v({ name: "plinth_h", group: "dimensions", unit: "mm", factory: 100, min: 0, max: 300, step: 10, quick: true }),
  v({ name: "wall_h", group: "dimensions", unit: "mm", factory: 720, min: 100, max: 1500, step: 10 }),
  v({ name: "wall_d", group: "dimensions", unit: "mm", factory: 320, min: 100, max: 800, step: 10 }),
  v({ name: "wall_bottom", group: "dimensions", unit: "mm", factory: 1450, min: 0, max: 2500, step: 10 }),
  v({ name: "tall_h", group: "dimensions", unit: "mm", factory: 2100, min: 300, max: 2800, step: 10 }),
  v({ name: "room_height", group: "room", unit: "mm", factory: 2500, min: 1800, max: 6000, step: 10 }),
  v({ name: "worktop_t", group: "room", unit: "mm", factory: "mat_worktop_t", min: 10, max: 100 }),
  v({ name: "worktop_overhang_end", group: "room", unit: "mm", factory: 20, min: 0, max: 600, step: 5 }),
  v({ name: "plinth_setback", group: "room", unit: "mm", factory: 50, min: 0, max: 300, step: 5 }),
  v({ name: "plinth_floor_gap", group: "room", unit: "mm", factory: 3, min: 0, max: 30, step: 0.5 }),
  v({ name: "cutout_w", group: "room", unit: "mm", factory: 560, min: 50, max: 2000, step: 10 }),
  v({ name: "cutout_d", group: "room", unit: "mm", factory: 490, min: 50, max: 1000, step: 10 }),
  v({ name: "cutout_front", group: "room", unit: "mm", factory: 50, min: 0, max: 500, step: 5 }),
  v({ name: "cutout_offset", group: "room", unit: "mm", factory: 0, min: -1000, max: 1000, step: 5 }),
  v({ name: "oven_h", group: "room", unit: "mm", factory: 600, min: 300, max: 1200, step: 1 }),
  v({ name: "fridge_h", group: "room", unit: "mm", factory: 1772, min: 500, max: 2200, step: 1 }),
  v({ name: "wardrobe_h", group: "room", unit: "mm", factory: "tall_h", min: 500, max: 2800, step: 10 }),
  v({ name: "wardrobe_d", group: "room", unit: "mm", factory: 580, min: 300, max: 900, step: 10 }),

  // Board thicknesses follow the chosen materials unless overridden.
  v({ name: "t_carcase", group: "board", unit: "mm", factory: "mat_carcase_t", min: 3, max: 60 }),
  v({ name: "t_back", group: "board", unit: "mm", factory: "mat_back_t", min: 2, max: 40 }),
  v({ name: "t_shelf", group: "board", unit: "mm", factory: "mat_shelf_t", min: 3, max: 60 }),
  v({ name: "t_front", group: "board", unit: "mm", factory: "mat_front_t", min: 3, max: 60 }),

  // Construction.
  v({ name: "rail_w", group: "construction", unit: "mm", factory: 100, min: 30, max: 300, step: 10 }),
  v({ name: "partition_count", group: "construction", unit: "count", factory: 0, min: 0, max: 5, integer: true, step: 1, quick: true }),
  v({ name: "partition_setback", group: "construction", unit: "mm", factory: 0, min: 0, max: 200 }),
  v({ name: "dowel_offset_front", group: "construction", unit: "mm", factory: "sys_row_front", min: 5, max: 200 }),
  v({ name: "dowel_offset_rear", group: "construction", unit: "mm", factory: 20, min: 5, max: 200 }),
  v({ name: "dowel_max_spacing", group: "construction", unit: "mm", factory: 160, min: 32, max: 1000 }),
  v({ name: "dowel_min_count", group: "construction", unit: "count", factory: 2, min: 1, max: 20, integer: true, step: 1 }),

  // 32 mm system.
  v({ name: "sys_pitch", group: "system", unit: "mm", factory: 32, min: 1, max: 100 }),
  v({ name: "sys_row_front", group: "system", unit: "mm", factory: 37, min: 5, max: 200 }),
  v({ name: "sys_row_rear_min", group: "system", unit: "mm", factory: 37, min: 5, max: 300 }),
  v({ name: "sys_grid_y0", group: "system", unit: "mm", factory: "t_carcase / 2", min: 0, max: 200 }),
  v({ name: "sys_hole_d", group: "system", unit: "mm", factory: 5, min: 2, max: 12 }),
  v({ name: "sys_hole_depth", group: "system", unit: "mm", factory: 13, min: 1, max: 40 }),
  v({ name: "sys_margin", group: "system", unit: "mm", factory: 40, min: 0, max: 500 }),

  // Back panel.
  v({ name: "back_groove_offset", group: "back", unit: "mm", factory: 10, min: 0, max: 100 }),
  v({ name: "back_groove_depth", group: "back", unit: "mm", factory: 8, min: 1, max: 30 }),
  v({ name: "back_rebate_depth", group: "back", unit: "mm", factory: 8, min: 1, max: 30 }),
  v({ name: "back_play", group: "back", unit: "mm", factory: 1, min: 0, max: 10, step: 0.5 }),
  v({ name: "back_groove_clearance", group: "back", unit: "mm", factory: 0.5, min: 0, max: 5, step: 0.1 }),

  // Shelves.
  v({ name: "shelf_count", group: "shelves", unit: "count", factory: 1, min: 0, max: 20, integer: true, step: 1, quick: true }),
  v({ name: "shelf_gap", group: "shelves", unit: "mm", factory: 1, min: 0, max: 10, step: 0.5 }),
  v({ name: "shelf_front_setback", group: "shelves", unit: "mm", factory: 10, min: 0, max: 200 }),
  v({ name: "shelf_back_gap", group: "shelves", unit: "mm", factory: 2, min: 0, max: 50 }),
  v({ name: "shelf_pin_rest", group: "shelves", unit: "mm", factory: 3, min: 0, max: 30 }),
  v({ name: "fixed_shelf_setback", group: "shelves", unit: "mm", factory: 0, min: 0, max: 200 }),
  v({ name: "hat_shelf_drop", group: "shelves", unit: "mm", factory: 330, min: 100, max: 1000, step: 10 }),
  v({ name: "rail_drop", group: "shelves", unit: "mm", factory: 50, min: 20, max: 300, step: 5 }),

  // Fronts (full overlay in phase 0).
  v({ name: "door_count", group: "fronts", unit: "count", factory: 1, min: 0, max: 2, integer: true, step: 1, quick: true }),
  v({ name: "front_gap", group: "fronts", unit: "mm", factory: 3, min: 0, max: 20, step: 0.5, quick: true }),
  v({ name: "front_gap_top", group: "fronts", unit: "mm", factory: "front_gap", min: 0, max: 100 }),
  v({ name: "front_gap_bottom", group: "fronts", unit: "mm", factory: 0, min: -50, max: 100 }),
  v({ name: "front_gap_side", group: "fronts", unit: "mm", factory: "front_gap / 2", min: 0, max: 50 }),
  v({ name: "blind_w", group: "fronts", unit: "mm", factory: "worktop_d + 50", min: 100, max: 1500, step: 10 }),
  v({ name: "door_min_w", group: "fronts", unit: "mm", factory: 100, min: 20, max: 600, step: 10 }),

  // Hardware placement preferences (product data stays in the hardware items).
  v({ name: "hinge_end_offset", group: "hardware", unit: "mm", factory: 80, min: 20, max: 500, step: 5, quick: true }),
  v({ name: "hinge_count", group: "hardware", unit: "count", factory: 0, min: 0, max: 8, integer: true, step: 1 }),
  v({ name: "handle_edge_offset", group: "hardware", unit: "mm", factory: 40, min: 10, max: 400, step: 5 }),
  v({ name: "handle_end_offset", group: "hardware", unit: "mm", factory: 60, min: 10, max: 800, step: 5 }),
  v({ name: "handle_drawer_top", group: "hardware", unit: "mm", factory: 40, min: 10, max: 300, step: 5 }),
  v({ name: "leg_inset_side", group: "hardware", unit: "mm", factory: 50, min: 0, max: 300, step: 5 }),
  v({ name: "leg_inset_front", group: "hardware", unit: "mm", factory: "plinth_setback + 50", min: 0, max: 400, step: 5 }),
  v({ name: "leg_inset_rear", group: "hardware", unit: "mm", factory: 50, min: 0, max: 300, step: 5 }),
  v({ name: "leg_max_spacing", group: "hardware", unit: "mm", factory: 700, min: 100, max: 2000, step: 50 }),

  // Drawers (shop preferences; product data comes from the slide item).
  v({ name: "drawer_side_t", group: "drawers", unit: "mm", factory: "mat_drawer_t", min: 8, max: 25 }),
  v({ name: "drawer_bottom_t", group: "drawers", unit: "mm", factory: "mat_drawer_bottom_t", min: 3, max: 25 }),
  v({ name: "drawer_clearance", group: "drawers", unit: "mm", factory: 40, min: 0, max: 200, step: 5 }),
  v({ name: "drawer_setback", group: "drawers", unit: "mm", factory: 3, min: 0, max: 100 }),
  v({ name: "drawer_axis_offset", group: "drawers", unit: "mm", factory: 25, min: 0, max: 300, step: 1 }),
  v({ name: "drawer_bottom_offset", group: "drawers", unit: "mm", factory: 12, min: 0, max: 60 }),
  v({ name: "drawer_bottom_groove", group: "drawers", unit: "mm", factory: 6, min: 0, max: 15 }),
  v({ name: "front_screw_d", group: "drawers", unit: "mm", factory: 4, min: 2, max: 10, step: 0.5 }),
  v({ name: "front_screw_side", group: "drawers", unit: "mm", factory: 40, min: 10, max: 300 }),
  v({ name: "front_screw_edge", group: "drawers", unit: "mm", factory: 25, min: 8, max: 200 }),

  // Machining limits.
  v({ name: "bore_min_wall", group: "machining", unit: "mm", factory: 2, min: 0, max: 20, step: 0.5 }),
  v({ name: "through_overlap", group: "machining", unit: "mm", factory: 1, min: 0, max: 10, step: 0.5 }),
];

export const VARIABLE_BY_NAME: ReadonlyMap<string, VarDef> = new Map(VARIABLES.map((d) => [d.name, d]));

/** Read-only inputs injected from the chosen materials; expressions may use them. */
export const MATERIAL_CONSTANTS = {
  mat_carcase_t: "material.carcase",
  mat_back_t: "material.back",
  mat_shelf_t: "material.shelf",
  mat_front_t: "material.front",
  mat_drawer_t: "material.drawer",
  mat_drawer_bottom_t: "material.drawer_bottom",
  mat_worktop_t: "material.worktop",
} as const;

// ---------------------------------------------------------------------------
// Options: non-numeric choices (construction variants, library references).

export type HardwareCategory = "hinge" | "connector" | "shelf_support" | "slide" | "handle" | "leg" | "rail" | "other";

export type OptionKind =
  | { type: "enum"; values: readonly string[] }
  | { type: "material" }
  | { type: "hardware"; category: HardwareCategory; nullable?: boolean }
  | { type: "edgeband" } // edgeband id, or null for "no banding"
  | { type: "boolean" };

export interface OptionDef {
  key: string;
  group: VarGroup | "materials" | "edges";
  kind: OptionKind;
  factory: string | boolean | null;
}

export const OPTIONS: readonly OptionDef[] = [
  {
    key: "carcase_joint",
    group: "construction",
    kind: { type: "enum", values: ["sides_over", "sides_between"] },
    factory: "sides_over",
  },
  { key: "top", group: "construction", kind: { type: "enum", values: ["full", "rails"] }, factory: "rails" },
  {
    key: "back_mount",
    group: "back",
    kind: { type: "enum", values: ["groove", "rebate", "surface"] },
    factory: "groove",
  },
  { key: "joint_method", group: "construction", kind: { type: "enum", values: ["dowel", "none"] }, factory: "dowel" },
  {
    key: "hardware.connector",
    group: "construction",
    kind: { type: "hardware", category: "connector" },
    factory: "dowel-8x35",
  },
  { key: "system_holes", group: "system", kind: { type: "enum", values: ["full", "none"] }, factory: "full" },
  { key: "hardware.hinge", group: "hardware", kind: { type: "hardware", category: "hinge" }, factory: "generic-hinge-110" },
  {
    key: "hardware.shelf_support",
    group: "hardware",
    kind: { type: "hardware", category: "shelf_support", nullable: true },
    factory: "shelf-pin-5",
  },
  /** Holes that must go through (pull and knob screws): one bore, or from both faces. */
  { key: "bore.through", group: "machining", kind: { type: "enum", values: ["one_side", "both_sides"] }, factory: "one_side" },
  /** Holes from opposite faces that meet (shelf pins on both faces of a middle panel). */
  {
    key: "bore.opposite",
    group: "machining",
    kind: { type: "enum", values: ["both_sides", "through", "error"] },
    factory: "both_sides",
  },
  { key: "hardware.handle", group: "hardware", kind: { type: "hardware", category: "handle", nullable: true }, factory: null },
  { key: "handle.door", group: "hardware", kind: { type: "enum", values: ["vertical", "horizontal"] }, factory: "vertical" },
  { key: "handle.drawer", group: "hardware", kind: { type: "enum", values: ["center", "top"] }, factory: "center" },
  /** Wooden drawers without a system front fixing: screws through the inner front, or nothing drilled. */
  { key: "drawer_front.fixing", group: "drawers", kind: { type: "enum", values: ["screws", "none"] }, factory: "screws" },
  { key: "hardware.slide", group: "drawers", kind: { type: "hardware", category: "slide" }, factory: "generic-undermount" },
  /** Corner unit: which side is blind (hidden behind the perpendicular run). */
  { key: "corner", group: "fronts", kind: { type: "enum", values: ["none", "blind_left", "blind_right"] }, factory: "none" },
  /** Cutout in the worktop above a base unit (sink or hob), sized by cutout_* variables. */
  { key: "worktop_cutout", group: "room", kind: { type: "enum", values: ["none", "sink", "hob"] }, factory: "none" },
  /** Wardrobe interior: hat shelf and hanging rail in all, the first or the last section; else shelves. */
  {
    key: "interior",
    group: "shelves",
    kind: { type: "enum", values: ["shelves", "hanging", "hanging_first", "hanging_last"] },
    factory: "shelves",
  },
  { key: "hardware.rail", group: "hardware", kind: { type: "hardware", category: "rail" }, factory: "generic-wardrobe-rail" },
  /** Adjustable feet under floor units with a plinth (none: the plinth is built otherwise). */
  { key: "hardware.leg", group: "hardware", kind: { type: "hardware", category: "leg", nullable: true }, factory: "generic-leg-100" },
  { key: "door_hinge_side", group: "fronts", kind: { type: "enum", values: ["left", "right"] }, factory: "left" },
  { key: "material.carcase", group: "materials", kind: { type: "material" }, factory: "mel-white-19" },
  { key: "material.back", group: "materials", kind: { type: "material" }, factory: "hdf-white-8" },
  { key: "material.shelf", group: "materials", kind: { type: "material" }, factory: "mel-white-19" },
  { key: "material.front", group: "materials", kind: { type: "material" }, factory: "mdf-lacquer-19" },
  { key: "material.worktop", group: "materials", kind: { type: "material" }, factory: "worktop-laminate-38" },
  { key: "material.plinth", group: "materials", kind: { type: "material" }, factory: "mel-white-16" },
  { key: "material.drawer", group: "materials", kind: { type: "material" }, factory: "mel-white-16" },
  { key: "material.drawer_bottom", group: "materials", kind: { type: "material" }, factory: "hdf-white-8" },
  { key: "edge.carcase", group: "edges", kind: { type: "edgeband" }, factory: "abs-white-1" },
  { key: "edge.shelf", group: "edges", kind: { type: "edgeband" }, factory: "abs-white-1" },
  { key: "edge.front", group: "edges", kind: { type: "edgeband" }, factory: "abs-white-1" },
  { key: "edge.drawer", group: "edges", kind: { type: "edgeband" }, factory: "abs-white-1" },
  /** Subtract edgeband thickness from finished size to get the cut size. */
  { key: "edge.deduct", group: "edges", kind: { type: "boolean" }, factory: true },
];

export const OPTION_BY_KEY: ReadonlyMap<string, OptionDef> = new Map(OPTIONS.map((d) => [d.key, d]));

export type OptionValue = string | boolean | null;
