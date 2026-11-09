import { describe, expect, it } from "vitest";
import { evalExpression, ExprError, freeVariables, parse } from "../src/index.ts";

const ev = (src: string, vars: Record<string, number> = {}): number => evalExpression(src, vars);
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ExprError) return e.code;
    throw e;
  }
  throw new Error("expected an ExprError");
};

describe("expression language", () => {
  it("evaluates arithmetic with precedence and left associativity", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("10 - 4 - 3")).toBe(3);
    expect(ev("100 / 10 / 2")).toBe(5);
    expect(ev("-2 * 3")).toBe(-6);
    expect(ev("2 - -3")).toBe(5);
    expect(ev("+4")).toBe(4);
    expect(ev("1.5 + .5")).toBe(2);
    expect(ev("1e3")).toBe(1000);
  });

  it("reads variables", () => {
    expect(ev("H - plinth_h - 2*T", { H: 820, plinth_h: 100, T: 19 })).toBe(682);
    expect(ev("W - 2*T_side - 2*shelf_gap", { W: 600, T_side: 19, shelf_gap: 1 })).toBe(560);
  });

  it("accepts typographic operators from the keypad", () => {
    expect(ev("worktop_d − 40", { worktop_d: 600 })).toBe(560);
    expect(ev("3 × 4 ÷ 2")).toBe(6);
    expect(ev("2 ≤ 3")).toBe(1);
  });

  it("supports comparisons, logic and if()", () => {
    expect(ev("3 > 2")).toBe(1);
    expect(ev("3 < 2")).toBe(0);
    expect(ev("2 == 2 && 1 != 2")).toBe(1);
    expect(ev("0 || 0")).toBe(0);
    expect(ev("!0")).toBe(1);
    expect(ev("if(W > 600, 2, 1)", { W: 800 })).toBe(2);
    expect(ev("if(W > 600, 2, 1)", { W: 600 })).toBe(1);
  });

  it("evaluates if() lazily so the unused branch may fail", () => {
    expect(ev("if(1, 5, 1 / 0)")).toBe(5);
    expect(ev("0 && 1 / 0")).toBe(0);
  });

  it("has min, max, rounding and grid functions", () => {
    expect(ev("min(3, 1, 2)")).toBe(1);
    expect(ev("max(3, 1, 2)")).toBe(3);
    expect(ev("abs(-4)")).toBe(4);
    expect(ev("round(2.5)")).toBe(3);
    expect(ev("floor(2.7)")).toBe(2);
    expect(ev("ceil(2.1)")).toBe(3);
    expect(ev("clamp(150, 0, 100)")).toBe(100);
    expect(ev("roundTo(100, 32)")).toBe(96);
    expect(ev("floorTo(63, 32)")).toBe(32);
    expect(ev("ceilTo(33, 32)")).toBe(64);
  });

  it("lists free variables once, in order", () => {
    expect(freeVariables(parse("a + b * a - min(c, b)"))).toEqual(["a", "b", "c"]);
  });

  it("reports errors with codes and positions", () => {
    expect(code(() => ev(""))).toBe("empty");
    expect(code(() => ev("1 +"))).toBe("unexpected_end");
    expect(code(() => ev("1 2"))).toBe("unexpected_token");
    expect(code(() => ev("(1 + 2"))).toBe("unexpected_end");
    expect(code(() => ev("2 $ 3"))).toBe("unexpected_char");
    expect(code(() => ev("12abc"))).toBe("invalid_number");
    expect(code(() => ev("foo(1)"))).toBe("unknown_function");
    expect(code(() => ev("min()"))).toBe("wrong_arg_count");
    expect(code(() => ev("if(1, 2)"))).toBe("wrong_arg_count");
    expect(code(() => ev("x + 1"))).toBe("unknown_variable");
    expect(code(() => ev("1 / 0"))).toBe("division_by_zero");
    expect(code(() => ev("1e308 * 10"))).toBe("not_finite");

    try {
      parse("W + * 2");
    } catch (e) {
      expect((e as ExprError).span.start).toBe(4);
    }
  });

  it("cannot reach JavaScript internals", () => {
    expect(code(() => ev("constructor"))).toBe("unknown_variable");
    expect(code(() => ev("__proto__"))).toBe("unknown_variable");
    expect(code(() => ev("toString(1)"))).toBe("unknown_function");
    expect(code(() => ev("hasOwnProperty(1)"))).toBe("unknown_function");
    expect(code(() => ev("a.b", { a: 1 }))).toBe("unexpected_char");
  });

  it("never returns -0", () => {
    expect(Object.is(ev("-0"), 0)).toBe(true);
    expect(Object.is(ev("0 * -1"), 0)).toBe(true);
  });
});
