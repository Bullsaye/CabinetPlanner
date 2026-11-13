import { OPTION_BY_KEY, type Library, type OpSource, type Part, type PartRole, type ResolvedCabinet } from "@cabinet-planner/engine";

/**
 * One mapping between parts and the settings that drive them (D73), read in
 * both directions: a picked part lists its settings (part panel), a setting
 * with focus highlights its parts (3D view).
 *
 * A part is driven by the settings of its role (material, size, position)
 * and by the settings behind its machining: each operation names its source
 * (a joint, a hardware item, the system holes, the back groove).
 *
 * Keys are variable names or option keys; the two never share a name.
 */
export interface SettingGroup {
  /** Heading: `ui.pg.<id>`. */
  id: string;
  keys: readonly string[];
}
const g = (id: string, ...keys: string[]): SettingGroup => ({ id, keys });

const CARCASE_BOARD = g("board", "material.carcase", "t_carcase", "surface.carcase", "edge.carcase");
const FRONT_BOARD = g("board", "material.front", "t_front", "surface.front", "edge.front");
const GAPS = g("gaps", "front_gap", "front_gap_v", "front_gap_top", "front_gap_bottom", "front_gap_left", "front_gap_right", "front_gap_middle", "front_gap_side");
const HANDLE_DOOR = g("handle", "hardware.handle", "handle.door", "handle.door_y", "handle_height", "handle_edge_offset", "handle_end_offset", "bore.through");
const HANDLE_DRAWER = g("handle", "hardware.handle", "handle.drawer", "handle_drawer_top", "bore.through");
const DRAWER_BOARD = g("board", "material.drawer", "drawer_side_t", "edge.drawer");
const SLIDE = g("slide", "hardware.slide", "drawer_clearance", "drawer_setback", "drawer_axis_offset");
const FRONT_FIXING = g("front_fixing", "drawer_front.fixing", "front_screw_side", "front_screw_edge", "front_screw_d");
const DRAWER_BOTTOM = g("drawer_bottom", "material.drawer_bottom", "drawer_bottom_t", "drawer_bottom_offset", "drawer_bottom_groove");
const side = (which: "left" | "right"): SettingGroup[] => [
  g("board", "material.carcase", "t_carcase", "surface.carcase", "surface.visible_side", "edge.carcase"),
  g("size", "H", "D", `side.${which}`, "carcase_joint"),
];

