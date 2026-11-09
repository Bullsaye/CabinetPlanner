/**
 * Whitelisted functions of the expression language. `if` is special-cased in
 * the evaluator so that only the chosen branch is evaluated.
 */
export interface FnDef {
  minArgs: number;
  maxArgs: number;
  /** Not used for `if`, which the evaluator handles lazily. */
  call: (args: number[]) => number;
}

/** Rounds `x` to the nearest multiple of `step` (step <= 0 returns x unchanged). */
export function roundTo(x: number, step: number): number {
  if (!(step > 0)) return x;
  return Math.round(x / step) * step;
}

export const FUNCTIONS: Readonly<Record<string, FnDef>> = Object.freeze({
  min: { minArgs: 1, maxArgs: Infinity, call: (a) => Math.min(...a) },
  max: { minArgs: 1, maxArgs: Infinity, call: (a) => Math.max(...a) },
  abs: { minArgs: 1, maxArgs: 1, call: ([x]) => Math.abs(x!) },
  round: { minArgs: 1, maxArgs: 1, call: ([x]) => Math.round(x!) },
  floor: { minArgs: 1, maxArgs: 1, call: ([x]) => Math.floor(x!) },
  ceil: { minArgs: 1, maxArgs: 1, call: ([x]) => Math.ceil(x!) },
  clamp: { minArgs: 3, maxArgs: 3, call: ([x, lo, hi]) => Math.min(Math.max(x!, lo!), hi!) },
  /** Round to the nearest multiple of a step, e.g. `roundTo(x, 32)` for the system grid. */
  roundTo: { minArgs: 2, maxArgs: 2, call: ([x, s]) => roundTo(x!, s!) },
  floorTo: { minArgs: 2, maxArgs: 2, call: ([x, s]) => (s! > 0 ? Math.floor(x! / s!) * s! : x!) },
  ceilTo: { minArgs: 2, maxArgs: 2, call: ([x, s]) => (s! > 0 ? Math.ceil(x! / s!) * s! : x!) },
  if: { minArgs: 3, maxArgs: 3, call: ([c, a, b]) => (c !== 0 ? a! : b!) },
});
