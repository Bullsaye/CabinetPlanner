import {
  MATERIAL_CONSTANTS,
  OPTION_BY_KEY,
  OPTIONS,
  VARIABLE_BY_NAME,
  VARIABLES,
  type OptionValue,
} from "./catalog.ts";
import type { Diagnostic } from "./diagnostics.ts";
import { evaluateGraph, type VarInput } from "./graph.ts";
import type { Library } from "./library.ts";
import { FACTORY_PRESETS } from "./presets.ts";
import type { CabinetInput, Layer, ParamInput, Preset, Project, Shop } from "./schema.ts";

/** Layers in resolution order; the last one that sets a value wins. */
export const LAYERS = ["factory", "shop", "project", "cabinet"] as const;
export type LayerName = (typeof LAYERS)[number];

/** Where a value came from: a layer, and optionally the preset within it. */
export interface Source {
  layer: LayerName;
  preset?: string;
  /** The default of a cabinet parameter (D45). */
  param?: boolean;
}

export interface ResolvedVar {
  name: string;
  input: VarInput;
  value: number | undefined;
  source: Source;
  /** Values this variable would have without the winning layer, for "reset to inherited". */
  inherited?: { input: VarInput; source: Source };
  /** False for user-defined variables that are not in the catalogue. */
  known: boolean;
}

export interface ResolvedOption {
  key: string;
  value: OptionValue;
  source: Source;
  inherited?: { value: OptionValue; source: Source };
}

export interface ResolvedCabinet {
  cabinet: CabinetInput;
  vars: Map<string, ResolvedVar>;
  options: Map<string, ResolvedOption>;
  /** Evaluated numbers by variable name, including material constants. */
  values: Map<string, number>;
  /** Parameters in effect (D45): from the presets of every layer, then the cabinet's own; later ones replace earlier ones by name. */
  params: ParamInput[];
  diagnostics: Diagnostic[];
}

export interface ResolveContext {
  library: Library;
  presets: ReadonlyMap<string, Preset>;
  shop: Layer | undefined;
  /** Read-only inputs from the room (D44), e.g. ceiling_h. */
  constants?: ReadonlyMap<string, number>;
}

/** Constants the room provides; expressions may use them, layers may not set them. */
export const ROOM_CONSTANTS = ["ceiling_h"] as const;

/** Builds the preset registry: shop presets, then project presets (later ids win). */
export function presetRegistry(shop: Shop | undefined, project: Project): Map<string, Preset> {
  const reg = new Map<string, Preset>();
  FACTORY_PRESETS.forEach((p) => reg.set(p.id, p));
  shop?.library.presets.forEach((p) => reg.set(p.id, p));
  project.library.presets.forEach((p) => reg.set(p.id, p));
  return reg;
}

interface Entry<T> {
  value: T;
  source: Source;
}

/**
 * Resolves all variables and options of one cabinet through the layers and
 * evaluates the variable graph. Never throws on bad user data: problems are
 * returned as diagnostics so the UI can show them next to the field.
 */
