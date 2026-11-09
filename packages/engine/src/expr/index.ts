export { freeVariables, type Expr, type Span, type BinaryOp, type UnaryOp } from "./ast.ts";
export { ExprError, type ExprErrorCode } from "./errors.ts";
export { evaluate, scopeFrom, type Scope } from "./evaluate.ts";
export { FUNCTIONS, roundTo } from "./functions.ts";
export { parse } from "./parser.ts";
export { tokenize, type Token } from "./lexer.ts";

import { evaluate, scopeFrom } from "./evaluate.ts";
import { parse } from "./parser.ts";

/** Convenience: parse and evaluate in one step. */
export function evalExpression(
  src: string,
  vars: ReadonlyMap<string, number> | Readonly<Record<string, number>> = {},
): number {
  return evaluate(parse(src), scopeFrom(vars));
}
