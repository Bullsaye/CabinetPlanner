import { describe, expect, it } from "vitest";
import { buildProject, cutlistRows, loadProject } from "../src/index.ts";

const room = {
  walls: [
    { id: "A", length: 3000 },
    { id: "B", length: 2400 },
    { id: "C", length: 3000 },
    { id: "D", length: 2400 },
  ],
};
const build = (cabinets: unknown[]) => buildProject(loadProject({ schemaVersion: 1, name: "C", room, cabinets }));

describe("blind corner units (D29)", () => {
  it("covers the corner side with a blind panel and hinges the door away from it", () => {
    const r = build([{ id: "B01", type: "box", vars: { W: 1000, door_count: 1 }, options: { corner: "blind_right" } }]);
    const c = r.cabinets[0]!;
    expect(c.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const blind = c.parts.find((p) => p.role === "blind_panel")!;
    const door = c.parts.find((p) => p.role === "door")!;
    expect(blind).toBeDefined();
    // Blind on the right, door on the left; together they cover the width.
    expect(blind.box.x).toBeGreaterThan(door.box.x);
    expect(blind.box.x + blind.box.dx).toBeLessThanOrEqual(1000);
    expect(blind.box.x - (door.box.x + door.box.dx)).toBeGreaterThan(0);
    expect(c.resolved.values.get("blind_w")).toBe(650);
    // Hinge cups on the door's left edge (away from the blind).
    const cups = door.operations.filter((o) => o.kind === "bore" && o.d >= 30);
    expect(cups).toHaveLength(2);
    const plates = (role: string) =>
      c.parts.find((p) => p.role === role)!.operations.filter((o) => o.sources.some((s) => s.kind === "hardware" && s.ref === "generic-hinge-110"));
    expect(plates("side_left").length).toBeGreaterThan(0);
    expect(plates("side_right")).toEqual([]);
    expect(cups.length).toBeGreaterThan(0);

  });

  it("rejects a blind panel that leaves no room for the door", () => {
    const r = build([{ id: "B01", type: "box", vars: { W: 600 }, options: { corner: "blind_left" } }]);
    expect(r.cabinets[0]!.diagnostics.map((d) => d.code)).toContain("blind_too_wide");
  });
});

describe("corner runs and worktops (D29)", () => {
  const r = build([
    { id: "B01", type: "box", place: { wall: "A" } },
    { id: "B02", type: "box", vars: { W: 1000 }, options: { corner: "blind_right" }, place: { wall: "A", x: 2000 } },
    { id: "B03", type: "box", place: { wall: "B" } },
    { id: "B04", type: "box", place: { wall: "B" } },
  ]);
  const p = Object.fromEntries(r.room!.placements.map((q) => [q.cabinet, q]));

  it("starts the run of the next wall behind the corner unit's front", () => {
    expect(p.B03!.x).toBe(p.B02!.depth);
    expect(p.B04!.x).toBe(p.B02!.depth + 600);
    expect(r.diagnostics.filter((d) => d.code === "room_cabinets_overlap")).toEqual([]);
  });

  it("makes one worktop per run; the first runs into the corner, the next butts against it", () => {
    const wt = r.room!.worktops;
    expect(wt.map((w) => [w.wall, w.x0, w.x1, w.depth, w.t])).toEqual([
      ["A", 0, 600, 600, 38],
      ["A", 2000, 3000, 600, 38],
      ["B", 600, p.B04!.x + 600, 600, 38],
    ]);
    expect(wt[0]!.y).toBe(100 + 720);
    expect(wt[1]!.outline).toEqual([[2000, 0], [3000, 0], [3000, -600], [2000, -600]]);
  });

  it("puts worktops on the cutlist", () => {
    const parts = r.parts.filter((q) => q.role === "worktop");
    expect(parts.map((q) => [q.id, q.length, q.width, q.thickness, q.material])).toEqual([
      ["ROOM-WT1", 600, 600, 38, "worktop-laminate-38"],
      ["ROOM-WT2", 1000, 600, 38, "worktop-laminate-38"],
      ["ROOM-WT3", p.B04!.x, 600, 38, "worktop-laminate-38"],
    ]);
    const rows = cutlistRows(r.parts, r.library, {});
    expect(rows.some((row) => row.material === "worktop-laminate-38")).toBe(true);
  });
});
