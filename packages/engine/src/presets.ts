import type { Preset } from "./schema.ts";

/**
 * Factory presets: starting points for the common cabinet kinds. They only
 * set expressions over shop-level variables (wall_h, tall_h, …), so a shop
 * changes its standard sizes once and every unit follows.
 */
export const FACTORY_PRESETS: readonly Preset[] = [
  {
    id: "base-unit",
    name: { en: "Base unit", de: "Unterschrank" },
    group: "kind",
    vars: { H: "base_h", D: "worktop_d - 40", shelf_count: 1, door_count: 1 },
    options: {},
  },
  {
    id: "wall-unit",
    name: { en: "Wall unit", de: "Hängeschrank" },
    group: "kind",
    vars: { H: "wall_h", D: "wall_d", shelf_count: 2, door_count: 1, front_gap_bottom: 0 },
    options: {},
  },
  {
    id: "tall-unit",
    name: { en: "Tall unit", de: "Hochschrank" },
    group: "kind",
    vars: { H: "tall_h", D: "worktop_d - 40", shelf_count: 4, door_count: 1 },
    options: { "handle.door_y": "height" },
  },
  {
    id: "wardrobe",
    name: { en: "Wardrobe", de: "Kleiderschrank" },
    group: "kind",
    vars: { H: "wardrobe_h", D: "wardrobe_d", shelf_count: 0, door_count: 2 },
    options: { interior: "hanging" },
  },
];
