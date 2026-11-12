import type { Diagnostic } from "./diagnostics.ts";
import { ExprError, evaluate, freeVariables, parse, type Expr } from "./expr/index.ts";

/** A variable is either a fixed number or an expression over other variables. */
export type VarInput = number | string;

export interface GraphResult {
  /** Values of every variable that could be computed. */
  values: Map<string, number>;
  /** Variables in the order they were evaluated (dependencies first). */
  order: string[];
  diagnostics: Diagnostic[];
}

interface Node {
  name: string;
  expr: Expr | null; // null for plain numbers or unparsable input
  constant?: number;
  deps: string[];
}

/**
 * Evaluates a set of variable definitions in dependency order.
 *
 * - `constants` are read-only inputs (e.g. material thicknesses) that
 *   expressions may reference but definitions may not shadow.
 * - Cycles are reported with their full path, never silently broken; every
 *   variable on or downstream of a cycle stays unresolved.
 * - A failing variable does not stop the others: everything that does not
 *   depend on it is still computed, so the UI can show as much as possible.
 */
export function evaluateGraph(
  defs: ReadonlyMap<string, VarInput>,
  constants: ReadonlyMap<string, number> = new Map(),
): GraphResult {
  const diagnostics: Diagnostic[] = [];
  const nodes = new Map<string, Node>();

  for (const [name, input] of defs) {
    if (constants.has(name)) {
      diagnostics.push({ severity: "error", code: "var_shadows_constant", params: { name }, variable: name });
      continue;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        diagnostics.push({ severity: "error", code: "var_not_finite", params: { name }, variable: name });
        nodes.set(name, { name, expr: null, deps: [] });
      } else {
        nodes.set(name, { name, expr: null, constant: input, deps: [] });
      }
      continue;
    }
    try {
      const expr = parse(input);
      nodes.set(name, { name, expr, deps: freeVariables(expr) });
    } catch (e) {
      diagnostics.push(exprDiagnostic(name, input, e));
      nodes.set(name, { name, expr: null, deps: [] });
    }
  }

  // Unknown references.
  for (const node of nodes.values()) {
    for (const dep of node.deps) {
      if (!nodes.has(dep) && !constants.has(dep)) {
        diagnostics.push({
          severity: "error",
          code: "var_unknown_reference",
          params: { name: node.name, ref: dep },
          variable: node.name,
        });
      }
    }
  }

  // Depth-first topological sort with cycle detection. Names are visited in
  // sorted order so the result is deterministic regardless of input order.
  const state = new Map<string, "visiting" | "done">();
  const order: string[] = [];
  const inCycle = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "visiting") {
      const cycle = stack.slice(stack.indexOf(name));
      if (!cycle.some((n) => inCycle.has(n))) {
        diagnostics.push({
          severity: "error",
          code: "var_cycle",
          params: { name, path: [...cycle, name].join(" → ") },
          variable: name,
        });
      }
      cycle.forEach((n) => inCycle.add(n));
      return;
    }
    state.set(name, "visiting");
    stack.push(name);
    for (const dep of nodes.get(name)!.deps) {
      if (nodes.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(name, "done");
    order.push(name);
  };
  [...nodes.keys()].sort().forEach(visit);

  // Evaluate in order; skip anything that depends on a failed variable.
  const values = new Map<string, number>();
  const lookup = (n: string): number | undefined => values.get(n) ?? constants.get(n);
  for (const name of order) {
    const node = nodes.get(name)!;
    if (inCycle.has(name)) continue;
    if (node.constant !== undefined) {
      values.set(name, node.constant);
      continue;
    }
    if (node.expr === null) continue;
    if (node.deps.some((d) => lookup(d) === undefined)) continue; // upstream already reported
    try {
      values.set(name, evaluate(node.expr, lookup));
    } catch (e) {
      diagnostics.push(exprDiagnostic(name, defs.get(name) as string, e));
    }
  }

  return { values, order: order.filter((n) => values.has(n)), diagnostics };
}

function exprDiagnostic(name: string, src: string, e: unknown): Diagnostic {
  if (e instanceof ExprError) {
    return {
      severity: "error",
      code: `expr_${e.code}`,
      params: { name, expr: src, at: e.span.start, ...e.params },
      variable: name,
    };
  }
  // Thousands of nested brackets or terms exhaust the stack: user data, so a finding like any other.
  if (e instanceof RangeError) {
    return { severity: "error", code: "expr_too_complex", params: { name, expr: `${src.slice(0, 40)}…` }, variable: name };
  }
  throw e;
}
