import { FACTORY_PRESETS } from "@cabinet-planner/engine";
import { store } from "./store.svelte.ts";

/**
 * One value for several cabinets (D59): "for all …" on a value row, and the
 * rows of a multi-selection.
 */
type Doc = Record<string, any>;
export type Kind = "base" | "wall" | "tall";
export type ForAllScope = "project" | Kind | "shop";
export type ValueKind = "var" | "option";
export type Value = number | string | boolean | null;

const KIND_PRESET: Record<Kind, string> = { base: "base-unit", wall: "wall-unit", tall: "tall-unit" };
const field = (kind: ValueKind): "vars" | "options" => (kind === "var" ? "vars" : "options");
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const kindOf = (c: Doc): Kind => (c.kind ?? "base") as Kind;

/** What applies in a cabinet right now (the number or formula as entered, or the chosen option). */
function inEffect(id: string, kind: ValueKind, key: string): unknown {
  const r = store.result?.cabinets.find((c) => c.resolved.cabinet.id === id)?.resolved;
  return kind === "var" ? r?.vars.get(key)?.input : r?.options.get(key)?.value;
}

/** Cabinets of the project by kind, for the menu. */
export function kindCounts(): Record<Kind, number> {
  const n = { base: 0, wall: 0, tall: 0 };
  for (const c of (store.project.cabinets ?? []) as Doc[]) n[kindOf(c)]++;
  return n;
}

/**
 * The project's own version of a kind preset ("base-unit" …): it takes the
 * place of the shop or factory preset of that id (presets resolve by id, the
 * project's last), so every cabinet of the kind follows, new ones included.
 */
function projectKindPreset(kind: Kind): Doc {
  const id = KIND_PRESET[kind];
  store.project.library ??= {};
  store.project.library.presets ??= [];
  const list = store.project.library.presets as Doc[];
  let p = list.find((x) => x.id === id);
  if (!p) {
    const base = ((store.shop.library?.presets ?? []) as Doc[]).find((x) => x.id === id) ?? FACTORY_PRESETS.find((x) => x.id === id);
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
  /** Cabinets that keep an own value because something of their own (a preset, a template) would say otherwise. */
  kept: number;
}

/**
 * Writes a value where it applies to the whole scope and removes the own
 * values it makes redundant: the project layer for all cabinets, the
 * project's kind preset for one kind, the shop defaults as shop standard.
 * A cabinet that would still get something else from a preset of its own
 * keeps (or gets) the value as its own. One undo step (the shop standard is
 * not part of the project's history).
 */
export function applyForAll(kind: ValueKind, key: string, value: Value, scope: ForAllScope): ForAllResult {
  const f = field(kind);
  const all = (store.project.cabinets ?? []) as Doc[];
  // A change typed just before is its own step.
  store.record();

  if (scope === "shop") {
    store.shop.defaults ??= { presets: [], vars: {}, options: {} };
    (store.shop.defaults[f] ??= {})[key] = value;
    // Only what says the same again is redundant: other projects and cabinets may differ on purpose.
    let cleared = 0;
    if (same(store.project[f]?.[key], value)) delete store.project[f][key];
    for (const c of all) {
      if (c[f] && same(c[f][key], value)) {
        delete c[f][key];
        cleared++;
      }
    }
    const kept = fix(all.filter((c) => c.id === store.ui.selected), kind, key, value);
    return { scope, cabinets: all.length, cleared: Math.max(0, cleared - kept), kept };
  }

  const targets = scope === "project" ? all : all.filter((c) => kindOf(c) === scope);
  if (scope === "project") (store.project[f] ??= {})[key] = value;
  else if (targets.some((c) => (c.presets ?? []).includes(KIND_PRESET[scope]))) projectKindPreset(scope)[f][key] = value;
  let had = 0;
  for (const c of targets) {
    if (c[f]?.[key] !== undefined) {
      delete c[f][key];
      had++;
    }
  }
  const kept = fix(targets, kind, key, value);
  return { scope, cabinets: targets.length, cleared: Math.max(0, had - kept), kept };
}

/** Gives the value as an own value to every cabinet where something else still applies; returns how many. */
function fix(cabinets: Doc[], kind: ValueKind, key: string, value: Value): number {
  const f = field(kind);
  let n = 0;
  for (const c of cabinets) {
    if (same(inEffect(c.id, kind, key), value)) continue;
    (c[f] ??= {})[key] = value;
    n++;
  }
  return n;
}

/** The value in effect in each of the cabinets: the common one, or `mixed`. */
export function commonValue(ids: readonly string[], kind: ValueKind, key: string): { mixed: boolean; input: unknown; value: number | undefined; own: number } {
  const inputs = ids.map((id) => inEffect(id, kind, key));
  const docs = ((store.project.cabinets ?? []) as Doc[]).filter((c) => ids.includes(c.id));
  const values = ids.map((id) => store.result?.cabinets.find((c) => c.resolved.cabinet.id === id)?.resolved.vars.get(key)?.value);
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
export function setForCabinets(ids: readonly string[], kind: ValueKind, key: string, value: Value | undefined): void {
  const f = field(kind);
  for (const c of (store.project.cabinets ?? []) as Doc[]) {
    if (!ids.includes(c.id)) continue;
    if (value === undefined) {
      if (c[f]) delete c[f][key];
    } else (c[f] ??= {})[key] = value;
  }
}
