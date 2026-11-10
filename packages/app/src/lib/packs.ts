/**
 * Community packs and the shop library: what a pack contains, what an
 * install would change, installing and removing. Pure functions on the raw
 * shop document (no app state), so they can be tested without a browser.
 */
import { LIBRARY_KINDS, LibraryFragmentSchema, localName, OPTIONS, type LibraryKind } from "@cabinet-planner/engine";

type Doc = Record<string, any>;
export type Trust = "community" | "tested" | "verified";

export { LIBRARY_KINDS, type LibraryKind };

export interface ItemRef {
  kind: LibraryKind;
  id: string;
  name: string;
}

const key = (kind: string, id: string): string => `${kind}/${id}`;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") {
    return `{${Object.keys(x as Doc)
      .sort()
      .filter((k) => (x as Doc)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((x as Doc)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}

/** Short hash of a string (FNV-1a, two passes); not for security. */
export function hashText(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x811c9dc5) + a;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/**
 * Fingerprint of a library item as the engine reads it (defaults filled
 * in), so a hand-written item and its copy from a pack compare equal.
 */
export function fingerprint(kind: LibraryKind, item: unknown): string {
  const r = LibraryFragmentSchema.safeParse({ [kind]: [item] });
  return hashText(stable(r.success ? r.data[kind][0] : item));
}

/** All items of a library fragment with their display names. */
export function listItems(content: Doc | undefined, lang: string): ItemRef[] {
  return LIBRARY_KINDS.flatMap((kind) =>
    ((content?.[kind] ?? []) as Doc[]).map((x) => ({ kind, id: String(x.id), name: x.name === undefined ? String(x.id) : localName(x.name, lang) || String(x.id) })),
  );
}

/** A library fragment with the selected items (`kind/id` keys) of a library. */
export function pickContent(library: Doc | undefined, selected: Iterable<string>): Doc {
  const want = new Set(selected);
  const out: Doc = {};
  for (const kind of LIBRARY_KINDS) {
    const items = ((library?.[kind] ?? []) as Doc[]).filter((x) => want.has(key(kind, x.id)));
    if (items.length) out[kind] = clone(items);
  }
  return out;
}

/** Option keys that name a library item, per library kind. */
const REF_OPTIONS: Record<string, Set<string>> = {
  hardware: new Set(OPTIONS.filter((o) => o.kind.type === "hardware").map((o) => o.key)),
  materials: new Set(OPTIONS.filter((o) => o.kind.type === "material").map((o) => o.key)),
  edgebands: new Set(OPTIONS.filter((o) => o.kind.type === "edgeband").map((o) => o.key)),
};

/**
 * Gives pack items other ids (`kind/id` → new id) and follows the
 * references inside the pack: presets of a template, hardware, material and
 * edgeband options, part materials and edges, the parent of a drawing style.
 */
export function renameItems(content: Doc, renames: Record<string, string>): Doc {
  const out = clone(content);
  const to = (kind: string, id: unknown): any => (typeof id === "string" ? (renames[key(kind, id)] ?? id) : id);
  const options = (o: Doc | undefined): void => {
    for (const k of Object.keys(o ?? {})) {
      for (const kind of ["hardware", "materials", "edgebands"]) if (REF_OPTIONS[kind]!.has(k)) o![k] = to(kind, o![k]);
    }
  };
  const parts = (p: Doc | undefined): void => {
    for (const part of Object.values(p ?? {}) as Doc[]) {
      if (part.material !== undefined) part.material = to("materials", part.material);
      for (const e of Object.keys(part.edges ?? {})) part.edges[e] = to("edgebands", part.edges[e]);
    }
  };
  for (const kind of LIBRARY_KINDS) for (const item of (out[kind] ?? []) as Doc[]) item.id = to(kind, item.id);
  for (const p of (out.presets ?? []) as Doc[]) options(p.options);
  for (const t of (out.templates ?? []) as Doc[]) {
    if (Array.isArray(t.cabinet?.presets)) t.cabinet.presets = t.cabinet.presets.map((id: string) => to("presets", id));
    options(t.cabinet?.options);
    parts(t.cabinet?.parts);
  }
  for (const s of (out.drawingStyles ?? []) as Doc[]) if (s.extends !== undefined) s.extends = to("drawingStyles", s.extends);
  return out;
}

/** New ids for pack items that clash with own library items: `<id>-<suffix>`, unique in the library and the pack. */
export function renamesFor(shop: Doc, content: Doc, clashes: ItemRef[], suffix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of clashes) {
    const used = new Set([...((shop.library?.[c.kind] ?? []) as Doc[]), ...((content[c.kind] ?? []) as Doc[])].map((x) => x.id));
    let id = `${c.id}-${suffix}`;
    for (let n = 2; used.has(id); n++) id = `${c.id}-${suffix}${n}`;
    out[key(c.kind, c.id)] = id;
  }
  return out;
}

/**
 * Pack content as it goes into the library: hardware carries the pack's
 * trust level, whatever its author wrote into the item, and items the user
 * installed under another id before keep that id (`renames`).
 */
export function prepareContent(content: Doc, trust: Trust, renames: Record<string, string> = {}): Doc {
  const out = Object.keys(renames).length ? renameItems(content, renames) : clone(content);
  const level = trust === "verified" ? "verified" : trust === "tested" ? "tested" : "untested";
  for (const hw of (out.hardware ?? []) as Doc[]) hw.trust = level;
  return out;
}

export interface InstallPlan {
  /** Not in the library yet. */
  added: ItemRef[];
  /** In the library from an earlier install and not changed since: replaced without asking. */
  updated: ItemRef[];
  /** In the library with other content (own items, or changed after install): ask before replacing. */
  conflicts: ItemRef[];
  /** Already identical. */
  unchanged: ItemRef[];
}

/** What installing `content` (already prepared) would do to the shop library. */
export function planInstall(shop: Doc, content: Doc, lang: string): InstallPlan {
  const plan: InstallPlan = { added: [], updated: [], conflicts: [], unchanged: [] };
  const known = new Map<string, string>();
  for (const p of (shop.installedPacks ?? []) as Doc[]) for (const [k, h] of Object.entries((p.hashes ?? {}) as Record<string, string>)) known.set(k, h);
  for (const ref of listItems(content, lang)) {
    const mine = ((shop.library?.[ref.kind] ?? []) as Doc[]).find((x) => x.id === ref.id);
    const theirs = (content[ref.kind] as Doc[]).find((x) => x.id === ref.id);
    if (!mine) plan.added.push(ref);
    else {
      const have = fingerprint(ref.kind, mine);
      if (have === fingerprint(ref.kind, theirs)) plan.unchanged.push(ref);
      else if (known.get(key(ref.kind, ref.id)) === have) plan.updated.push(ref);
      else plan.conflicts.push(ref);
    }
  }
  return plan;
}

export interface PackInfo {
  id: string;
  version: string;
  name: string;
  trust: Trust;
}

/**
 * Merges prepared pack content into the shop library (same id: replaced)
 * and records the install. Items in `keepMine` (`kind/id`) stay as they are.
 */
export function applyInstall(shop: Doc, pack: PackInfo, content: Doc, keepMine: Iterable<string> = [], renames: Record<string, string> = {}): void {
  const skip = new Set(keepMine);
  shop.library ??= {};
  const items: Record<string, string[]> = {};
  const hashes: Record<string, string> = {};
  for (const kind of LIBRARY_KINDS) {
    for (const item of (content[kind] ?? []) as Doc[]) {
      const k = key(kind, item.id);
      if (skip.has(k)) continue;
      shop.library[kind] ??= [];
      const list = shop.library[kind] as Doc[];
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = clone(item);
      else list.push(clone(item));
      (items[kind] ??= []).push(item.id);
      hashes[k] = fingerprint(kind, item);
    }
  }
  const before = ((shop.installedPacks ?? []) as Doc[]).find((p) => p.id === pack.id);
  const entry = {
    ...pack,
    items,
    hashes,
    ...(Object.keys(renames).length ? { renames } : {}),
    ...(before?.cncConfirmed && before.version === pack.version ? { cncConfirmed: true } : {}),
  };
  shop.installedPacks = [...((shop.installedPacks ?? []) as Doc[]).filter((p) => p.id !== pack.id), entry];
}

/** Removes an installed pack: its items leave the library unless they were changed since. Returns the ids kept. */
export function uninstall(shop: Doc, packId: string): string[] {
  const entry = ((shop.installedPacks ?? []) as Doc[]).find((p) => p.id === packId);
  if (!entry) return [];
  const kept: string[] = [];
  for (const kind of LIBRARY_KINDS) {
    const ids = new Set<string>(entry.items?.[kind] ?? []);
    if (!ids.size || !shop.library?.[kind]) continue;
    shop.library[kind] = (shop.library[kind] as Doc[]).filter((x) => {
      if (!ids.has(x.id)) return true;
      const changed = entry.hashes?.[key(kind, x.id)] !== fingerprint(kind, x);
      if (changed) kept.push(x.id);
      return changed;
    });
  }
  shop.installedPacks = (shop.installedPacks as Doc[]).filter((p) => p.id !== packId);
  return kept;
}

export const installedPack = (shop: Doc, packId: string): Doc | undefined => ((shop.installedPacks ?? []) as Doc[]).find((p) => p.id === packId);

/**
 * Hardware from community packs nobody has tested, among the given item
 * ids: the first CNC export using it asks for a confirmation (PLAN.md).
 */
export function untestedPackHardware(shop: Doc, used: Iterable<string>): { id: string; pack: string }[] {
  const ids = new Set(used);
  const out: { id: string; pack: string }[] = [];
  for (const p of (shop.installedPacks ?? []) as Doc[]) {
    if (p.trust !== "community" || p.cncConfirmed) continue;
    for (const id of (p.items?.hardware ?? []) as string[]) {
      const item = ((shop.library?.hardware ?? []) as Doc[]).find((x) => x.id === id);
      if (ids.has(id) && item && (item.trust ?? "untested") === "untested") out.push({ id, pack: p.name || p.id });
    }
  }
  return out;
}

/** Remembers that the user confirmed a CNC export with untested data of these packs. */
export function confirmCnc(shop: Doc, used: Iterable<string>): void {
  const ids = new Set(used);
  for (const p of (shop.installedPacks ?? []) as Doc[]) {
    if (((p.items?.hardware ?? []) as string[]).some((id) => ids.has(id))) p.cncConfirmed = true;
  }
}

/** "1.2.3" → "1.2.4"; "1.0" → "1.1". */
export function nextVersion(v: string): string {
  const parts = v.split("-")[0]!.split(".");
  const last = Number(parts[parts.length - 1]);
  if (!Number.isFinite(last)) return "1.0.0";
  parts[parts.length - 1] = String(last + 1);
  return parts.join(".");
}
