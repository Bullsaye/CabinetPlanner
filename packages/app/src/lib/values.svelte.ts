import {
  CabinetSchema,
  formatNumber,
  localName,
  MATERIAL_CONSTANTS,
  presetRegistry,
  resolveCabinet,
  VARIABLE_BY_NAME,
  type Diagnostic,
  type ResolvedCabinet,
  type Source,
} from "@cabinet-planner/engine";
import { diagnosticText } from "@cabinet-planner/i18n";
import { store, type Layer } from "./store.svelte.ts";

/**
 * What the value rows show (D70): the value that applies in a layer, where
 * it comes from, and the findings that belong to it.
 */

/** Values as the project or the shop sees them: resolved without a cabinet's own values. */
function probe(shopOnly: boolean): ResolvedCabinet | undefined {
  const r = store.result;
  if (!r) return undefined;
  try {
    const project = shopOnly ? { ...r.project, presets: [], vars: {}, options: {} } : r.project;
    return resolveCabinet(project, CabinetSchema.parse({ id: "ROOM", type: "box" }), {
      library: r.library,
      presets: presetRegistry(store.built.shop, r.project),
      shop: store.built.shop?.defaults ?? r.project.shop,
      constants: new Map([["ceiling_h", r.values.get("room_height") ?? 2500]]),
    });
  } catch {
    return undefined;
  }
}

class LayerViews {
  project = $derived(probe(false));
  shop = $derived(probe(true));
}
const views = new LayerViews();

/** The resolved values a layer's rows show: the selected cabinet, or the layer's defaults for any cabinet. */
export function layerView(layer: Layer): ResolvedCabinet | undefined {
  return layer === "cabinet" ? store.cabinet?.resolved : views[layer];
}

/** Findings about one variable in a layer, e.g. a formula that does not parse. */
export function varDiagnostics(layer: Layer, name: string): Diagnostic[] {
  const all = layer === "cabinet" ? (store.cabinet?.diagnostics ?? []) : (views[layer]?.diagnostics ?? []);
  return all.filter((d) => d.variable === name);
}

/** Text of a finding next to its field: without the leading variable name the row already shows. */
export function fieldDiagnosticText(d: Diagnostic, name: string): string {
  const text = diagnosticText(store.tr, d.code, d.params);
  return text.startsWith(`${name}: `) ? text.slice(name.length + 2) : text;
}

/** Label of a variable, parameter or constant for people; undefined when it only has its name. */
export function varLabel(name: string, layer: Layer = "cabinet"): string | undefined {
  const p = layerView(layer)?.params.find((x) => x.name === name);
  if (p?.label) return localName(p.label, store.ui.lang);
  if (VARIABLE_BY_NAME.has(name) && store.tr.has(`var.${name}`)) return store.tr.t(`var.${name}`);
  if (store.tr.has(`ui.const.${name}`)) return store.tr.t(`ui.const.${name}`);
  return undefined;
}

/** Names a formula may use, with labels: catalogue variables, parameters, own variables, constants. */
export function formulaNames(layer: Layer): { name: string; label: string }[] {
  const view = layerView(layer);
  const names = new Set<string>([...(view?.vars.keys() ?? VARIABLE_BY_NAME.keys()), ...Object.keys(MATERIAL_CONSTANTS), "ceiling_h"]);
  return [...names].map((name) => ({ name, label: varLabel(name, layer) ?? "" }));
}

/** Variables a formula reads, each with label and current value. */
export function formulaRefs(formula: string, layer: Layer): { name: string; label: string; value: string }[] {
  const view = layerView(layer);
  const seen = new Set<string>();
  const out: { name: string; label: string; value: string }[] = [];
  for (const m of formula.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const name = m[0];
    const value = view?.values.get(name);
    if (seen.has(name) || value === undefined) continue;
    seen.add(name);
    out.push({ name, label: varLabel(name, layer) ?? name, value: formatNumber(value) });
  }
  return out;
}

export interface Origin {
  /** Short label for the row, e.g. "Werk" or a preset name. */
  label: string;
  /** One sentence: where the value comes from. */
  text: string;
}

/** Where an inherited value comes from, for the quiet label of a row and its explanation. */
export function originOf(source: Source): Origin {
  const t = store.tr.t;
  if (source.param) {
    const fromTemplate = source.layer === "cabinet" && !source.preset && !!store.cabinetDoc?.template;
    return {
      label: source.preset ? store.presetName(source.preset) : t(fromTemplate ? "ui.origin.template" : "ui.origin.param"),
      text: source.preset ? t("ui.origin.text.param_preset", { name: store.presetName(source.preset) }) : t("ui.origin.text.param"),
    };
  }
  if (source.preset) {
    const name = store.presetName(source.preset);
    return { label: name, text: t(`ui.origin.text.preset.${source.layer}`, { name }) };
  }
  return { label: t(`layer.${source.layer}`), text: t(`ui.origin.text.${source.layer}`) };
}

