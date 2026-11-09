import { describe, expect, it } from "vitest";
import { buildProject, elevationSvg, floorPlanSvg, loadProject, toPlan, type DrawingText } from "../src/index.ts";

const text: DrawingText = { t: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k) };
const rectRoom = {
  walls: [
    { id: "A", length: 3600 },
    { id: "B", length: 2400 },
    { id: "C", length: 3600 },
    { id: "D", length: 2400 },
  ],
  openings: [{ wall: "A", kind: "window", x: 2200, width: 1000, sill: 1000, height: 1250 }],
};
const build = (cabinets: unknown[], room: unknown = rectRoom) =>
  buildProject(loadProject({ schemaVersion: 1, name: "R", room, cabinets }));

describe("room layout (D28)", () => {
  it("lays walls out clockwise with the room on the right; a rectangle closes", () => {
    const r = build([]);
    const w = r.room!.walls;
    expect(w.map((x) => [x.start, x.d])).toEqual([
      [[0, 0], [1, 0]],
      [[3600, 0], [0, -1]],
      [[3600, -2400], [-1, 0]],
      [[0, -2400], [0, 1]],
    ]);
    expect(w[0]!.n).toEqual([0, -1]); // interior south of wall A
    expect(r.room!.closed).toBe(true);
    expect(w[0]!.height).toBe(2500);
  });

  it("runs floor and wall units separately along their wall, or uses given positions", () => {
    const r = build([
      { id: "B01", type: "box", place: { wall: "A" } },
      { id: "B02", type: "box", vars: { W: 450 }, place: { wall: "A" } },
      { id: "W01", type: "box", kind: "wall", presets: ["wall-unit"], place: { wall: "A" } },
      { id: "T01", type: "box", kind: "tall", presets: ["tall-unit"], place: { wall: "B", x: 700 } },
    ]);
    const p = Object.fromEntries(r.room!.placements.map((q) => [q.cabinet, q]));
    expect([p.B01!.x, p.B02!.x, p.W01!.x, p.T01!.x]).toEqual([0, 600, 0, 700]);
    expect(p.W01!.baseY).toBe(1450);
    expect(p.B01!.baseY).toBe(100);
    // Tall unit on wall B: rear-left corner 700 down wall B, front facing west into the room.
    expect(p.T01!.origin).toEqual([3600, -700]);
    expect(toPlan(p.T01!, { x: 0, y: 0, z: 560 })).toEqual({ x: 3040, y: -700, h: 100 });
    expect(r.diagnostics).toEqual([]);
  });

  it("reports overlaps, cabinets past the wall end and units in front of openings", () => {
    const r = build([
      { id: "B01", type: "box", place: { wall: "A", x: 3200 } },
      { id: "T01", type: "box", kind: "tall", presets: ["tall-unit"], place: { wall: "B", x: 0 } },
    ]);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain("room_cabinet_outside_wall");
    expect(codes).toContain("room_cabinets_overlap"); // corner: B01 runs into wall B's tall unit
    const w = build([{ id: "W01", type: "box", kind: "wall", presets: ["wall-unit"], place: { wall: "A", x: 2300 } }]);
    expect(w.diagnostics.map((d) => d.code)).toContain("room_cabinet_in_opening");
    expect(w.ok).toBe(true); // room findings never block parts
  });

  it("never makes a plinth panel or worktop of zero or negative length", () => {
    // A unit standing wholly past the wall's end: warned, but no part may come out with a negative length.
    const past = build([{ id: "B01", type: "box", place: { wall: "A", x: 4000 } }]);
    expect(past.diagnostics.map((d) => d.code)).toContain("room_cabinet_outside_wall");
    expect(past.room!.parts.filter((q) => !(q.length > 0))).toEqual([]);
    expect(past.room!.plinths).toEqual([]);
    for (const length of [0, -500]) {
      const r = build([{ id: "B01", type: "box", place: { wall: "A" } }], { walls: [{ id: "A", length }] });
      expect(r.diagnostics).toContainEqual({ severity: "error", code: "room_value_invalid", params: { what: "wall A length", expr: String(length) } });
      expect(r.room!.parts.filter((q) => !(q.length > 0))).toEqual([]);
    }
  });

  it("treats a corner unit as covered by its worktop, which starts at the other worktop's front edge", () => {
    // B01 fills the end of wall A; B02 starts behind it on wall B (at 579), its worktop at 600 (D29).
    const r = build([
      { id: "B01", type: "box", place: { wall: "A", x: 3000 } },
      { id: "B02", type: "box", place: { wall: "B" } },
    ]);
    expect(r.room!.worktops.map((w) => [w.wall, w.x0])).toEqual([["A", 2980], ["B", 600]]);
    // No floor unit is drawn on top of the worktops in the plan.
    expect(floorPlanSvg(r.room!, "R", text)).not.toContain('class="rm-cab"');
    // Elevation of wall B: the id sits above the worktop (858 + 38 + 40), not on it.
    const el = elevationSvg(r.room!, "B", r.cabinets, "R", text);
    const y = (label: string): number => Number(new RegExp(`y="([\\d.]+)"[^>]*>${label}<`).exec(el)![1]);
    const a = elevationSvg(r.room!, "A", r.cabinets, "R", text);
    const ya = Number(/y="([\d.]+)"[^>]*>B01</.exec(a)![1]);
    expect(y("B02")).toBe(ya);
  });

  it("writes the names of vertical walls beside their dimension chains, not across them", () => {
    const plan = floorPlanSvg(build([]).room!, "R", text);
    expect(plan).toMatch(/text-anchor="middle">room.wall A</);
    expect(plan).toMatch(/text-anchor="start">room.wall B</);
    expect(plan).toMatch(/text-anchor="middle">room.wall C</);
    expect(plan).toMatch(/text-anchor="end">room.wall D</);
  });

  it("draws a floor plan and elevations", () => {
    const r = build([
      { id: "B01", type: "box", place: { wall: "A" }, options: { "hardware.handle": "generic-bar-128" } },
      { id: "W01", type: "box", kind: "wall", presets: ["wall-unit"], place: { wall: "A" } },
    ]);
    const plan = floorPlanSvg(r.room!, "R", text);
    expect(plan).toContain('width="420mm"');
    expect(plan).toContain('class="rm-glass"');
    expect(plan).toContain(">B01<");
    expect(plan).not.toMatch(/NaN|undefined/);
    const el = elevationSvg(r.room!, "A", r.cabinets, "R", text);
    expect(el).toContain('class="rm-handle"');
    expect(el).toContain(">38<"); // worktop, then the gap to the wall unit
    expect(el).toContain(">592<"); // worktop top (858) to wall unit (1450)
    expect(el).not.toMatch(/NaN|undefined/);
  });
});
