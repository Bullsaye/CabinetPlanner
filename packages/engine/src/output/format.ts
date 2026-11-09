/**
 * Number formatting for machine-readable outputs: always a dot as decimal
 * separator, at most `decimals` places, trailing zeros removed, no -0.
 * Locale-specific formatting is the UI's job, never the writers'.
 */
export function formatNumber(x: number, decimals = 2): string {
  const s = x.toFixed(decimals);
  const trimmed = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return trimmed === "-0" ? "0" : trimmed;
}

/** Quotes a CSV field when needed (RFC 4180). */
export function csvField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: readonly (readonly string[])[], delimiter = ","): string {
  return rows.map((r) => r.map((f) => csvField(f, delimiter)).join(delimiter)).join("\n") + "\n";
}