/** 3D parts a setting is about, by role (highlighted while its row has focus). */
const SIDES = ["side_left", "side_right"];
const FRONTS = ["door", "drawer_front", "flap", "blind_panel", "appliance_front"];
const DRAWER = ["drawer_side_left", "drawer_side_right", "drawer_inner", "drawer_back", "drawer_bottom"];
const CARCASE = [...SIDES, "bottom", "top", "rail_front", "rail_rear", "rail_bottom", "partition", "fixed_shelf"];
const ROLES: Record<string, readonly string[]> = {
  t_carcase: CARCASE,
  "material.carcase": CARCASE,
  "edge.carcase": CARCASE,
  carcase_joint: [...SIDES, "bottom", "top"],
  "side.left": ["side_left"],
  "side.right": ["side_right"],
  top: ["top", "rail_front", "rail_rear"],
  "top.base_unit": ["top", "rail_front", "rail_rear"],
  "rail.front": ["rail_front"],
  "rail.rear": ["rail_rear"],
  rail_w: ["rail_front", "rail_rear"],
  "rail.bottom": ["rail_bottom"],
  rail_bottom_w: ["rail_bottom"],
  bottom_setback_rear: ["bottom"],
  bottom_setback_front: ["bottom"],
  back_mount: ["back"],
  back_extent: ["back"],
  "material.back": ["back"],
  t_back: ["back"],
  back_groove_offset: ["back"],
  back_groove_depth: ["back"],
  back_rebate_depth: ["back"],
  back_play: ["back"],
  shelf_count: ["shelf"],
  shelf_gap: ["shelf"],
  shelf_front_setback: ["shelf"],
  shelf_back_gap: ["shelf"],
  t_shelf: ["shelf"],
  "material.shelf": ["shelf"],
  "edge.shelf": ["shelf"],
  "hardware.shelf_support": ["shelf"],
  fixed_shelf_setback: ["fixed_shelf"],
  partition_count: ["partition"],
  partition_setback: ["partition"],
  t_front: FRONTS,
  "material.front": FRONTS,
  "edge.front": FRONTS,
  front_gap: FRONTS,
  front_gap_v: FRONTS,
  front_gap_top: FRONTS,
  front_gap_bottom: FRONTS,
  front_gap_left: FRONTS,
  front_gap_right: FRONTS,
  front_gap_middle: FRONTS,
  front_gap_side: FRONTS,
  "hardware.handle": FRONTS,
  "handle.door": ["door"],
  "handle.drawer": ["drawer_front"],
  handle_grip_h: ["door"],
  handle_edge_offset: ["door"],
  handle_end_offset: ["door"],
  handle_drawer_top: ["drawer_front"],
  "hardware.hinge": ["door"],
  door_hinge_side: ["door"],
  hinge_end_offset: ["door"],
  hinge_count: ["door"],
  "hardware.flap": ["flap"],
  "hardware.slide": [...DRAWER, "drawer_front"],
  "drawer_front.fixing": ["drawer_front"],
  "material.drawer": DRAWER,
  "material.drawer_bottom": ["drawer_bottom"],
  "edge.drawer": DRAWER,
  ceiling_filler: ["ceiling_filler"],
  ceiling_filler_gap: ["ceiling_filler"],
  joint_method: [...SIDES, "bottom", "top"],
  dowel_pattern: [...SIDES, "bottom", "top"],
  system_holes: SIDES,
};

/** Highlights the parts a setting is about in the 3D view (cabinet rows only). */
export function highlightFor(key: string | null): void {
  const roles = key === null ? undefined : ROLES[key];
  const ids = roles ? (store.cabinet?.parts ?? []).filter((p) => roles.includes(p.role)).map((p) => p.id) : [];
  if (ids.length || store.ui.highlight.length) store.ui.highlight = ids;
}

// A value written on blur may change the height of its row (formula line, finding). When the blur comes from
// a click elsewhere, the write waits until that click is through, so the clicked control does not move away.
let mouseDown = false;
let waiting: (() => void)[] = [];
function flush(): void {
  mouseDown = false;
  const run = waiting;
  waiting = [];
  for (const f of run) f();
}
if (typeof window !== "undefined") {
  window.addEventListener("mousedown", () => (mouseDown = true), true);
  window.addEventListener("mouseup", () => setTimeout(flush, 0), true);
}

/** Runs now, or right after the click in progress. */
export function afterClick(f: () => void): void {
  if (!mouseDown) return f();
  waiting.push(f);
  setTimeout(flush, 1500);
}