export function resolveCabinet(project: Project, cabinet: CabinetInput, ctx: ResolveContext): ResolvedCabinet {
  const diagnostics: Diagnostic[] = [];
  const at = { cabinet: cabinet.id };

  // Stack of entries per name; the last element is the winner.
  const varStack = new Map<string, Entry<VarInput>[]>();
  const optStack = new Map<string, Entry<OptionValue>[]>();
  const push = <T>(m: Map<string, Entry<T>[]>, k: string, e: Entry<T>): void => {
    const list = m.get(k);
    if (list) list.push(e);
    else m.set(k, [e]);
  };

  for (const d of VARIABLES) push(varStack, d.name, { value: d.factory, source: { layer: "factory" } });
  for (const o of OPTIONS) push(optStack, o.key, { value: o.factory, source: { layer: "factory" } });

  const applyValues = (
    vars: Record<string, VarInput>,
    options: Record<string, OptionValue>,
    source: Source,
  ): void => {
    for (const [k, val] of Object.entries(vars)) {
      if (Object.hasOwn(MATERIAL_CONSTANTS, k) || (ROOM_CONSTANTS as readonly string[]).includes(k)) {
        diagnostics.push({ severity: "error", code: "var_shadows_constant", params: { name: k }, variable: k, ...at });
        continue;
      }
      push(varStack, k, { value: val, source });
    }
    for (const [k, val] of Object.entries(options)) {
      if (!OPTION_BY_KEY.has(k)) {
        diagnostics.push({ severity: "error", code: "option_unknown", params: { key: k, layer: source.layer }, ...at });
        continue;
      }
      push(optStack, k, { value: val, source });
    }
  };

  // Parameters (D45): definitions by name; a default sits under the values of its layer.
  const params = new Map<string, ParamInput>();
  const applyParams = (list: readonly ParamInput[], source: Source): void => {
    for (const p of list) {
      if (Object.hasOwn(MATERIAL_CONSTANTS, p.name) || (ROOM_CONSTANTS as readonly string[]).includes(p.name)) {
        diagnostics.push({ severity: "error", code: "var_shadows_constant", params: { name: p.name }, variable: p.name, ...at });
        continue;
      }
      params.delete(p.name);
      params.set(p.name, p);
      if (p.default !== undefined) push(varStack, p.name, { value: p.default, source });
    }
  };

  const applyLayer = (layer: Layer | undefined, name: LayerName): void => {
    if (!layer) return;
    for (const id of layer.presets) {
      const preset = ctx.presets.get(id);
      if (!preset) {
        diagnostics.push({ severity: "error", code: "preset_unknown", params: { id, layer: name }, ...at });
        continue;
      }
      applyParams(preset.params ?? [], { layer: name, preset: id, param: true });
      applyValues(preset.vars, preset.options, { layer: name, preset: id });
    }
    applyValues(layer.vars, layer.options, { layer: name });
  };

  applyLayer(ctx.shop, "shop");
  applyLayer(project, "project");
  // The cabinet's own parameters, then its presets and its own values.
  applyParams(cabinet.params, { layer: "cabinet", param: true });
  applyLayer(cabinet, "cabinet");

  // Options: validate the winners.
  const options = new Map<string, ResolvedOption>();
  for (const [key, stack] of optStack) {
    const win = stack[stack.length - 1]!;
    const prev = stack[stack.length - 2];
    options.set(key, {
      key,
      value: win.value,
      source: win.source,
      ...(prev ? { inherited: { value: prev.value, source: prev.source } } : {}),
    });
    validateOption(key, win.value, ctx.library, diagnostics, at);
  }

  // Material constants.
  const constants = new Map<string, number>();
  for (const [name, optKey] of Object.entries(MATERIAL_CONSTANTS)) {
    const id = options.get(optKey)?.value;
    const mat = typeof id === "string" ? ctx.library.materials.get(id) : undefined;
    if (mat) constants.set(name, mat.thickness);
  }
  for (const [k, v] of ctx.constants ?? []) constants.set(k, v);

  // Variables.
  const defs = new Map<string, VarInput>();
  for (const [name, stack] of varStack) defs.set(name, stack[stack.length - 1]!.value);
  const graph = evaluateGraph(defs, constants);
  for (const d of graph.diagnostics) {
    // A missing material constant is already reported as material_unknown.
    if (d.code === "var_unknown_reference" && Object.hasOwn(MATERIAL_CONSTANTS, d.params["ref"] as string)) continue;
    diagnostics.push({ ...d, ...at });
  }

  const vars = new Map<string, ResolvedVar>();
  for (const [name, stack] of varStack) {
    const win = stack[stack.length - 1]!;
    const prev = stack[stack.length - 2];
    vars.set(name, {
      name,
      input: win.value,
      value: graph.values.get(name),
      source: win.source,
      ...(prev ? { inherited: { input: prev.value, source: prev.source } } : {}),
      known: VARIABLE_BY_NAME.has(name),
    });
  }

  // Range checks on catalogued variables.
  for (const def of VARIABLES) {
    const value = graph.values.get(def.name);
    if (value === undefined) continue;
    const base = { variable: def.name, ...at };
    if (def.integer && !Number.isInteger(value)) {
      diagnostics.push({ severity: "error", code: "var_not_integer", params: { name: def.name, value }, ...base });
    }
    if (def.min !== undefined && value < def.min) {
      diagnostics.push({ severity: "error", code: "var_below_min", params: { name: def.name, value, min: def.min }, ...base });
    }
    if (def.max !== undefined && value > def.max) {
      diagnostics.push({ severity: "error", code: "var_above_max", params: { name: def.name, value, max: def.max }, ...base });
    }
  }

  // Limits of the parameters (D45).
  for (const p of params.values()) {
    const value = graph.values.get(p.name);
    if (value === undefined) continue;
    const base = { variable: p.name, ...at };
    if (p.integer && !Number.isInteger(value)) diagnostics.push({ severity: "error", code: "var_not_integer", params: { name: p.name, value }, ...base });
    if (p.min !== undefined && value < p.min) diagnostics.push({ severity: "error", code: "var_below_min", params: { name: p.name, value, min: p.min }, ...base });
    if (p.max !== undefined && value > p.max) diagnostics.push({ severity: "error", code: "var_above_max", params: { name: p.name, value, max: p.max }, ...base });
  }

  // Thickness overridden away from the material: allowed, but worth a warning.
  const thicknessPairs: [string, keyof typeof MATERIAL_CONSTANTS][] = [
    ["t_carcase", "mat_carcase_t"],
    ["t_back", "mat_back_t"],
    ["t_shelf", "mat_shelf_t"],
    ["t_front", "mat_front_t"],
  ];
  for (const [tVar, cName] of thicknessPairs) {
    const t = graph.values.get(tVar);
    const m = constants.get(cName);
    if (t !== undefined && m !== undefined && t !== m) {
      diagnostics.push({
        severity: "warning",
        code: "thickness_differs_from_material",
        params: { name: tVar, value: t, material: m },
        variable: tVar,
        ...at,
      });
    }
  }

  const values = new Map<string, number>([...constants, ...graph.values]);
  return { cabinet, vars, options, values, params: [...params.values()], diagnostics };
}

