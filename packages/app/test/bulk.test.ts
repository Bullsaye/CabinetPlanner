import { buildProject, loadProject, loadShop, type ProjectResult } from "@cabinet-planner/engine";
import { describe, expect, it } from "vitest";
import { applyForAll, commonValue, kindCounts, setForCabinets, type BulkContext } from "../src/lib/bulk.ts";
import example from "../../../examples/kitchen-basic.project.json" with { type: "json" };
import shopDoc from "../../../examples/shop.json" with { type: "json" };

type Doc = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A context like the app's: the build follows the documents as they change. */
function ctxOf(project: Doc = clone(example), shop: Doc = clone(shopDoc)): BulkContext & { records: number } {
  let key = "";
  let result: ProjectResult | undefined;
  const ctx = {
    project,
    shop,
    records: 0,
    resolved(id: string) {
      const k = JSON.stringify([project, shop]);
      if (k !== key) {
        key = k;
        result = buildProject(loadProject(clone(project)), loadShop(clone(shop)));
      }
      return result!.cabinets.find((c) => c.resolved.cabinet.id === id)?.resolved;
    },
    record() {
      ctx.records++;
    },
  };
  return ctx;
}
const ids = (ctx: BulkContext): string[] => (ctx.project.cabinets as Doc[]).map((c) => c.id);
const value = (ctx: BulkContext, id: string, name: string): number | undefined => ctx.resolved(id)?.values.get(name);
const option = (ctx: BulkContext, id: string, key: string): unknown => ctx.resolved(id)?.options.get(key)?.value;
const cab = (ctx: BulkContext, id: string): Doc => (ctx.project.cabinets as Doc[]).find((c) => c.id === id)!;

describe("kindCounts", () => {
  it("counts the cabinets by kind", () => {
    expect(kindCounts(example)).toEqual({ base: 6, wall: 1, tall: 1 });
    expect(kindCounts({})).toEqual({ base: 0, wall: 0, tall: 0 });
  });
});

