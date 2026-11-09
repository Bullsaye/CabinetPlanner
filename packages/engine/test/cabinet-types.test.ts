import { describe, expect, it } from "vitest";
import { FACTORY_TEMPLATES, buildProject, loadProject } from "../src/index.ts";
import { buildOne, partsByCode } from "./helpers.ts";

describe("templates (D30)", () => {
  it.each(FACTORY_TEMPLATES.map((t) => [t.id, t] as const))("%s builds without findings", (_, t) => {
    const r = buildProject(loadProject({ schemaVersion: 1, name: "T", cabinets: [{ id: "X1", type: "box", ...t.cabinet }] }));
    expect(r.diagnostics).toEqual([]);
    expect(r.parts.length).toBeGreaterThan(4);
  });
});

describe("zones and fixed shelves (D30)", () => {
  it("puts an oven niche on a fixed shelf and an appliance front on the fridge", () => {
    const r = buildOne({
      kind: "tall",
      presets: ["tall-unit"],
      vars: { shelf_count: 0 },
      fronts: [{ type: "door" }, { type: "appliance", h: "oven_h" }, { type: "appliance", h: 400, front: true }, { type: "drawer" }],
    });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const doorLow = p.DO1!.box.y;
    // Shelf under the oven: its top is the oven zone's lower edge; above it: one gap above the zone.
    const fs = r.parts.filter((x) => x.role === "fixed_shelf").map((x) => [x.box.y, x.box.y + x.box.dy]);
    const oven = { y1: doorLow - 3, y0: doorLow - 3 - 600 };
    expect(fs[0]).toEqual([oven.y1 + 3, oven.y1 + 3 + 19]);
    expect(fs[1]).toEqual([oven.y0 - 19, oven.y0]);
    expect(p.AF1!.box.dy).toBe(400);
    // Fixed shelves are dowelled into both sides.
    expect(p.FS1!.operations.filter((o) => o.sources.some((s) => s.kind === "joint")).length).toBeGreaterThan(0);
    expect(p.SL!.operations.some((o) => o.sources.some((s) => s.ref === "SL-FS1"))).toBe(true);
    // No system holes hidden behind a fixed shelf.
    const sl = p.SL!;
    const holes = sl.operations.filter((o) => o.kind === "bore" && o.sources.some((s) => s.kind === "system"));
    for (const f of [p.FS1!, p.FS2!]) {
      expect(holes.filter((h) => h.kind === "bore" && h.u > f.box.y - 2.5 && h.u < f.box.y + f.box.dy + 2.5)).toEqual([]);
    }
  });

  it("leaves open zones without fronts and shares shelves between door and open zones", () => {
    const r = buildOne({ kind: "tall", presets: ["tall-unit"], vars: { shelf_count: 4 }, fronts: [{ type: "open" }, { type: "door", h: 717 }] });
    expect(r.diagnostics).toEqual([]);
    const roles = r.parts.map((x) => x.role);
    expect(roles.filter((x) => x === "door")).toHaveLength(1);
    expect(roles.filter((x) => x === "fixed_shelf")).toHaveLength(1);
    expect(roles.filter((x) => x === "shelf").length).toBe(6); // 4 above, 2 in the lower door zone
  });

  it("fits a hat shelf and a rail in the hanging section of a wardrobe", () => {
    const r = buildOne({ kind: "tall", presets: ["tall-unit", "wardrobe"], vars: { W: 1000, partition_count: 1, shelf_count: 3 }, options: { interior: "hanging_last" } });
    expect(r.diagnostics).toEqual([]);
    const c = r.cabinets[0]!;
    const p = partsByCode(r);
    const mp = p.MP1!;
    expect(p.FS1!.box.x).toBe(mp.box.x + mp.box.dx); // right section
    expect(p.FS1!.box.y + p.FS1!.box.dy).toBe(2100 - 19 - 330);
    const rail = c.fittings.find((f) => f.kind === "rail")!;
    expect(rail.y).toBe(p.FS1!.box.y - 50);
    expect(rail.length).toBe(1000 - 19 - p.FS1!.box.x - 2);
    expect(c.hardware.find((h) => h.item === "generic-wardrobe-rail")).toEqual({ item: "generic-wardrobe-rail", qty: 1, unit: "pcs", lengths: [rail.length] });
    // Shelves only in the left section; rail supports screwed into the middle panel and the right side.
    expect(r.parts.filter((x) => x.role === "shelf").every((x) => x.box.x < mp.box.x)).toBe(true);
    expect(mp.operations.some((o) => o.sources.some((s) => s.ref === "generic-wardrobe-rail"))).toBe(true);
    expect(p.SR!.operations.some((o) => o.sources.some((s) => s.ref === "generic-wardrobe-rail"))).toBe(true);
  });
});

describe("adjustable legs (D31)", () => {
  it("stands floor units on legs drilled into the bottom, more legs for wide units", () => {
    const r = buildOne({ vars: { W: 1200 } });
    const c = r.cabinets[0]!;
    const legs = c.fittings.filter((f) => f.kind === "leg");
    expect(legs.map((l) => l.x).filter((x, i, a) => a.indexOf(x) === i)).toEqual([50, 600, 1150]);
    expect(legs.every((l) => l.h === 100)).toBe(true);
    expect(c.hardware.find((h) => h.item === "generic-leg-100")?.qty).toBe(6);
    expect(partsByCode(r).BO!.operations.filter((o) => o.sources.some((s) => s.ref === "generic-leg-100"))).toHaveLength(6);
  });

  it("checks the plinth height against the leg's range, and skips wall units", () => {
    expect(buildOne({ vars: { plinth_h: 150 } }).diagnostics.map((d) => d.code)).toContain("hardware_limit");
    expect(buildOne({ vars: { plinth_h: 150 }, options: { "hardware.leg": "generic-leg-150" } }).diagnostics).toEqual([]);
    expect(buildOne({ kind: "wall", presets: ["wall-unit"] }).cabinets[0]!.fittings).toEqual([]);
  });
});
