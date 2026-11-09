import type { Diagnostic } from "../diagnostics.ts";
import { evaluateGraph } from "../graph.ts";
import type { DrillOp, HardwareItem } from "./schema.ts";

export interface EvaluatedDrill {
  mount: string;
  d: number;
  depth: number;
  a: number;
  b: number;
  through: boolean;
  op: "bore" | "groove";
  /** Grooves: length along the joint. */
  len: number;
}

/**
 * Evaluates an item's params with the cabinet values and placement context
 * as read-only inputs. Params may not reuse a cabinet variable's name.
 */
export function evaluateItemParams(
  item: HardwareItem,
  context: ReadonlyMap<string, number>,
  at: { cabinet: string },
): { values: Map<string, number>; diagnostics: Diagnostic[] } {
  const r = evaluateGraph(new Map(Object.entries(item.params)), context);
  const diagnostics = r.diagnostics.map((d) => ({
    ...d,
    code: d.code === "var_shadows_constant" ? "hardware_param_shadows" : d.code,
    params: { ...d.params, item: item.id },
    ...at,
  }));
  return { values: new Map([...context, ...r.values]), diagnostics };
}

/** Checks an item's limits for one placement; returns error diagnostics. */
export function checkLimits(
  item: HardwareItem,
  scope: ReadonlyMap<string, number>,
  at: { cabinet: string; part?: string },
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const lim of item.limits) {
    const defs = new Map<string, string | number>([["__v", lim.value]]);
    if (lim.min !== undefined) defs.set("__min", lim.min);
    if (lim.max !== undefined) defs.set("__max", lim.max);
    const r = evaluateGraph(defs, scope);
    const v = r.values.get("__v");
    if (r.diagnostics.length || v === undefined) {
      out.push({ severity: "error", code: "hardware_drill_invalid", params: { item: item.id, index: lim.name, field: "limit", detail: r.diagnostics[0]?.code ?? "" }, ...at });
      continue;
    }
    const min = r.values.get("__min");
    const max = r.values.get("__max");
    if ((min !== undefined && v < min - 1e-9) || (max !== undefined && v > max + 1e-9)) {
      out.push({
        severity: "error",
        code: "hardware_limit",
        params: { item: item.id, name: lim.name, value: Math.round(v * 100) / 100, min: min ?? "–", max: max ?? "–" },
        ...at,
      });
    }
  }
  return out;
}

/** Evaluates the drilling list of an item for one placement. */
export function evaluateDrilling(
  item: HardwareItem,
  scope: ReadonlyMap<string, number>,
  at: { cabinet: string },
): { drills: EvaluatedDrill[]; diagnostics: Diagnostic[] } {
  const drills: EvaluatedDrill[] = [];
  const diagnostics: Diagnostic[] = [];
  item.drilling.forEach((op: DrillOp, i) => {
    const defs = new Map<string, string | number>([
      ["__d", op.d],
      ["__depth", op.depth],
      ["__a", op.a],
      ["__b", op.b],
    ]);
    if (op.len !== undefined) defs.set("__len", op.len);
    const r = evaluateGraph(defs, scope);
    if (r.diagnostics.length > 0) {
      diagnostics.push(
        ...r.diagnostics.map((d) => ({
          ...d,
          code: "hardware_drill_invalid",
          params: { item: item.id, index: i + 1, field: String(d.params["name"]).slice(2), detail: d.code },
          ...at,
        })),
      );
      return;
    }
    drills.push({
      mount: op.mount,
      d: r.values.get("__d")!,
      depth: r.values.get("__depth")!,
      a: r.values.get("__a")!,
      b: r.values.get("__b")!,
      through: op.through ?? false,
      op: op.op ?? "bore",
      len: r.values.get("__len") ?? 0,
    });
  });
  return { drills, diagnostics };
}