/** Settings by part role: what the part is made of, how large it is, where it sits. */
export const ROLE_SETTINGS: Readonly<Record<PartRole, readonly SettingGroup[]>> = {
  side_left: side("left"),
  side_right: side("right"),
  bottom: [CARCASE_BOARD, g("size", "W", "D", "carcase_joint", "bottom_setback_front", "bottom_setback_rear")],
  top: [CARCASE_BOARD, g("size", "W", "D", "carcase_joint", "top", "top.base_unit")],
  rail_front: [CARCASE_BOARD, g("size", "top", "top.base_unit", "rail.front", "rail_w")],
  rail_rear: [CARCASE_BOARD, g("size", "top", "top.base_unit", "rail.rear", "rail_w")],
  rail_bottom: [CARCASE_BOARD, g("size", "rail.bottom", "rail_bottom_w", "bottom_setback_rear")],
  back: [
    g("board", "material.back", "t_back"),
    g("back", "back_mount", "back_extent", "back_groove_offset", "back_groove_depth", "back_rebate_depth", "back_play", "back_groove_clearance"),
  ],
  shelf: [
    g("board", "material.shelf", "t_shelf", "edge.shelf"),
    g("shelf", "shelf_count", "interior", "shelf_gap", "shelf_front_setback", "shelf_back_gap", "open_shelf", "hardware.shelf_support", "shelf_pin_rest"),
  ],
  partition: [CARCASE_BOARD, g("size", "partition_count", "partition_setback", "partition_joint")],
  top_slope: [CARCASE_BOARD, g("size", "W", "D", "slope_rear_drop", "slope_rear_angle")],
  fixed_shelf: [CARCASE_BOARD, g("size", "fixed_shelf_setback", "hat_shelf", "hat_shelf_drop")],
  door: [FRONT_BOARD, GAPS, g("hinge", "hardware.hinge", "hardware.hinge_middle", "door_hinge_side", "hinge_count", "hinge_end_offset", "door_count"), HANDLE_DOOR],
  flap: [FRONT_BOARD, GAPS, g("flap", "hardware.flap", "hinge_end_offset", "flap_handle_weight"), HANDLE_DRAWER],
  drawer_front: [FRONT_BOARD, GAPS, FRONT_FIXING, HANDLE_DRAWER, SLIDE],
  blind_panel: [FRONT_BOARD, GAPS, g("size", "corner", "blind_w", "door_min_w", "blind_panel.fixing")],
  appliance_front: [FRONT_BOARD, GAPS, g("size", "oven_h", "fridge_h")],
  ceiling_filler: [FRONT_BOARD, g("size", "ceiling_filler", "ceiling_filler_gap", "ceiling_filler_min", "ceiling_gap")],
  drawer_side_left: [DRAWER_BOARD, SLIDE],
  drawer_side_right: [DRAWER_BOARD, SLIDE],
  drawer_inner: [DRAWER_BOARD, FRONT_FIXING, SLIDE],
  drawer_back: [DRAWER_BOARD, SLIDE],
  drawer_bottom: [DRAWER_BOTTOM, SLIDE],
  // Free parts are placed by their own formulas (free construction); room parts by the room.
  custom: [],
  worktop: [g("board", "material.worktop", "worktop_t"), g("size", "worktop_d", "worktop_overhang_end", "worktop_cutout", "cutout_w", "cutout_d", "cutout_front", "cutout_offset", "cutout_r")],
  plinth: [g("board", "material.plinth"), g("size", "plinth_h", "plinth_setback", "plinth_floor_gap")],
};

/** Settings behind machining, by the source an operation names. */
const JOINT = g(
  "joint",
  "joint_method",
  "hardware.connector",
  "dowel_pattern",
  "dowel.opposite",
  "dowel_offset_front",
  "dowel_second",
  "dowel_raster",
  "dowel_offset_rear",
  "dowel_max_spacing",
  "dowel_min_count",
  "carcase_joint",
);
const SYSTEM = g("system", "system_holes", "sys_row_front", "sys_row_rear_min", "sys_grid_y0", "sys_pitch", "sys_margin", "sys_hole_d", "sys_hole_depth", "bore.opposite");
const BACK = g("back", "back_mount", "back_groove_offset", "back_groove_depth", "back_rebate_depth", "back_groove_clearance", "back_play");

/**
 * Hardware machining: the item is found through the option that chooses it;
 * the group holds the settings that position its bores.
 */
export const HARDWARE_SETTINGS: Readonly<Record<string, SettingGroup>> = {
  "hardware.hinge": g("hinge", "hardware.hinge", "door_hinge_side", "hinge_count", "hinge_end_offset"),
  "hardware.hinge_middle": g("hinge", "hardware.hinge_middle", "door_hinge_side", "hinge_count", "hinge_end_offset"),
  "hardware.flap": g("flap", "hardware.flap", "hinge_end_offset", "flap_handle_weight"),
  "hardware.shelf_support": g("shelf", "hardware.shelf_support", "shelf_count", "shelf_pin_rest"),
  "hardware.handle": g("handle", "hardware.handle", "handle.door", "handle.drawer", "handle_height", "handle_edge_offset", "handle_end_offset", "handle_drawer_top", "bore.through"),
  "hardware.slide": g("slide", "hardware.slide", "drawer_axis_offset", "drawer_setback", "drawer_clearance"),
  "hardware.leg": g("leg", "hardware.leg", "leg_inset_side", "leg_inset_front", "leg_inset_rear", "leg_max_spacing", "plinth_h"),
  "hardware.hanger": g("hanger", "hardware.hanger"),
  "hardware.rail": g("rail", "hardware.rail", "rail_drop", "hat_shelf_drop", "interior"),
  "hardware.fastener": g("fastener", "joint_method", "hardware.fastener", "connector_offset_front", "connector_offset_rear", "connector_max_spacing"),
  "hardware.joint_screw": g("joint_screw", "joint_screws", "hardware.joint_screw", "joint_screw_every"),
  "hardware.link": g("link", "cabinet_link", "hardware.link", "link_offset_front", "link_offset_end", "link_max_spacing"),
};

