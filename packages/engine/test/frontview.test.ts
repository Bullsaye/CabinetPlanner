import { describe, expect, it } from "vitest";
import { BUNDLED, frontViewOf } from "../src/index.ts";
import { buildOne } from "./helpers.ts";

const view = (cabinet: Record<string, unknown>) => {
  const r = buildOne({ ...cabinet, options: { "hardware.handle": "generic-bar-160", ...((cabinet.options as object) ?? {}) } });
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return frontViewOf(r.cabinets[0]!);
};

describe("front view of a cabinet (D68)", () => {
  it("base unit, door hinged left: hinges on the left edge, handle at the right", () => {
    const f = view({ presets: ["base-unit"], vars: { W: 600 }, fronts: [{ type: "door", doors: 1, hinge: "left" }] });
    const door = f.parts.find((p) => p.role === "door")!;
    expect(door.hinge).toBe("left");
    expect(door.zone).toBe(0);
    expect(f.hinges.length).toBeGreaterThanOrEqual(2);
    expect(f.hinges.every((h) => h.edge === "left" && h.x < door.x + 40)).toBe(true);
    expect(f.handles).toHaveLength(1);
    expect(f.handles[0]!.x1).toBeGreaterThan(door.x + door.w / 2);
    // Fronts are drawn last, the floor is the plinth height below the carcase.
    expect(f.parts[f.parts.length - 1]!.front).toBe(true);
    expect(f.bounds.y0).toBe(-f.plinth);
    expect(f.legs.length).toBeGreaterThan(0);
  });

  it("mirrors with the hinge side", () => {
    const f = view({ presets: ["base-unit"], vars: { W: 600 }, fronts: [{ type: "door", doors: 1, hinge: "right" }] });
    const door = f.parts.find((p) => p.role === "door")!;
    expect(f.hinges.every((h) => h.edge === "right" && h.x > door.x + door.w - 40)).toBe(true);
    expect(f.handles[0]!.x2).toBeLessThan(door.x + door.w / 2);
  });

  it("wall unit with two doors: one hinged on each side, no floor", () => {
    const f = view({ kind: "wall", presets: ["wall-unit"], vars: { W: 800, door_count: 2 } });
    const doors = f.parts.filter((p) => p.role === "door").sort((a, b) => a.x - b.x);
    expect(doors.map((d) => d.hinge)).toEqual(["left", "right"]);
    expect(f.plinth).toBe(0);
    expect(f.legs).toEqual([]);
    expect(f.handles).toHaveLength(2);
  });

  it("drawers: a zone per front, top to bottom, no hinges", () => {
    const f = view({ presets: ["base-unit"], vars: { W: 600 }, fronts: [{ type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer" }] });
    const fronts = f.parts.filter((p) => p.role === "drawer_front").sort((a, b) => b.y - a.y);
    expect(fronts.map((p) => p.zone)).toEqual([0, 1, 2]);
    expect(f.hinges).toEqual([]);
    expect(f.handles).toHaveLength(3);
  });

  it("pantry with stacked doors: each door has its hinges and its handle inside its own height", () => {
    const tpl = BUNDLED.templates.find((t) => t.id === "tall-pantry")!;
    const f = view({ ...tpl.cabinet });
    const doors = f.parts.filter((p) => p.role === "door");
    expect(doors).toHaveLength(2);
    for (const d of doors) {
      const hs = f.hinges.filter((h) => h.part === d.id);
      expect(hs.length).toBeGreaterThanOrEqual(2);
      expect(hs.every((h) => h.edge === d.hinge && h.y > d.y && h.y < d.y + d.h)).toBe(true);
      const hd = f.handles.find((h) => h.part === d.id)!;
      expect(Math.min(hd.y1, hd.y2)).toBeGreaterThan(d.y);
      expect(Math.max(hd.y1, hd.y2)).toBeLessThan(d.y + d.h);
      // The handle is on the half away from the hinges.
      const mid = d.x + d.w / 2;
      expect(d.hinge === "left" ? hd.x1 > mid : hd.x1 < mid).toBe(true);
    }
  });
});
