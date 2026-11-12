import { z } from "zod";
import { DrawingStyleSchema } from "./drawing/style.ts";
import { DxfProfileSchema } from "./output/dxf.ts";
import { PlacementSchema, RoomSchema } from "./room/room.ts";
import { HardwareItem } from "./hardware/schema.ts";
import { Edgeband, Material, Surface } from "./library.ts";
import { LocalizedText } from "./text.ts";

/**
 * File formats. Every file carries `schemaVersion`; `migrate()` in
 * `project.ts` lifts older versions before they reach these schemas.
 */
export const SCHEMA_VERSION = 1;

export const VarInputSchema = z.union([z.number(), z.string().trim().min(1)]);
export const OptionValueSchema = z.union([z.string(), z.boolean(), z.null()]);

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid identifier");

/** Fields shared by every layer that can override values. */
const layerFields = {
  /** Named presets applied in order before this layer's own values. */
  presets: z.array(z.string()).default([]),
  vars: z.record(identifier, VarInputSchema).default({}),
  options: z.record(z.string(), OptionValueSchema).default({}),
};

export const Layer = z.object(layerFields);
export type Layer = z.infer<typeof Layer>;

/**
 * A parameter (D45): a variable its author puts into the simple editor.
 * `name` is the function name used in formulas (shown when there is no
 * label); `label` and `description` are display texts anyone may change or
 * translate without touching a formula. The name may be a catalogue
 * variable (then the parameter only adds it to the simple editor).
 * Cabinets, templates and presets carry parameters.
 */
export const ParamSchema = z.object({
  name: identifier,
  label: LocalizedText.optional(),
  description: LocalizedText.optional(),
  default: VarInputSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  integer: z.boolean().optional(),
  unit: z.enum(["mm", "count"]).default("mm"),
});
export type ParamInput = z.infer<typeof ParamSchema>;

/** A named, partial set of variables and options. */
export const Preset = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  /** Free grouping for the UI, e.g. "construction", "hardware", "fronts". */
  group: z.string().optional(),
  vars: z.record(identifier, VarInputSchema).default({}),
  options: z.record(z.string(), OptionValueSchema).default({}),
  /** Variables this preset introduces or puts into the simple editor (D45). */
  params: z.array(ParamSchema).max(60).default([]),
});
export type Preset = z.infer<typeof Preset>;

const EdgeRef = z.string().nullable();
const EdgeNote = z.string().max(40);
export const PartOverride = z.object({
  material: z.string().optional(),
  edges: z
    .object({ l1: EdgeRef.optional(), l2: EdgeRef.optional(), w1: EdgeRef.optional(), w2: EdgeRef.optional() })
    .optional(),
  /** Surface finish of this part (D53); null: the board as it comes. */
  surface: z.string().nullable().optional(),
  note: z.string().optional(),
  /**
   * A short remark per edge for production (D60), e.g. "45°" where a mitre
   * is cut. Free text: it changes no geometry and no cut size.
   */
  edgeNotes: z
    .object({ l1: EdgeNote.optional(), l2: EdgeNote.optional(), w1: EdgeNote.optional(), w2: EdgeNote.optional() })
    .optional(),
});
export type PartOverride = z.infer<typeof PartOverride>;

/**
 * One front of the stack, listed top to bottom. `h` is the front height
 * (number or formula); fronts without `h` share the remaining height.
 */
export const FrontZone = z.object({
  /**
   * door / drawer; open: no front (shelves stay visible); appliance: a niche
   * for a built-in appliance, with `front: true` a panel fixed to the
   * appliance door (integrated fridge, dishwasher) instead of an open niche;
   * panel: a fixed front without hinges (filler under an oven); flap: a
   * front lifting up on a lift fitting (hardware.flap).
   */
  type: z.enum(["drawer", "door", "open", "appliance", "panel", "flap"]),
  h: VarInputSchema.optional(),
  /** Door zones: 1 or 2 doors side by side (default: door_count). */
  doors: z.number().int().min(1).max(2).optional(),
  /** Door zones with one door: the hinge side (default: option door_hinge_side). */
  hinge: z.enum(["left", "right"]).optional(),
  front: z.boolean().optional(),
});
export type FrontZone = z.infer<typeof FrontZone>;

