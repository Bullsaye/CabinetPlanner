import { describe, expect, it } from "vitest";
import { evaluateGraph, type VarInput } from "../src/index.ts";

const graph = (defs: Record<string, VarInput>, constants: Record<string, number> = {}) =>
  evaluateGraph(new Map(Object.entries(defs)), new Map(Object.entries(constants)));

describe("variable graph", () => {
  it("evaluates in dependency order regardless of definition order", () => {
    const r = graph({ side_h: "H - plinth_h", H: "base_h + 100", base_h: 720, plinth_h: 100 });
    expect(r.diagnostics).toEqual([]);
    expect(r.values.get("side_h")).toBe(720);
    expect(r.order.indexOf("base_h")).toBeLessThan(r.order.indexOf("H"));
    expect(r.order.indexOf("H")).toBeLessThan(r.order.indexOf("side_h"));
  });

  it("reads constants but refuses to redefine them", () => {
    const ok = graph({ t: "mat_t" }, { mat_t: 19 });
    expect(ok.values.get("t")).toBe(19);
    const bad = graph({ mat_t: 18 }, { mat_t: 19 });
    expect(bad.diagnostics.map((d) => d.code)).toEqual(["var_shadows_constant"]);
  });

  it("reports cycles with their path and keeps independent values", () => {
    const r = graph({ a: "b + 1", b: "c + 1", c: "a + 1", d: "a * 2", e: 5 });
    const cycles = r.diagnostics.filter((d) => d.code === "var_cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.params["path"]).toBe("a → b → c → a");
    expect(r.values.has("a")).toBe(false);
    expect(r.values.has("d")).toBe(false); // downstream of the cycle
    expect(r.values.get("e")).toBe(5);
  });

  it("reports self references as cycles", () => {
    const r = graph({ W: "W + 1" });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["var_cycle"]);
  });

  it("reports unknown references and parse errors per variable", () => {
    const r = graph({ a: "nope + 1", b: "1 +", c: 3, d: "c * 2" });
    const codes = r.diagnostics.map((d) => `${d.variable}:${d.code}`).sort();
    expect(codes).toEqual(["a:var_unknown_reference", "b:expr_unexpected_end"]);
    expect(r.values.get("d")).toBe(6);
  });

  it("reports evaluation errors with the variable name", () => {
    const r = graph({ zero: 0, x: "10 / zero" });
    expect(r.diagnostics).toMatchObject([{ code: "expr_division_by_zero", variable: "x", params: { name: "x" } }]);
  });

  it("is deterministic in its order", () => {
    const a = graph({ z: 1, y: "z", x: "y" }).order;
    const b = graph({ x: "y", y: "z", z: 1 }).order;
    expect(a).toEqual(b);
  });
});