function validateOption(
  key: string,
  value: OptionValue,
  library: Library,
  diagnostics: Diagnostic[],
  at: { cabinet: string },
): void {
  const def = OPTION_BY_KEY.get(key)!;
  const bad = (code: string, params: Record<string, string | number> = {}): void => {
    diagnostics.push({ severity: "error", code, params: { key, value: String(value), ...params }, ...at });
  };
  switch (def.kind.type) {
    case "enum":
      if (typeof value !== "string" || !def.kind.values.includes(value)) {
        bad("option_invalid_value", { allowed: def.kind.values.join(", ") });
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") bad("option_invalid_value", { allowed: "true, false" });
      return;
    case "material":
      if (typeof value !== "string" || !library.materials.has(value)) bad("material_unknown");
      return;
    case "hardware": {
      const item = typeof value === "string" ? library.hardware.get(value) : undefined;
      if (value === null && def.kind.nullable) return;
      if (!item) bad("hardware_unknown");
      else if (item.category !== def.kind.category) bad("hardware_wrong_category", { category: def.kind.category });
      return;
    }
    case "edgeband":
      if (value !== null && (typeof value !== "string" || !library.edgebands.has(value))) bad("edgeband_unknown");
      return;
    case "surface":
      if (value !== null && (typeof value !== "string" || !library.surfaces.has(value))) bad("surface_unknown");
      return;
  }
}