const EdgeInput = z.string().min(1).nullable();

/**
 * A free part (D45): a board in one of the three planes, placed by formulas
 * in cabinet coordinates (D2). The size across the board is the material
 * thickness unless given. Formulas see every variable of the cabinet, the
 * zone edges, and with `repeat` the counters `i` (1…n) and `n`.
 */
export const CustomPartSchema = z.object({
  /** Part code, unique in the cabinet and stable (D6); with `repeat` the index is appended. */
  id: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/, "1–6 capital letters or digits, starting with a letter"),
  name: LocalizedText.optional(),
  /** horizontal: lies flat (thickness along Y); vertical: stands front to back (thickness along X); frontal: stands across (thickness along Z). */
  plane: z.enum(["horizontal", "vertical", "frontal"]),
  x: VarInputSchema.default(0),
  y: VarInputSchema.default(0),
  z: VarInputSchema.default(0),
  dx: VarInputSchema.optional(),
  dy: VarInputSchema.optional(),
  dz: VarInputSchema.optional(),
  /** A material option key ("material.carcase") or a material id. */
  material: z.string().min(1).default("material.carcase"),
  /** Axis the part length (and grain) runs along; default X, or Y for vertical parts. */
  grain: z.enum(["x", "y", "z"]).optional(),
  /** Edgebands by where the edge faces in the cabinet: an edge option key ("edge.carcase"), an edgeband id or null. */
  edges: z
    .object({ front: EdgeInput.optional(), rear: EdgeInput.optional(), left: EdgeInput.optional(), right: EdgeInput.optional(), top: EdgeInput.optional(), bottom: EdgeInput.optional() })
    .default({}),
  /** A surface option key ("surface.front"), a surface id, or null for none; default: by the material option. */
  surface: z.string().min(1).nullable().optional(),
  /** Present only when this formula is not 0. */
  when: VarInputSchema.optional(),
  /** Number of copies; formulas then see `i` and `n`. */
  repeat: VarInputSchema.optional(),
  /** auto: joined (construction method) to every panel face one of its ends meets. */
  joint: z.enum(["auto", "none"]).default("auto"),
  note: z.string().optional(),
});
export type CustomPartInput = z.infer<typeof CustomPartSchema>;

/** A free bore: on face `face` of part `part`, at (u, v) along its length and width. */
const PartRef = z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(40)]);
const FaceRef = z.enum(["inner", "outer", "t0", "t1", "l1", "l2", "w1", "w2"]);

export const CustomBoreSchema = z.object({
  /** One part code or several: the same local position on each (left and right side: a mirrored pair). */
  part: PartRef,
  /**
   * inner / outer: the wide face towards / away from the cabinet centre;
   * t0 / t1: the wide face at the low / high end of the thickness axis;
   * l1, l2, w1, w2: the edges (D13).
   */
  face: FaceRef.default("inner"),
  u: VarInputSchema,
  v: VarInputSchema,
  d: VarInputSchema,
  /** Depth; 0 or "through" drills through the part. */
  depth: VarInputSchema,
  when: VarInputSchema.optional(),
  repeat: VarInputSchema.optional(),
});
export type CustomBoreInput = z.infer<typeof CustomBoreSchema>;

/**
 * A fitting placed on a part (D45): the drilling of a hardware item (its
 * mount "part" operations: `a` along the part length, `b` along the width)
 * around the point (u, v). Swapping the item swaps the holes. `mirror`
 * measures v from the opposite edge and flips `b`: the mirrored copy for
 * the other hand (second door, opposite side of a pair that is not symmetric).
 */
