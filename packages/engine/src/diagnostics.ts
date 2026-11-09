/**
 * A finding about a project: an error blocks production output, a warning
 * does not. `code` doubles as the i18n message key (`diag.<code>`) and
 * `params` fills its placeholders, so the engine never produces UI text.
 */
export interface Diagnostic {
  severity: "error" | "warning";
  code: string;
  params: Record<string, string | number>;
  /** Where the finding applies, e.g. cabinet id, variable or part id. */
  cabinet?: string;
  variable?: string;
  part?: string;
}

export const hasErrors = (diags: readonly Diagnostic[]): boolean => diags.some((d) => d.severity === "error");
