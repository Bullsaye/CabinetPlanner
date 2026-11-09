import type { LocalizedText } from "./text.ts";

/**
 * Factory cabinet templates (D30): starting points the app offers in its
 * "add cabinet" menu. A template is plain cabinet input without an id; all
 * sizes are variables or expressions over shop variables, so a template
 * follows the shop's standard sizes.
 */
export interface CabinetTemplate {
  id: string;
  name: LocalizedText;
  group: "kitchen" | "storage" | "wardrobe" | "bath";
  cabinet: {
    kind: "base" | "wall" | "tall";
    presets: string[];
    vars: Record<string, number | string>;
    options?: Record<string, string | boolean | null>;
    fronts?: { type: "door" | "drawer" | "open" | "appliance" | "panel" | "flap"; h?: number | string; doors?: number; hinge?: "left" | "right"; front?: boolean }[];
    construction?: {
      panels?: { y: number | string; setbackFront?: number | string; setbackRear?: number | string }[];
      fixed?: Record<string, { panel?: boolean; setbackFront?: number | string; setbackRear?: number | string }>;
      noBack?: number[];
      parts?: Record<string, unknown>[];
      omit?: string[];
      bores?: Record<string, unknown>[];
      hardware?: { item: string; qty?: number | string }[];
    };
    params?: { name: string; label?: LocalizedText; default?: number | string; min?: number; max?: number; step?: number; integer?: boolean; unit?: "mm" | "count" }[];
  };
}

const base = (vars: Record<string, number | string>, extra: Partial<CabinetTemplate["cabinet"]> = {}): CabinetTemplate["cabinet"] => ({
  kind: "base",
  presets: ["base-unit"],
  vars,
  ...extra,
});
const tall = (vars: Record<string, number | string>, extra: Partial<CabinetTemplate["cabinet"]> = {}): CabinetTemplate["cabinet"] => ({
  kind: "tall",
  presets: ["tall-unit"],
  vars,
  ...extra,
});
const wardrobe = (vars: Record<string, number | string>, extra: Partial<CabinetTemplate["cabinet"]> = {}): CabinetTemplate["cabinet"] => ({
  kind: "tall",
  presets: ["tall-unit", "wardrobe"],
  vars,
  ...extra,
});
/** A lower door zone in a tall unit lines up with the base unit fronts. */
const LOWER = "base_h - front_gap_top";