export const FittingPlacementSchema = z.object({
  item: z.string().min(1),
  part: PartRef,
  face: z.enum(["inner", "outer", "t0", "t1"]).default("inner"),
  u: VarInputSchema,
  v: VarInputSchema,
  mirror: z.boolean().default(false),
  when: VarInputSchema.optional(),
  repeat: VarInputSchema.optional(),
});
export type FittingPlacementInput = z.infer<typeof FittingPlacementSchema>;


/**
 * Construction elements of a cabinet (D38), beyond what the variables
 * describe: extra horizontal panels, changes to the automatic fixed shelves
 * between zones, and zones without a back. Expressions may use the zone
 * edges `zone<i>_y0` / `zone<i>_y1` (front bottom/top edge of zone i, 1 = top).
 */
export const ConstructionSchema = z.object({
  /** Extra panels: bottom face at y (cabinet Y), shortened at the front and/or rear. */
  panels: z
    .array(z.object({ y: VarInputSchema, setbackFront: VarInputSchema.default(0), setbackRear: VarInputSchema.default(0) }))
    .default([]),
  /** Automatic fixed shelf under zone i ("1" = between zones 1 and 2): left out, or shortened. */
  fixed: z
    .record(z.string(), z.object({ panel: z.boolean().default(true), setbackFront: VarInputSchema.default(0), setbackRear: VarInputSchema.default(0) }))
    .default({}),
  /** Zones (1 = top) that get no back; the back splits at the panels around them. */
  noBack: z.array(z.number().int().min(1)).default([]),
  /** Free parts (D45): boards placed by formulas, beyond what the box rule builds. */
  parts: z.array(CustomPartSchema).max(200).default([]),
  /** Part codes of the box rule to leave out (e.g. "TO", "BK"), to replace them with free parts. */
  omit: z.array(z.string().min(1)).default([]),
  /** Free bores on any part, in part-local coordinates (D13). */
  bores: z.array(CustomBoreSchema).max(500).default([]),
  /** Fittings placed on parts: the item's drilling at a position, and the item in the lists. */
  fittings: z.array(FittingPlacementSchema).max(200).default([]),
  /** Extra hardware and consumables for the lists. */
  hardware: z.array(z.object({ item: z.string().min(1), qty: VarInputSchema.default(1) })).max(100).default([]),
});
export type ConstructionInput = z.infer<typeof ConstructionSchema>;

export const CabinetSchema = z.object({
  /** Short id used in part numbers, e.g. "B01". Must stay stable. */
  id: z.string().regex(/^[A-Za-z0-9]{1,8}$/, "1–8 letters or digits"),
  type: z.literal("box"),
  /** Where the cabinet sits in a run: on the floor (base, tall) or on the wall. */
  kind: z.enum(["base", "wall", "tall"]).default("base"),
  name: z.string().optional(),
  ...layerFields,
  /** Where the cabinet stands in the room (wall and position along it). */
  place: PlacementSchema.optional(),
  /** Front stack, top to bottom. Without it the cabinet has one door zone (door_count doors). */
  fronts: z.array(FrontZone).max(12).optional(),
  /** Construction elements (extra panels, back zones). */
  construction: ConstructionSchema.optional(),
  /** Parameters shown in the simple editor (D45). */
  params: z.array(ParamSchema).max(60).default([]),
  /** Part layer: per-part overrides keyed by part code (e.g. "SL", "SH1"). */
  parts: z.record(z.string(), PartOverride).default({}),
  /** Template this cabinet was made from (the app saves construction changes back to it). */
  template: z.string().optional(),
});
export type CabinetInput = z.infer<typeof CabinetSchema>;

/**
 * A cabinet template of the shop (D33): cabinet input without id and place,
 * offered in the app's add menu next to the factory templates.
 */
