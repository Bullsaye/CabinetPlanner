import { z } from "zod";

import type { HardwareItem } from "./hardware/schema.ts";
import { LocalizedText } from "./text.ts";

export { LocalizedText, localName } from "./text.ts";

export const Material = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  /** Board thickness in mm. */
  thickness: z.number().positive(),
  /** True when the board has a visible grain direction to respect. */
  grain: z.boolean().default(false),
  /** Density in kg/m³ (front weights for lift fittings). */
  density: z.number().positive().optional(),
  /** Price per m², currency of the shop. Optional until costing (v1). */
  pricePerM2: z.number().nonnegative().optional(),
  /** Display colour of the board as it comes (#rrggbb), for views; no production meaning. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type Material = z.infer<typeof Material>;

/**
 * A surface finish applied to a part on top of its board (D53): laminate,
 * lacquer in a colour, veneer, oil. Direct-coated board needs none: its
 * surface is the material.
 */
export const Surface = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  kind: z.enum(["melamine", "hpl", "lacquer", "veneer", "oil", "other"]).default("other"),
  /** What to order or mix: RAL / NCS tone, decor number. Printed in lists next to the name. */
  ref: z.string().optional(),
  /** Display colour (#rrggbb), for views. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type Surface = z.infer<typeof Surface>;

export const Edgeband = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  /** Band thickness in mm; deducted from the cut size when `edge.deduct` is on. */
  thickness: z.number().nonnegative(),
  /** Band width (height) in mm. */
  width: z.number().positive(),
  /** Short code printed in the cutlist edge columns. */
  code: z.string().min(1).max(8),
  pricePerM: z.number().nonnegative().optional(),
});
export type Edgeband = z.infer<typeof Edgeband>;

export interface Library {
  materials: ReadonlyMap<string, Material>;
  edgebands: ReadonlyMap<string, Edgeband>;
  hardware: ReadonlyMap<string, HardwareItem>;
  surfaces: ReadonlyMap<string, Surface>;
}

/**
 * One layer of the library: a pack's content, the shop library, the project
 * library (D61). Layers merge in that order; later items replace earlier
 * ones with the same id.
 */
export interface LibraryLayer {
  materials?: readonly Material[];
  edgebands?: readonly Edgeband[];
  hardware?: readonly HardwareItem[];
  surfaces?: readonly Surface[];
}

export function buildLibrary(...layers: LibraryLayer[]): Library {
  const materials = new Map<string, Material>();
  const edgebands = new Map<string, Edgeband>();
  const hardware = new Map<string, HardwareItem>();
  const surfaces = new Map<string, Surface>();
  for (const layer of layers) {
    layer.surfaces?.forEach((s) => surfaces.set(s.id, s));
    layer.materials?.forEach((m) => materials.set(m.id, m));
    layer.edgebands?.forEach((e) => edgebands.set(e.id, e));
    layer.hardware?.forEach((h) => hardware.set(h.id, h));
  }
  return { materials, edgebands, hardware, surfaces };
}
