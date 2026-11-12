import { z } from "zod";
import { OPTIONS } from "./catalog.ts";
import { LIBRARY_KINDS, LibraryFragmentSchema, type LibraryFragment, type LibraryKind } from "./schema.ts";
import { LocalizedText, localName } from "./text.ts";

/**
 * A pack (D61): metadata plus a library fragment. The content the engine
 * builds with comes in packs: the bundled ones (`packs/` in the repository,
 * shipped with the app and the CLI) and, through the shop library, the ones
 * a user installs from a server. One format for both.
 */
export const PackSchema = z.object({
  /** Stable id; the folder name of a bundled pack. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lower-case letters, digits and '-'"),
  name: LocalizedText,
  description: LocalizedText.default(""),
  version: z.string().min(1),
  /** Licence id (SPDX) or the name of a commercial licence. */
  licence: z.string().min(1).default("CC-BY-4.0"),
  author: z.string().default(""),
  /** What the pack is mainly about, for listing: core, templates, hardware, materials, surfaces, presets. */
  kind: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Ids of packs whose items this one refers to. */
  requires: z.array(z.string()).default([]),
  /** Free fields for listings and shops (price, article, links, …); the engine does not read them. */
  meta: z.record(z.string(), z.unknown()).default({}),
  content: LibraryFragmentSchema,
});
export type Pack = z.infer<typeof PackSchema>;

/** The pack every build needs: the factory option defaults name its items. It cannot be switched off. */
export const CORE_PACK_ID = "core";

/** All packs as one fragment; a later pack replaces items with the same id. */
export function mergePacks(packs: readonly Pack[]): LibraryFragment {
  const out = LibraryFragmentSchema.parse({});
  for (const kind of LIBRARY_KINDS) {
    const byId = new Map<string, { id: string }>();
    for (const p of packs) for (const item of p.content[kind] as { id: string }[]) byId.set(item.id, item);
    (out[kind] as { id: string }[]) = [...byId.values()];
  }
  return out;
}

export interface PackItemRef {
  pack: string;
  kind: LibraryKind;
  id: string;
}

export interface PackSelection {
  /** The packs to build with: switched-on packs whole, switched-off packs reduced to their items still in use. */
  packs: Pack[];
  /** Pack ids that are off. */
  off: string[];
  /** Packs asked to be off that stay on: the core pack and packs a switched-on pack requires (pack id → who needs it). */
  needed: Record<string, string[]>;
  /** Items of switched-off packs that stay resolvable because a document refers to them. */
  kept: PackItemRef[];
}

/** Every string value in a document, at any depth. */
function strings(x: unknown, into: Set<string>): void {
  if (typeof x === "string") into.add(x);
  else if (Array.isArray(x)) x.forEach((v) => strings(v, into));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => strings(v, into));
}

/**
 * Applies the user's choice of packs (D61). A switched-off pack leaves the
 * library, but nothing in use breaks: items the given documents (project,
 * shop) name stay, with what those items name in turn (a preset's slide).
 * Naming is by id among all string values, so too much is kept rather than
 * too little.
 */
export function selectPacks(packs: readonly Pack[], disabled: Iterable<string>, docs: readonly unknown[]): PackSelection {
  const asked = new Set(disabled);
  const want = new Set(asked);
  const needed: Record<string, string[]> = {};
  if (want.delete(CORE_PACK_ID)) needed[CORE_PACK_ID] = [];
  // A pack that is on keeps the packs it requires on.
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of packs) {
      if (want.has(p.id)) continue;
      for (const r of p.requires) {
        if (!asked.has(r)) continue;
        const who = (needed[r] ??= []);
        if (!who.includes(p.id)) who.push(p.id);
        if (want.delete(r)) changed = true;
      }
    }
  }
  const used = new Set<string>();
  docs.forEach((d) => strings(d, used));
  const kept: PackItemRef[] = [];
  const reduced = new Map<string, LibraryFragment>();
  for (const p of packs) if (want.has(p.id)) reduced.set(p.id, LibraryFragmentSchema.parse({}));
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of packs) {
      const into = reduced.get(p.id);
      if (!into) continue;
      for (const kind of LIBRARY_KINDS) {
        for (const item of p.content[kind] as { id: string }[]) {
          if (!used.has(item.id) || (into[kind] as { id: string }[]).includes(item)) continue;
          (into[kind] as { id: string }[]).push(item);
          kept.push({ pack: p.id, kind, id: item.id });
          const before = used.size;
          strings(item, used);
          if (used.size > before) changed = true;
        }
      }
    }
  }
  return {
    packs: packs.map((p) => (reduced.has(p.id) ? { ...p, content: reduced.get(p.id)! } : p)),
    off: packs.filter((p) => want.has(p.id)).map((p) => p.id),
    needed,
    kept,
  };
}

