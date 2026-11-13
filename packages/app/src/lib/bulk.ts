import { FACTORY_PRESETS, type ResolvedCabinet } from "@cabinet-planner/engine";

/**
 * One value for several cabinets (D73): "for all …" on a value row, and the
 * rows of a multi-selection. Pure document logic: the caller hands in the
 * project and shop documents and a way to see what applies in a cabinet
 * after a change (the app: its build; tests: the engine directly).
 */
type Doc = Record<string, any>;
export type Kind = "base" | "wall" | "tall";
export type ForAllScope = "project" | Kind | "shop";
export type ValueKind = "var" | "option";
export type Value = number | string | boolean | null;

export interface BulkContext {
  /** The project document (changed in place). */
  project: Doc;
  /** The shop document (changed in place). */
  shop: Doc;
  /** A cabinet as resolved from the documents as they are now. */
  resolved(id: string): ResolvedCabinet | undefined;
  /** Closes the undo step of a change typed just before (optional). */
  record?(): void;
}

export const KIND_PRESET: Readonly<Record<Kind, string>> = { base: "base-unit", wall: "wall-unit", tall: "tall-unit" };
const field = (kind: ValueKind): "vars" | "options" => (kind === "var" ? "vars" : "options");
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const kindOf = (c: Doc): Kind => (c.kind ?? "base") as Kind;
const cabinetsOf = (project: Doc): Doc[] => (project.cabinets ?? []) as Doc[];

/** What applies in a cabinet right now: the number or formula as entered, or the chosen option. */
function inEffect(ctx: BulkContext, id: string, kind: ValueKind, key: string): unknown {
  const r = ctx.resolved(id);
  return kind === "var" ? r?.vars.get(key)?.input : r?.options.get(key)?.value;
}

/** Cabinets of the project by kind, for the menu. */
export function kindCounts(project: Doc): Record<Kind, number> {
  const n = { base: 0, wall: 0, tall: 0 };
  for (const c of cabinetsOf(project)) n[kindOf(c)]++;
  return n;
}

/**
 * The project's own version of a kind preset ("base-unit" …): it takes the
 * place of the shop or factory preset of that id (presets resolve by id, the
 * project's last, D7), so every cabinet of the kind follows, new ones included.
 */
function projectKindPreset(ctx: BulkContext, kind: Kind): Doc {
  const id = KIND_PRESET[kind];
  ctx.project.library ??= {};
  ctx.project.library.presets ??= [];
  const list = ctx.project.library.presets as Doc[];
  let p = list.find((x) => x.id === id);
  if (!p) {
    const base = ((ctx.shop.library?.presets ?? []) as Doc[]).find((x) => x.id === id) ?? FACTORY_PRESETS.find((x) => x.id === id);
    const copy = JSON.parse(JSON.stringify(base ?? { id, name: id }));
    list.push({ group: "kind", vars: {}, options: {}, params: [], ...copy, id });
    p = list[list.length - 1]!;
  }
  p.vars ??= {};
  p.options ??= {};
  return p;
}

export interface ForAllResult {
  scope: ForAllScope;
  /** Cabinets the value now applies to. */
  cabinets: number;
  /** Cabinets whose own value was removed because it is no longer needed. */
  cleared: number;
  /** Cabinets that keep (or get) an own value because something of their own (a preset) would say otherwise. */
  kept: number;
}

/**
 * Writes a value where it applies to the whole scope and removes the own
 * values it makes redundant: the project layer for all cabinets, the
 * project's kind preset for one kind, the shop defaults as shop standard.
 * A cabinet that would still get something else (a preset of its own says
 * otherwise) keeps or gets the value as its own, and no cabinet that had the
 * value before loses it. One undo step (the shop document is not part of
 * the project's history).
 */
export function applyForAll(ctx: BulkContext, kind: ValueKind, key: string, value: Value, scope: ForAllScope): ForAllResult {
  const f = field(kind);
  const all = cabinetsOf(ctx.project);
  // A change typed just before is its own step.
  ctx.record?.();
  const hadIt = new Set(all.filter((c) => same(inEffect(ctx, c.id, kind, key), value)).map((c) => c.id as string));

  const targets = scope === "project" || scope === "shop" ? all : all.filter((c) => kindOf(c) === scope);
  const cleared = new Set<string>();
  const drop = (c: Doc): void => {
    if (c[f]?.[key] === undefined) return;
    delete c[f][key];
    cleared.add(c.id);
  };
  if (scope === "shop") {
    ctx.shop.defaults ??= { presets: [], vars: {}, options: {} };
    (ctx.shop.defaults[f] ??= {})[key] = value;
    // Only what says the same again is redundant: cabinets and the project may differ from the shop on purpose.
    if (ctx.project[f] && same(ctx.project[f][key], value)) delete ctx.project[f][key];
    for (const c of all) if (c[f] && same(c[f][key], value)) drop(c);
  } else {
    if (scope === "project") (ctx.project[f] ??= {})[key] = value;
    else if (targets.some((c) => (c.presets ?? []).includes(KIND_PRESET[scope]))) projectKindPreset(ctx, scope)[f][key] = value;
    for (const c of targets) drop(c);
  }

  // Where the value does not arrive (a preset of the cabinet's own wins), it stays the cabinet's own.
  // Shop scope: the cabinets that do not follow the shop keep what they had, unless they had the value.
  const mustHave = scope === "shop" ? all.filter((c) => hadIt.has(c.id)) : targets;
  const fix = mustHave.filter((c) => !same(inEffect(ctx, c.id, kind, key), value));
  for (const c of fix) (c[f] ??= {})[key] = value;
  const kept = fix.length;
  const reAdded = fix.filter((c) => cleared.has(c.id)).length;
  return { scope, cabinets: scope === "shop" ? all.length : targets.length, cleared: cleared.size - reAdded, kept };
}

export interface CommonValue {
  /** The cabinets differ. */
  mixed: boolean;
  /** The shared input (number, formula or option value); undefined when mixed. */
  input: unknown;
  /** Variables: the shared number. */
  value: number | undefined;
  /** How many of the cabinets have an own value. */
  own: number;
}

/** The value in effect in each of the cabinets: the common one, or `mixed`. */
export function commonValue(ctx: BulkContext, ids: readonly string[], kind: ValueKind, key: string): CommonValue {
  const inputs = ids.map((id) => inEffect(ctx, id, kind, key));
  const docs = cabinetsOf(ctx.project).filter((c) => ids.includes(c.id));
  const values = ids.map((id) => ctx.resolved(id)?.vars.get(key)?.value);
  const sameInput = inputs.every((x) => same(x, inputs[0]));
  // Variables are the same when they come to the same number, whatever formula gets there.
  const mixed = kind === "var" ? values.some((x) => x !== values[0]) : !sameInput;
  return {
    mixed,
    input: mixed ? undefined : sameInput ? inputs[0] : values[0],
    value: mixed || kind !== "var" ? undefined : values[0],
    own: docs.filter((c) => c[field(kind)]?.[key] !== undefined).length,
  };
}

/** Writes an own value to each of the cabinets; undefined removes it (back to what they inherit). */
export function setForCabinets(project: Doc, ids: readonly string[], kind: ValueKind, key: string, value: Value | undefined): void {
  const f = field(kind);
  for (const c of cabinetsOf(project)) {
    if (!ids.includes(c.id)) continue;
    if (value === undefined) {
      if (c[f]) delete c[f][key];
    } else (c[f] ??= {})[key] = value;
  }
}
