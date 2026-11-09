import { z } from "zod";

/**
 * Library items are user data, so their names are plain text. Factory items
 * may carry a name per locale; `localName` picks one with English fallback.
 */
export const LocalizedText = z.union([z.string(), z.record(z.string(), z.string())]);
export type LocalizedText = z.infer<typeof LocalizedText>;

export function localName(text: LocalizedText, locale: string): string {
  if (typeof text === "string") return text;
  return text[locale] ?? text["en"] ?? Object.values(text)[0] ?? "";
}

export const Material = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  /** Board thickness in mm. */
  thickness: z.number().positive(),
  /** True when the board has a visible grain direction to respect. */
  grain: z.boolean().default(false),
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
}

/** Seed library. Values are typical, not tied to a specific supplier. */
export const FACTORY_MATERIALS: readonly Material[] = [
  { id: "mel-white-19", name: { en: "Melamine white 19", de: "Melamin weiß 19" }, thickness: 19, grain: false },
  { id: "hdf-white-8", name: { en: "HDF white 8", de: "HDF weiß 8" }, thickness: 8, grain: false },
  { id: "mdf-lacquer-19", name: { en: "Lacquer MDF 19", de: "MDF lackiert 19" }, thickness: 19, grain: false },
  { id: "oak-veneer-19", name: { en: "Oak veneer 19", de: "Eiche furniert 19" }, thickness: 19, grain: true },
];

export const FACTORY_EDGEBANDS: readonly Edgeband[] = [
  { id: "abs-white-1", name: { en: "ABS white 1 mm", de: "ABS weiß 1 mm" }, thickness: 1, width: 23, code: "W1" },
  { id: "abs-white-2", name: { en: "ABS white 2 mm", de: "ABS weiß 2 mm" }, thickness: 2, width: 23, code: "W2" },
  { id: "oak-veneer-05", name: { en: "Oak veneer 0.5 mm", de: "Eiche Furnier 0,5 mm" }, thickness: 0.5, width: 24, code: "O05" },
];

/** Merges library layers; later items replace earlier ones with the same id. */
export function buildLibrary(
  ...layers: { materials?: readonly Material[]; edgebands?: readonly Edgeband[] }[]
): Library {
  const materials = new Map<string, Material>();
  const edgebands = new Map<string, Edgeband>();
  for (const layer of layers) {
    layer.materials?.forEach((m) => materials.set(m.id, m));
    layer.edgebands?.forEach((e) => edgebands.set(e.id, e));
  }
  return { materials, edgebands };
}

export const factoryLibrary = (): Library =>
  buildLibrary({ materials: FACTORY_MATERIALS, edgebands: FACTORY_EDGEBANDS });