/** Group of settings of one machining source on a part, with the hardware item it belongs to. */
export interface SourceGroup {
  /** Stable key: source kind and what it refers to. */
  key: string;
  kind: OpSource["kind"];
  /** What the operations name: joints ("SL-BO", "SL-RF"), a hardware item id, … */
  refs: string[];
  /** Hardware item behind the operations. */
  item?: string;
  /** Number of operations (bores, pockets) from this source. */
  count: number;
  settings: SettingGroup;
}

/** The item id of a hardware source ("item", "item:front", "item:notch"). */
const itemOf = (ref: string): string => ref.split(":")[0]!;

/** Settings of one operation source; the cabinet's options tell which option chose a hardware item. */
export function sourceSettings(src: OpSource, resolved: ResolvedCabinet | undefined, library?: Library): { id: string; item?: string; settings: SettingGroup } {
  if (src.kind === "system") return { id: "system", settings: SYSTEM };
  if (src.kind === "back") return { id: "back", settings: BACK };
  if (src.kind === "custom") return { id: "custom", settings: g("custom") };
  if (src.kind === "joint") {
    if (/^DI\d+-DF\d+$/.test(src.ref)) return { id: "front_fixing", settings: FRONT_FIXING };
    if (/^DT\d+$/.test(src.ref)) return { id: "drawer_bottom", settings: DRAWER_BOTTOM };
    return { id: "joint", settings: JOINT };
  }
  const item = itemOf(src.ref);
  if (src.ref.startsWith("cutout:")) return { id: "cutout", settings: g("cutout", "worktop_cutout", "cutout_w", "cutout_d", "cutout_front", "cutout_offset", "cutout_r") };
  for (const [key, settings] of Object.entries(HARDWARE_SETTINGS)) {
    if (resolved?.options.get(key)?.value === item) return { id: `hardware:${item}`, item, settings };
  }
  // A fitting placed by hand (free construction), or one an item brings along.
  return { id: `hardware:${item}`, ...(library?.hardware.has(item) ? { item } : {}), settings: g("fitting") };
}

/** The machining of a part grouped by source, in the order the operations come. */
export function partSources(part: Part, resolved: ResolvedCabinet | undefined, library?: Library): SourceGroup[] {
  const out = new Map<string, SourceGroup>();
  for (const op of part.operations) {
    for (const src of op.sources) {
      const s = sourceSettings(src, resolved, library);
      const have = out.get(s.id);
      if (have) {
        have.count++;
        if (!have.refs.includes(src.ref)) have.refs.push(src.ref);
      } else out.set(s.id, { key: s.id, kind: src.kind, refs: [src.ref], ...(s.item ? { item: s.item } : {}), count: 1, settings: s.settings });
    }
  }
  return [...out.values()];
}

/** True when a setting drives this part: through its role or through the source of one of its operations. */
export function settingDrives(key: string, part: Part, resolved: ResolvedCabinet | undefined): boolean {
  if (ROLE_SETTINGS[part.role].some((grp) => grp.keys.includes(key))) return true;
  return part.operations.some((op) => op.sources.some((src) => sourceSettings(src, resolved).settings.keys.includes(key)));
}

export const isOption = (key: string): boolean => OPTION_BY_KEY.has(key);

/** The fittings a cabinet's fronts bring, read from what the engine laid out (all sections): hinges, slides, flap fittings. */
export function frontFittings(layout: { doors: readonly unknown[]; drawers: readonly unknown[]; flaps: readonly unknown[] } | undefined): Set<"door" | "drawer" | "flap"> {
  const out = new Set<"door" | "drawer" | "flap">();
  if (layout?.doors.length) out.add("door");
  if (layout?.drawers.length) out.add("drawer");
  if (layout?.flaps.length) out.add("flap");
  return out;
}
