import type { Expr } from "./ast.ts";
import { ExprError } from "./errors.ts";
import { FUNCTIONS } from "./functions.ts";

/** Variable lookup. Return `undefined` for unknown names. */
export type Scope = (name: string) => number | undefined;

/** Builds a scope from a plain map without touching the prototype chain. */
export function scopeFrom(values: ReadonlyMap<string, number> | Readonly<Record<string, number>>): Scope {
  if (values instanceof Map) return (name) => values.get(name);
  const rec = values as Readonly<Record<string, number>>;
  return (name) => (Object.hasOwn(rec, name) ? rec[name] : undefined);
}

const bool = (b: boolean): number => (b ? 1 : 0);

/**
 * Evaluates an AST. Booleans are numbers: 0 is false, anything else true;
 * comparisons return 1 or 0. Any non-finite intermediate result is an error,
 * so NaN or Infinity can never reach a part size.
 */
export function evaluate(expr: Expr, scope: Scope): number {
  const ev = (e: Expr): number => {
    let result: number;
    switch (e.kind) {
      case "num":
        return e.value;
      case "var": {
        const v = scope(e.name);
        if (v === undefined) throw new ExprError("unknown_variable", e.span, { ref: e.name });
        return v;
      }
      case "unary": {
        const a = ev(e.arg);
        result = e.op === "-" ? -a : e.op === "+" ? a : bool(a === 0);
        break;
      }
      case "binary": {
        if (e.op === "&&") {
          result = ev(e.left) !== 0 ? bool(ev(e.right) !== 0) : 0;
          break;
        }
        if (e.op === "||") {
          result = ev(e.left) !== 0 ? 1 : bool(ev(e.right) !== 0);
          break;
        }
        const l = ev(e.left);
        const r = ev(e.right);
        switch (e.op) {
          case "+":
            result = l + r;
            break;
          case "-":
            result = l - r;
            break;
          case "*":
            result = l * r;
            break;
          case "/":
            if (r === 0) throw new ExprError("division_by_zero", e.span);
            result = l / r;
            break;
          case "<":
            result = bool(l < r);
            break;
          case "<=":
            result = bool(l <= r);
            break;
          case ">":
            result = bool(l > r);
            break;
          case ">=":
            result = bool(l >= r);
            break;
          case "==":
            result = bool(l === r);
            break;
          case "!=":
            result = bool(l !== r);
            break;
        }
        break;
      }
      case "call": {
        if (e.fn === "if") {
          const [c, a, b] = e.args;
          result = ev(c!) !== 0 ? ev(a!) : ev(b!);
          break;
        }
        const fn = FUNCTIONS[e.fn]!;
        result = fn.call(e.args.map(ev));
        break;
      }
    }
    if (!Number.isFinite(result)) throw new ExprError("not_finite", e.span);
    return result === 0 ? 0 : result; // normalise -0
  };
  return ev(expr);
}