export const CabinetTemplateSchema = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  group: z.string().default("shop"),
  cabinet: z.object({
    kind: z.enum(["base", "wall", "tall"]).default("base"),
    presets: z.array(z.string()).default([]),
    vars: z.record(identifier, VarInputSchema).default({}),
    options: z.record(z.string(), OptionValueSchema).default({}),
    fronts: z.array(FrontZone).max(12).optional(),
    construction: ConstructionSchema.optional(),
    params: z.array(ParamSchema).max(60).default([]),
    parts: z.record(z.string(), PartOverride).default({}),
  }),
});
export type CabinetTemplateInput = z.infer<typeof CabinetTemplateSchema>;

/**
 * A library fragment: the shape of the library section. Community packs
 * carry one as their content; installing a pack merges it into the shop
 * library (D49).
 */
export const LibraryFragmentSchema = z.object({
  materials: z.array(Material).default([]),
  edgebands: z.array(Edgeband).default([]),
  hardware: z.array(HardwareItem).default([]),
  surfaces: z.array(Surface).default([]),
  presets: z.array(Preset).default([]),
  /** Drawing styles, usually `extends` a factory style plus taught rules. */
  drawingStyles: z.array(DrawingStyleSchema).default([]),
  /** DXF layer profiles: map machining to the CAM's layer names. */
  dxfProfiles: z.array(DxfProfileSchema).default([]),
  /** Cabinet templates for the add menu. */
  templates: z.array(CabinetTemplateSchema).default([]),
});
export type LibraryFragment = z.infer<typeof LibraryFragmentSchema>;
export const LIBRARY_KINDS = ["presets", "templates", "hardware", "materials", "edgebands", "surfaces", "drawingStyles", "dxfProfiles"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** Library section of a project or shop file; later layers replace items with the same id. */
const LibraryFile = LibraryFragmentSchema.default({ materials: [], edgebands: [], hardware: [], surfaces: [], presets: [], drawingStyles: [], dxfProfiles: [], templates: [] });

/** A community pack installed into the shop library (D49): which version, and which items came with it. */
export const InstalledPackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().default(""),
  trust: z.enum(["community", "tested", "verified"]).default("community"),
  /** Ids of the installed items per library kind. */
  items: z.record(z.string(), z.array(z.string())).default({}),
  /** Fingerprint per installed item ("kind/id"), to tell what the user changed since. */
  hashes: z.record(z.string(), z.string()).optional(),
  /** Pack items installed under another id because the library had its own item of that id ("kind/id" → new id). */
  renames: z.record(z.string(), z.string()).optional(),
  /** The user confirmed a CNC export with this pack's untested hardware data. */
  cncConfirmed: z.boolean().optional(),
});
export type InstalledPack = z.infer<typeof InstalledPackSchema>;

export const ProjectSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    kind: z.literal("project").default("project"),
    name: z.string().min(1),
    revision: z.number().int().nonnegative().default(1),
    library: LibraryFile,
    /**
     * Inline shop layer. Normally the shop layer comes from the shop file;
     * this is for self-contained example and test projects.
     */
    shop: Layer.optional(),
    ...layerFields,
    /** The room: walls, windows, doors. Without it cabinets stand in a simple run. */
    room: RoomSchema.optional(),
    cabinets: z.array(CabinetSchema).default([]),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.cabinets.forEach((c, i) => {
      if (seen.has(c.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate cabinet id "${c.id}"`, path: ["cabinets", i, "id"] });
      }
      seen.add(c.id);
    });
  });
export type Project = z.infer<typeof ProjectSchema>;

/** Shop file: the user's library additions, presets and default layer. */
export const ShopSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  kind: z.literal("shop"),
  name: z.string().default("Shop"),
  library: LibraryFile,
  /** The shop default layer ("Set as default" points presets here). */
  defaults: Layer.default({ presets: [], vars: {}, options: {} }),
  /** Community packs installed into this library (the app shows updates for them). */
  installedPacks: z.array(InstalledPackSchema).optional(),
});
export type Shop = z.infer<typeof ShopSchema>;
