import { z } from "zod";
import { DrawingStyleSchema } from "./drawing/style.ts";
import { HardwareItem } from "./hardware/schema.ts";
import { Edgeband, Material } from "./library.ts";
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

/** A named, partial set of variables and options. */
export const Preset = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  /** Free grouping for the UI, e.g. "construction", "hardware", "fronts". */
  group: z.string().optional(),
  vars: z.record(identifier, VarInputSchema).default({}),
  options: z.record(z.string(), OptionValueSchema).default({}),
});
export type Preset = z.infer<typeof Preset>;

const EdgeRef = z.string().nullable();
export const PartOverride = z.object({
  material: z.string().optional(),
  edges: z
    .object({ l1: EdgeRef.optional(), l2: EdgeRef.optional(), w1: EdgeRef.optional(), w2: EdgeRef.optional() })
    .optional(),
  note: z.string().optional(),
});
export type PartOverride = z.infer<typeof PartOverride>;

export const CabinetSchema = z.object({
  /** Short id used in part numbers, e.g. "B01". Must stay stable. */
  id: z.string().regex(/^[A-Za-z0-9]{1,8}$/, "1–8 letters or digits"),
  type: z.literal("box"),
  /** Where the cabinet sits in a run: on the floor (base, tall) or on the wall. */
  kind: z.enum(["base", "wall", "tall"]).default("base"),
  name: z.string().optional(),
  ...layerFields,
  /** Part layer: per-part overrides keyed by part code (e.g. "SL", "SH1"). */
  parts: z.record(z.string(), PartOverride).default({}),
});
export type CabinetInput = z.infer<typeof CabinetSchema>;

/** Library section of a project or shop file; later layers replace items with the same id. */
const LibraryFile = z
  .object({
    materials: z.array(Material).default([]),
    edgebands: z.array(Edgeband).default([]),
    hardware: z.array(HardwareItem).default([]),
    presets: z.array(Preset).default([]),
    /** Drawing styles, usually `extends` a factory style plus taught rules. */
    drawingStyles: z.array(DrawingStyleSchema).default([]),
  })
  .default({ materials: [], edgebands: [], hardware: [], presets: [], drawingStyles: [] });

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
});
export type Shop = z.infer<typeof ShopSchema>;
