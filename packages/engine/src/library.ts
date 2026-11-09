import { z } from "zod";

import { FACTORY_HARDWARE } from "./hardware/factory.ts";
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
});
export type Material = z.infer<typeof Material>;

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
}

/** Seed library. Values are typical, not tied to a specific supplier. */
export const FACTORY_MATERIALS: readonly Material[] = [
  { id: "mel-white-19", name: { en: "Melamine white 19", de: "Melamin weiß 19" }, thickness: 19, grain: false, density: 650 },
  { id: "hdf-white-8", name: { en: "HDF white 8", de: "HDF weiß 8" }, thickness: 8, grain: false, density: 850 },
  { id: "mel-white-16", name: { en: "Melamine white 16", de: "Melamin weiß 16" }, thickness: 16, grain: false, density: 650 },
  { id: "mdf-lacquer-19", name: { en: "Lacquer MDF 19", de: "MDF lackiert 19" }, thickness: 19, grain: false, density: 750 },
  { id: "worktop-laminate-38", name: { en: "Worktop laminate 38", de: "Arbeitsplatte Schichtstoff 38" }, thickness: 38, grain: false, density: 700 },
  { id: "oak-veneer-19", name: { en: "Oak veneer 19", de: "Eiche furniert 19" }, thickness: 19, grain: true, density: 650 },
];

export const FACTORY_EDGEBANDS: readonly Edgeband[] = [
  { id: "abs-white-1", name: { en: "ABS white 1 mm", de: "ABS weiß 1 mm" }, thickness: 1, width: 23, code: "W1" },
  { id: "abs-white-2", name: { en: "ABS white 2 mm", de: "ABS weiß 2 mm" }, thickness: 2, width: 23, code: "W2" },
  { id: "oak-veneer-05", name: { en: "Oak veneer 0.5 mm", de: "Eiche Furnier 0,5 mm" }, thickness: 0.5, width: 24, code: "O05" },
];

/** Merges library layers; later items replace earlier ones with the same id. */
export interface LibraryLayer {
  materials?: readonly Material[];
  edgebands?: readonly Edgeband[];
  hardware?: readonly HardwareItem[];
}

export const FACTORY_LIBRARY: LibraryLayer = {
  materials: FACTORY_MATERIALS,
  edgebands: FACTORY_EDGEBANDS,
  hardware: FACTORY_HARDWARE,
};

export function buildLibrary(...layers: LibraryLayer[]): Library {
  const materials = new Map<string, Material>();
  const edgebands = new Map<string, Edgeband>();
  const hardware = new Map<string, HardwareItem>();
  for (const layer of layers) {
    layer.materials?.forEach((m) => materials.set(m.id, m));
    layer.edgebands?.forEach((e) => edgebands.set(e.id, e));
    layer.hardware?.forEach((h) => hardware.set(h.id, h));
  }
  return { materials, edgebands, hardware };
}

export const factoryLibrary = (): Library => buildLibrary(FACTORY_LIBRARY);
