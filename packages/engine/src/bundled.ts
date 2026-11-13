import { PACK_FILES } from "@cabinet-planner/packs";
import { buildLibrary, type Library } from "./library.ts";
import { mergePacks, PackSchema, selectPacks, type Pack, type PackSelection } from "./packs.ts";
import type { LibraryFragment, Shop } from "./schema.ts";

/**
 * The bundled packs (D76): the pack folders of the repository, compiled in
 * as JSON modules (`packs/index.ts`). This is the only place the engine
 * names content; every build function takes its packs as an argument and
 * falls back to these, so the CLI, the server, the app and the tests use one
 * path. Brand items carry their sources; all hardware is `untested` until machined.
 */
export const BUNDLED_PACKS: readonly Pack[] = PACK_FILES.map((raw) => PackSchema.parse(raw));

/** The bundled pack documents as written (no defaults filled in), e.g. templates to copy into a project. */
export const BUNDLED_PACK_FILES = PACK_FILES as readonly { id: string; content: Record<string, { id: string }[] | undefined> }[];

/** Everything in the bundled packs as one library fragment. */
export const BUNDLED: LibraryFragment = mergePacks(BUNDLED_PACKS);

/** The library of the bundled packs alone. */
export const bundledLibrary = (): Library => buildLibrary(...BUNDLED_PACKS.map((p) => p.content));

/**
 * The bundled packs as a shop file switches them (D76): packs in
 * `shop.disabledPacks` are off, except for the items the shop file and the
 * given documents (usually the project) use. What `buildProject` builds with
 * when it is given no packs.
 */
export function shopPacks(shop: Shop | undefined, docs: readonly unknown[] = []): PackSelection {
  return selectPacks(BUNDLED_PACKS, shop?.disabledPacks ?? [], shop ? [shop, ...docs] : docs);
}