/** Option keys that name a library item → the library kind. */
const REF_OPTIONS = new Map<string, LibraryKind>();
for (const o of OPTIONS) {
  const kind = ({ hardware: "hardware", material: "materials", edgeband: "edgebands", surface: "surfaces" } as const)[o.kind.type as "hardware"];
  if (kind) REF_OPTIONS.set(o.key, kind);
}

/**
 * Checks a set of packs as a whole: unique pack ids, required packs present,
 * and every library id the factory option defaults, the presets and the
 * templates name is an item of the set (and, for a pack's own items, of the
 * pack or the packs it requires). Returns findings as text, for tests and the CLI.
 */
export function checkPacks(packs: readonly Pack[]): string[] {
  const out: string[] = [];
  const byId = new Map(packs.map((p) => [p.id, p]));
  if (byId.size !== packs.length) out.push("duplicate pack id");
  const has = (scope: readonly Pack[], kind: LibraryKind, id: string): boolean => scope.some((p) => (p.content[kind] as { id: string }[]).some((x) => x.id === id));
  const core = packs.filter((p) => p.id === CORE_PACK_ID);
  for (const o of OPTIONS) {
    const kind = REF_OPTIONS.get(o.key);
    if (kind && typeof o.factory === "string" && !has(core, kind, o.factory)) out.push(`option ${o.key}: factory default "${o.factory}" is not in the ${CORE_PACK_ID} pack`);
  }
  for (const p of packs) {
    for (const r of p.requires) if (!byId.has(r)) out.push(`${p.id}: requires unknown pack "${r}"`);
    const scope = [p, ...p.requires.flatMap((r) => byId.get(r) ?? [])];
    const options = (where: string, o: Record<string, unknown>): void => {
      for (const [k, v] of Object.entries(o)) {
        const kind = REF_OPTIONS.get(k);
        if (kind && typeof v === "string" && !has(scope, kind, v)) out.push(`${p.id}: ${where} sets ${k} to "${v}", which is not in the pack or the packs it requires`);
      }
    };
    for (const kind of LIBRARY_KINDS) {
      const ids = (p.content[kind] as { id: string }[]).map((x) => x.id);
      if (new Set(ids).size !== ids.length) out.push(`${p.id}: duplicate id in ${kind}`);
    }
    for (const preset of p.content.presets) options(`preset ${preset.id}`, preset.options);
    for (const t of p.content.templates) {
      options(`template ${t.id}`, t.cabinet.options);
      for (const id of t.cabinet.presets) if (!has(scope, "presets", id)) out.push(`${p.id}: template ${t.id} uses preset "${id}", which is not in the pack or the packs it requires`);
      for (const h of t.cabinet.construction?.hardware ?? []) if (!has(scope, "hardware", h.item)) out.push(`${p.id}: template ${t.id} lists hardware "${h.item}"`);
      for (const f of t.cabinet.construction?.fittings ?? []) if (!has(scope, "hardware", f.item)) out.push(`${p.id}: template ${t.id} places fitting "${f.item}"`);
    }
  }
  return out;
}

/**
 * A pack as the body of the server's publish request (D49): the server
 * keeps name and description in one language, the rest maps one to one.
 * Fields the server does not know (`author`, `kind`, `requires`, `meta`)
 * stay in the pack file.
 */
export function packPublishBody(pack: Pack, language = "en"): { name: string; description: string; tags: string[]; licence: string; language: string; version: string; content: LibraryFragment } {
  return {
    name: localName(pack.name, language),
    description: localName(pack.description, language),
    tags: pack.tags,
    licence: pack.licence,
    language,
    version: pack.version,
    content: pack.content,
  };
}
