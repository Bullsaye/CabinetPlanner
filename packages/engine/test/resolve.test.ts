import { describe, expect, it } from "vitest";
import { buildProject, loadProject, loadShop } from "../src/index.ts";
import { buildOne } from "./helpers.ts";

describe("preset resolution", () => {
  it("uses factory values when nothing overrides them", () => {
    const r = buildOne();
    const vars = r.cabinets[0]!.resolved.vars;
    expect(vars.get("W")).toMatchObject({ value: 600, source: { layer: "factory" } });
    expect(vars.get("D")).toMatchObject({ value: 560, input: "worktop_d - 40" });
    expect(vars.get("t_carcase")).toMatchObject({ value: 19, input: "mat_carcase_t" });
  });

  it("applies factory → shop → project → cabinet, last wins, with sources", () => {
    const shop = loadShop({
      schemaVersion: 1,
      kind: "shop",
      library: {
        presets: [{ id: "deep", name: "Deep", vars: { worktop_d: 650 } }],
      },
      defaults: { presets: ["deep"], vars: { front_gap: 4 } },
    });
    const project = loadProject({
      schemaVersion: 1,
      name: "p",
      vars: { front_gap: 2.5, base_h: 760 },
      cabinets: [{ id: "C1", type: "box", vars: { front_gap: 2 } }],
    });
    const r = buildProject(project, shop);
    const vars = r.cabinets[0]!.resolved.vars;
    expect(vars.get("worktop_d")).toMatchObject({ value: 650, source: { layer: "shop", preset: "deep" } });
    expect(vars.get("D")).toMatchObject({ value: 610, source: { layer: "factory" } });
    expect(vars.get("H")).toMatchObject({ value: 760 });
    expect(vars.get("front_gap")).toMatchObject({
      value: 2,
      source: { layer: "cabinet" },
      inherited: { input: 2.5, source: { layer: "project" } },
    });
    // front_gap_side follows front_gap through its factory expression.
    expect(vars.get("front_gap_side")!.value).toBe(1);
  });

  it("applies presets in order before the layer's own values", () => {
    const r = buildOne(
      { presets: ["a", "b"], vars: { W: 900 } },
      {
        library: {
          presets: [
            { id: "a", name: "A", vars: { W: 700, shelf_count: 3 } },
            { id: "b", name: "B", vars: { W: 800 } },
          ],
        },
      },
    );
    const vars = r.cabinets[0]!.resolved.vars;
    expect(vars.get("W")).toMatchObject({ value: 900, source: { layer: "cabinet" } });
    expect(vars.get("shelf_count")).toMatchObject({ value: 3, source: { layer: "cabinet", preset: "a" } });
  });

  it("lets thickness follow the material", () => {
    const r = buildOne({ options: { "material.carcase": "custom-16" } }, {
      library: { materials: [{ id: "custom-16", name: "Custom 16", thickness: 16 }] },
    });
    expect(r.ok).toBe(true);
    expect(r.cabinets[0]!.resolved.values.get("t_carcase")).toBe(16);
  });

  it("allows user-defined variables in expressions", () => {
    const r = buildOne({ vars: { my_gap: 5, front_gap: "my_gap - 2" } });
    expect(r.ok).toBe(true);
    expect(r.cabinets[0]!.resolved.vars.get("front_gap")!.value).toBe(3);
    expect(r.cabinets[0]!.resolved.vars.get("my_gap")!.known).toBe(false);
  });

  it("reports bad option values, unknown presets and out-of-range values", () => {
    const r = buildOne({
      presets: ["missing"],
      vars: { W: 50, shelf_count: 1.5 },
      options: { top: "domed", "material.front": "unobtainium", nonsense: "x" },
    });
    const codes = r.diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual([
      "material_unknown",
      "option_invalid_value",
      "option_unknown",
      "preset_unknown",
      "var_below_min",
      "var_not_integer",
    ]);
    expect(r.ok).toBe(false);
    expect(r.parts).toEqual([]);
  });

  it("refuses to set material constants directly", () => {
    const r = buildOne({ vars: { mat_carcase_t: 18 } });
    expect(r.diagnostics.map((d) => d.code)).toContain("var_shadows_constant");
  });

  it("warns when a thickness differs from its material", () => {
    const r = buildOne({ vars: { t_carcase: 18 } });
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain("thickness_differs_from_material");
  });
});