export const FACTORY_TEMPLATES: readonly CabinetTemplate[] = [
  // Kitchen
  { id: "base-door", group: "kitchen", name: { en: "Base, one door", de: "Unterschrank, eine Tür" }, cabinet: base({ W: 600 }) },
  { id: "base-2doors", group: "kitchen", name: { en: "Base, two doors", de: "Unterschrank, zwei Türen" }, cabinet: base({ W: 800, door_count: 2 }) },
  {
    id: "base-drawers-3",
    group: "kitchen",
    name: { en: "Base, three drawers", de: "Unterschrank, drei Schubkästen" },
    cabinet: base({ W: 600 }, { fronts: [{ type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer" }] }),
  },
  {
    id: "base-drawer-door",
    group: "kitchen",
    name: { en: "Base, drawer over door", de: "Unterschrank, Schubkasten über Tür" },
    cabinet: base({ W: 600 }, { fronts: [{ type: "drawer", h: 150 }, { type: "door" }] }),
  },
  { id: "base-sink", group: "kitchen", name: { en: "Sink base", de: "Spülenunterschrank" }, cabinet: base({ W: 800, door_count: 2, shelf_count: 0 }) },
  {
    id: "base-blind-corner",
    group: "kitchen",
    name: { en: "Blind corner base", de: "Eckunterschrank mit Blende" },
    cabinet: base({ W: 1000, door_count: 1 }, { options: { corner: "blind_right" } }),
  },
  {
    id: "base-oven",
    group: "kitchen",
    name: { en: "Oven base (under worktop)", de: "Backofen-Unterschrank" },
    cabinet: base({ W: 600, shelf_count: 0 }, { fronts: [{ type: "appliance", h: "oven_h" }, { type: "panel" }] }),
  },
  { id: "base-open", group: "kitchen", name: { en: "Open base", de: "Offener Unterschrank" }, cabinet: base({ W: 600, door_count: 0, shelf_count: 1 }) },
  { id: "wall-door", group: "kitchen", name: { en: "Wall unit, one door", de: "Hängeschrank, eine Tür" }, cabinet: { kind: "wall", presets: ["wall-unit"], vars: { W: 600 } } },
  { id: "wall-2doors", group: "kitchen", name: { en: "Wall unit, two doors", de: "Hängeschrank, zwei Türen" }, cabinet: { kind: "wall", presets: ["wall-unit"], vars: { W: 800, door_count: 2 } } },
  { id: "wall-open", group: "kitchen", name: { en: "Open wall shelf", de: "Offenes Hängeregal" }, cabinet: { kind: "wall", presets: ["wall-unit"], vars: { W: 600, door_count: 0 } } },
  {
    id: "tall-pantry",
    group: "kitchen",
    name: { en: "Pantry, two doors stacked", de: "Vorratsschrank, zwei Türen übereinander" },
    cabinet: tall({ W: 600 }, { fronts: [{ type: "door" }, { type: "door", h: LOWER }] }),
  },
  {
    id: "tall-oven",
    group: "kitchen",
    name: { en: "Tall oven housing", de: "Backofen-Hochschrank" },
    cabinet: tall({ W: 600, shelf_count: 1 }, { fronts: [{ type: "door" }, { type: "appliance", h: "oven_h" }, { type: "drawer", h: 250 }, { type: "drawer" }] }),
  },
  {
    id: "tall-fridge",
    group: "kitchen",
    name: { en: "Tall fridge housing (integrated)", de: "Kühlschrank-Hochschrank (integriert)" },
    // Above the fridge: a board set back at the rear for the air, a gap, a full board;
    // no back behind the fridge, a back in the upper section (D38).
    cabinet: tall(
      { W: 600, shelf_count: 0 },
      {
        fronts: [{ type: "door" }, { type: "appliance", h: "fridge_h", front: true }],
        construction: {
          fixed: { "1": { setbackRear: "fridge_vent_rear" } },
          panels: [{ y: "zone2_y1 + front_gap + t_carcase + fridge_vent" }],
          noBack: [2],
        },
      },
    ),
  },
  // Storage
  { id: "tall-bookcase", group: "storage", name: { en: "Bookcase (open)", de: "Bücherregal (offen)" }, cabinet: tall({ W: 800, D: 350, door_count: 0, shelf_count: 5 }) },
  {
    id: "tall-open-over-doors",
    group: "storage",
    name: { en: "Open shelves over doors", de: "Offenes Regal über Türen" },
    cabinet: tall({ W: 800, D: 400, door_count: 2, shelf_count: 3 }, { fronts: [{ type: "open" }, { type: "door", h: LOWER }] }),
  },
  { id: "sideboard", group: "storage", name: { en: "Sideboard, two doors", de: "Sideboard, zwei Türen" }, cabinet: base({ W: 1200, D: 450, door_count: 2 }) },
  {
    // Free construction (D45): nothing of the box rule, four free parts and two parameters.
    id: "bench",
    group: "storage",
    name: { en: "Bench (free construction)", de: "Sitzbank (freie Konstruktion)" },
    cabinet: {
      kind: "base",
      presets: [],
      vars: { W: 1200, H: 450, D: 380, shelf_count: 0, door_count: 0, plinth_h: 0 },
      options: { top: "full", back_mount: "none", system_holes: "none", "hardware.leg": null },
      params: [
        { name: "stretcher_h", label: { en: "Stretcher height", de: "Zargenhöhe" }, default: 120, min: 40, max: 400, step: 10 },
        { name: "stretcher_y", label: { en: "Stretcher above floor", de: "Zarge über Boden" }, default: 100, min: 0, max: 600, step: 10 },
      ],
      construction: {
        omit: ["SL", "SR", "BO", "TO"],
        parts: [
          { id: "WL", name: { en: "Cheek left", de: "Wange links" }, plane: "vertical", x: 0, y: 0, z: 0, dy: "H", dz: "D", edges: { front: "edge.carcase", rear: "edge.carcase", top: "edge.carcase" } },
          { id: "WR", name: { en: "Cheek right", de: "Wange rechts" }, plane: "vertical", x: "W - t_carcase", y: 0, z: 0, dy: "H", dz: "D", edges: { front: "edge.carcase", rear: "edge.carcase", top: "edge.carcase" } },
          { id: "SI", name: { en: "Seat", de: "Sitzfläche" }, plane: "horizontal", x: "t_carcase", y: "H - t_carcase", z: 0, dx: "W - 2 * t_carcase", dz: "D", edges: { front: "edge.carcase", rear: "edge.carcase" } },
          { id: "ST", name: { en: "Stretcher", de: "Zarge" }, plane: "frontal", x: "t_carcase", y: "stretcher_y", z: "D / 2 - t_carcase / 2", dx: "W - 2 * t_carcase", dy: "stretcher_h", edges: { top: "edge.carcase", bottom: "edge.carcase" } },
        ],
      },
    },
  },
  // Wardrobes
  { id: "wardrobe-hanging", group: "wardrobe", name: { en: "Wardrobe, hanging", de: "Kleiderschrank, Stange" }, cabinet: wardrobe({ W: 1000 }) },
  {
    id: "wardrobe-split",
    group: "wardrobe",
    name: { en: "Wardrobe, hanging and shelves", de: "Kleiderschrank, Stange und Böden" },
    cabinet: wardrobe({ W: 1000, partition_count: 1, shelf_count: 4 }, { options: { interior: "hanging_first" } }),
  },
  {
    id: "wardrobe-drawers",
    group: "wardrobe",
    name: { en: "Wardrobe, hanging over drawers", de: "Kleiderschrank, Stange über Schubkästen" },
    cabinet: wardrobe({ W: 1000 }, { fronts: [{ type: "door", doors: 2 }, { type: "drawer", h: 200 }, { type: "drawer", h: 200 }] }),
  },
  {
    id: "wardrobe-shelves",
    group: "wardrobe",
    name: { en: "Wardrobe, shelves", de: "Kleiderschrank, Fachböden" },
    cabinet: wardrobe({ W: 600, door_count: 1, shelf_count: 5 }, { options: { interior: "shelves" } }),
  },
  // Bath
  {
    id: "vanity",
    group: "bath",
    name: { en: "Vanity, wall-hung, two drawers", de: "Waschtischunterschrank, hängend, zwei Schubkästen" },
    cabinet: { kind: "wall", presets: ["wall-unit"], vars: { W: 800, H: 500, D: 460, wall_bottom: 350 }, fronts: [{ type: "drawer", h: 200 }, { type: "drawer" }] },
  },
  { id: "bath-tall", group: "bath", name: { en: "Bathroom tall unit", de: "Bad-Hochschrank" }, cabinet: tall({ W: 400, D: 350, shelf_count: 4 }) },
];
