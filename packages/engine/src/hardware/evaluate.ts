import type { Diagnostic } from "../diagnostics.ts";
import { evaluateGraph } from "../graph.ts";
import type { DrillOp, HardwareItem } from "./schema.ts";

export interface EvaluatedDrill {
  mount: string;
  d: number;
  depth: number;
  a: number;
  b: number;
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

/** Evaluates the drilling list of an item for one placement. */
export function evaluateDrilling(
  item: HardwareItem,
  scope: ReadonlyMap<string, number>,
  at: { cabinet: string },
): { drills: EvaluatedDrill[]; diagnostics: Diagnostic[] } {
  const drills: EvaluatedDrill[] = [];
  const diagnostics: Diagnostic[] = [];
  item.drilling.forEach((op: DrillOp, i) => {
    const defs = new Map([
      ["__d", op.d],
      ["__depth", op.depth],
      ["__a", op.a],
      ["__b", op.b],
    ] as const);
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
    });
  });
  return { drills, diagnostics };
}
