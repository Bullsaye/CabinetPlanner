import type { Span } from "./ast.ts";
import { ExprError } from "./errors.ts";

export type TokenKind = "num" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
}

/**
 * Typographic operators accepted as aliases, so expressions typed on the
 * tablet keypad (− × ÷) or pasted from documents work unchanged.
 */
const ALIASES: Record<string, string> = {
  "−": "-", // − minus sign
  "–": "-", // – en dash
  "×": "*", // × multiplication sign
  "·": "*", // · middle dot
  "÷": "/", // ÷ division sign
  "≤": "<=", // ≤
  "≥": ">=", // ≥
  "≠": "!=", // ≠
};

const TWO_CHAR_OPS = new Set(["<=", ">=", "==", "!=", "&&", "||"]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "<", ">", "!"]);

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const start = i;

    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      while (i < src.length && isDigit(src[i]!)) i++;
      if (src[i] === ".") {
        i++;
        while (i < src.length && isDigit(src[i]!)) i++;
      }
      if (src[i] === "e" || src[i] === "E") {
        const save = i;
        i++;
        if (src[i] === "+" || src[i] === "-") i++;
        if (!isDigit(src[i] ?? "")) {
          i = save;
        } else {
          while (i < src.length && isDigit(src[i]!)) i++;
        }
      }
      const text = src.slice(start, i);
      if (isIdentStart(src[i] ?? "")) {
        throw new ExprError("invalid_number", { start, end: i + 1 }, { text: src.slice(start, i + 1) });
      }
      tokens.push({ kind: "num", text, span: { start, end: i } });
      continue;
    }

    if (isIdentStart(c)) {
      while (i < src.length && isIdentPart(src[i]!)) i++;
      tokens.push({ kind: "ident", text: src.slice(start, i), span: { start, end: i } });
      continue;
    }

    if (c === "(") {
      tokens.push({ kind: "lparen", text: c, span: { start, end: i + 1 } });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen", text: c, span: { start, end: i + 1 } });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ kind: "comma", text: c, span: { start, end: i + 1 } });
      i++;
      continue;
    }

    const alias = ALIASES[c];
    if (alias !== undefined) {
      tokens.push({ kind: "op", text: alias, span: { start, end: i + 1 } });
      i++;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: "op", text: two, span: { start, end: i + 2 } });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ kind: "op", text: c, span: { start, end: i + 1 } });
      i++;
      continue;
    }

    throw new ExprError("unexpected_char", { start, end: i + 1 }, { char: c });
  }
  tokens.push({ kind: "eof", text: "", span: { start: src.length, end: src.length } });
  return tokens;
}