describe("applyForAll", () => {
  it("all cabinets: writes the project layer and removes the own values it makes redundant", () => {
    const ctx = ctxOf();
    cab(ctx, "B01").vars.front_gap = 2;
    const r = applyForAll(ctx, "var", "front_gap", 2, "project");
    expect(r).toEqual({ scope: "project", cabinets: 8, cleared: 1, kept: 0 });
    expect(ctx.project.vars.front_gap).toBe(2);
    expect(cab(ctx, "B01").vars.front_gap).toBeUndefined();
    for (const id of ids(ctx)) expect(value(ctx, id, "front_gap"), id).toBe(2);
    expect(ctx.records).toBe(1);
  });

  it("keeps the value as a cabinet's own where a preset of its own would win", () => {
    // shelf_count comes from the kind presets the cabinets list themselves (cabinet layer, D7).
    const ctx = ctxOf();
    const r = applyForAll(ctx, "var", "shelf_count", 0, "project");
    expect(r.cabinets).toBe(8);
    expect(r.cleared).toBe(0);
    expect(r.kept).toBeGreaterThan(0);
    for (const id of ids(ctx)) expect(value(ctx, id, "shelf_count"), id).toBe(0);
  });

  it("one kind: the project's own kind preset replaces the shop's or factory's, other kinds stay", () => {
    const ctx = ctxOf();
    const H = value(ctx, "B01", "H");
    const wallGap = value(ctx, "W01", "front_gap");
    cab(ctx, "B02").vars.front_gap = 2.5;
    const r = applyForAll(ctx, "var", "front_gap", 2.5, "base");
    expect(r).toEqual({ scope: "base", cabinets: 6, cleared: 1, kept: 0 });
    const preset = (ctx.project.library.presets as Doc[]).find((p) => p.id === "base-unit")!;
    expect(preset.vars.front_gap).toBe(2.5);
    // The copy carries the factory preset's values: the cabinets keep their size.
    expect(value(ctx, "B01", "H")).toBe(H);
    for (const id of ["B01", "B02", "B03", "B04", "B05", "B06"]) expect(value(ctx, id, "front_gap"), id).toBe(2.5);
    expect(value(ctx, "W01", "front_gap")).toBe(wallGap);
    expect(value(ctx, "T01", "front_gap")).toBe(wallGap);
    // A second value for the kind goes into the same preset.
    applyForAll(ctx, "option", "hardware.handle", "generic-knob", "base");
    expect((ctx.project.library.presets as Doc[]).filter((p) => p.id === "base-unit")).toHaveLength(1);
    expect(option(ctx, "B01", "hardware.handle")).toBe("generic-knob");
    expect(option(ctx, "W01", "hardware.handle")).toBe("generic-bar-160");
  });

  it("shop standard: writes the shop defaults, removes what says the same", () => {
    const ctx = ctxOf();
    cab(ctx, "B01").options = { "hardware.handle": "generic-knob" };
    const r = applyForAll(ctx, "option", "hardware.handle", "generic-knob", "shop");
    expect(r).toEqual({ scope: "shop", cabinets: 8, cleared: 1, kept: 0 });
    expect(ctx.shop.defaults.options["hardware.handle"]).toBe("generic-knob");
    expect(cab(ctx, "B01").options["hardware.handle"]).toBeUndefined();
    for (const id of ids(ctx)) expect(option(ctx, id, "hardware.handle"), id).toBe("generic-knob");
  });

  it("shop standard: a cabinet that had the value keeps it when the project says otherwise", () => {
    const ctx = ctxOf();
    ctx.project.vars.front_gap = 4;
    cab(ctx, "B01").vars.front_gap = 2;
    const r = applyForAll(ctx, "var", "front_gap", 2, "shop");
    expect(r).toMatchObject({ cleared: 0, kept: 1 });
    expect(ctx.shop.defaults.vars.front_gap).toBe(2);
    expect(value(ctx, "B01", "front_gap")).toBe(2);
    // The project's own value is left alone: it may differ from the shop on purpose.
    expect(value(ctx, "B02", "front_gap")).toBe(4);
  });
});

describe("multi-selection", () => {
  it("shows the common value or that the cabinets differ", () => {
    const ctx = ctxOf();
    expect(commonValue(ctx, ["B01", "B03"], "var", "W")).toMatchObject({ mixed: false, value: 600, own: 2 });
    expect(commonValue(ctx, ["B01", "B02"], "var", "W")).toMatchObject({ mixed: true, input: undefined, value: undefined });
    expect(commonValue(ctx, ["B01", "B02"], "option", "hardware.handle")).toMatchObject({ mixed: false, input: "generic-bar-160", own: 0 });
    expect(commonValue(ctx, ["B03", "B04"], "option", "worktop_cutout")).toMatchObject({ mixed: true, own: 2 });
  });

  it("writes an own value to each selected cabinet and removes it again", () => {
    const ctx = ctxOf();
    setForCabinets(ctx.project, ["B01", "B02"], "var", "D", 500);
    expect(value(ctx, "B01", "D")).toBe(500);
    expect(value(ctx, "B02", "D")).toBe(500);
    expect(value(ctx, "B03", "D")).not.toBe(500);
    expect(commonValue(ctx, ["B01", "B02"], "var", "D")).toMatchObject({ mixed: false, value: 500, own: 2 });
    setForCabinets(ctx.project, ["B01", "B02"], "option", "hardware.handle", "generic-knob");
    expect(option(ctx, "B02", "hardware.handle")).toBe("generic-knob");
    setForCabinets(ctx.project, ["B01", "B02"], "var", "D", undefined);
    expect(cab(ctx, "B01").vars.D).toBeUndefined();
    expect(value(ctx, "B01", "D")).toBe(value(ctx, "B03", "D"));
  });
});
