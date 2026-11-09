import type { BinaryOp, Expr, UnaryOp } from "./ast.ts";
import { ExprError } from "./errors.ts";
import { FUNCTIONS } from "./functions.ts";
import { tokenize, type Token } from "./lexer.ts";

/** Binding power of binary operators; higher binds tighter. */
const PRECEDENCE: Record<BinaryOp, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
};
const UNARY_POWER = 7;

const isBinaryOp = (s: string): s is BinaryOp => Object.hasOwn(PRECEDENCE, s);

/**
 * Parses an expression into an AST. Grammar: numbers, variables, + - * /,
 * comparisons, && || !, parentheses and calls to the whitelisted functions in
 * `functions.ts`. There is no member access, no assignment and no string
 * type, so an expression can only ever compute a number.
 */
export function parse(src: string): Expr {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (): Token => tokens[pos]!;
  const next = (): Token => tokens[pos++]!;

  const unexpected = (t: Token): ExprError =>
    t.kind === "eof"
      ? new ExprError("unexpected_end", t.span)
      : new ExprError("unexpected_token", t.span, { token: t.text });

  const parseExpr = (minPower: number): Expr => {
    let left = parsePrefix();
    for (;;) {
      const t = peek();
      if (t.kind !== "op" || !isBinaryOp(t.text)) break;
      const power = PRECEDENCE[t.text];
      if (power <= minPower) break;
      next();
      const right = parseExpr(power);
      left = {
        kind: "binary",
        op: t.text,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  };

  const parsePrefix = (): Expr => {
    const t = next();
    switch (t.kind) {
      case "num": {
        const value = Number(t.text);
        if (!Number.isFinite(value)) throw new ExprError("invalid_number", t.span, { text: t.text });
        return { kind: "num", value, span: t.span };
      }
      case "ident": {
        if (peek().kind === "lparen") return parseCall(t);
        return { kind: "var", name: t.text, span: t.span };
      }
      case "lparen": {
        const inner = parseExpr(0);
        const close = next();
        if (close.kind !== "rparen") throw unexpected(close);
        return { ...inner, span: { start: t.span.start, end: close.span.end } };
      }
      case "op": {
        if (t.text === "-" || t.text === "+" || t.text === "!") {
          const arg = parseExpr(UNARY_POWER);
          return { kind: "unary", op: t.text as UnaryOp, arg, span: { start: t.span.start, end: arg.span.end } };
        }
        throw unexpected(t);
      }
      default:
        throw unexpected(t);
    }
  };

  const parseCall = (name: Token): Expr => {
    const fn = FUNCTIONS[name.text];
    if (fn === undefined || !Object.hasOwn(FUNCTIONS, name.text)) {
      throw new ExprError("unknown_function", name.span, { fn: name.text });
    }
    next(); // (
    const args: Expr[] = [];
    if (peek().kind !== "rparen") {
      for (;;) {
        args.push(parseExpr(0));
        const sep = peek();
        if (sep.kind === "comma") {
          next();
          continue;
        }
        break;
      }
    }
    const close = next();
    if (close.kind !== "rparen") throw unexpected(close);
    const span = { start: name.span.start, end: close.span.end };
    if (args.length < fn.minArgs || args.length > fn.maxArgs) {
      throw new ExprError("wrong_arg_count", span, {
        fn: name.text,
        expected: fn.minArgs === fn.maxArgs ? String(fn.minArgs) : `${fn.minArgs}–${fn.maxArgs === Infinity ? "n" : fn.maxArgs}`,
        got: args.length,
      });
    }
    return { kind: "call", fn: name.text, args, span };
  };

  if (peek().kind === "eof") throw new ExprError("empty", { start: 0, end: src.length });
  const expr = parseExpr(0);
  const rest = peek();
  if (rest.kind !== "eof") throw unexpected(rest);
  return expr;
}
