/** Source span of a node, as character offsets into the expression text. */
export interface Span {
  start: number;
  end: number;
}

export type BinaryOp = "+" | "-" | "*" | "/" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||";
export type UnaryOp = "-" | "+" | "!";

export type Expr =
  | { kind: "num"; value: number; span: Span }
  | { kind: "var"; name: string; span: Span }
  | { kind: "unary"; op: UnaryOp; arg: Expr; span: Span }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr; span: Span }
  | { kind: "call"; fn: string; args: Expr[]; span: Span };

/** Names of all variables an expression reads, in first-seen order, without duplicates. */
export function freeVariables(expr: Expr): string[] {
  const seen = new Set<string>();
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "num":
        return;
      case "var":
        seen.add(e.name);
        return;
      case "unary":
        walk(e.arg);
        return;
      case "binary":
        walk(e.left);
        walk(e.right);
        return;
      case "call":
        e.args.forEach(walk);
        return;
    }
  };
  walk(expr);
  return [...seen];
}
