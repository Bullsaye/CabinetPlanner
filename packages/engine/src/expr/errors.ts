import type { Span } from "./ast.ts";

/**
 * Error codes double as i18n message keys (`expr.<code>`), so the UI can show
 * them in any language. `params` fills the placeholders of that message.
 */
export type ExprErrorCode =
  | "unexpected_char"
  | "unexpected_token"
  | "unexpected_end"
  | "invalid_number"
  | "unknown_function"
  | "wrong_arg_count"
  | "unknown_variable"
  | "division_by_zero"
  | "not_finite"
  | "empty";

export class ExprError extends Error {
  readonly code: ExprErrorCode;
  readonly span: Span;
  readonly params: Record<string, string | number>;

  constructor(code: ExprErrorCode, span: Span, params: Record<string, string | number> = {}) {
    super(`${code} at ${span.start}${Object.keys(params).length ? " " + JSON.stringify(params) : ""}`);
    this.name = "ExprError";
    this.code = code;
    this.span = span;
    this.params = params;
  }
}
