import { describe, expect, it } from "vitest";
import { FACTORY_STYLES, buildProject, cutlistRows, drawPartSheets, floorPlanSvg, loadProject, partDxf, resolveStyle, stackSheets } from "../src/index.ts";

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
    // Open ends overhang by worktop_overhang_end (20); walls and the corner do not.
    expect(wt.map((w) => [w.wall, w.x0, w.x1, w.depth, w.t])).toEqual([
      ["A", 0, 620, 600, 38],
      ["A", 1980, 3000, 600, 38],
      ["B", 600, p.B04!.x + 620, 600, 38],
    ]);
    expect(wt[0]!.y).toBe(100 + 720);
    expect(wt[1]!.outline).toEqual([[1980, 0], [3000, 0], [3000, -600], [1980, -600]]);
  });

  it("puts worktops on the cutlist", () => {
    const parts = r.parts.filter((q) => q.role === "worktop");
    expect(parts.map((q) => [q.id, q.length, q.width, q.thickness, q.material])).toEqual([
      ["ROOM-WT1", 620, 600, 38, "worktop-laminate-38"],
      ["ROOM-WT2", 1020, 600, 38, "worktop-laminate-38"],
      ["ROOM-WT3", p.B04!.x + 20, 600, 38, "worktop-laminate-38"],
    ]);
    const rows = cutlistRows(r.parts, r.library, {});
    expect(rows.some((row) => row.material === "worktop-laminate-38")).toBe(true);
  });
});

describe("plinths and cutouts (D31)", () => {
  const r = build([
    { id: "B01", type: "box", vars: { W: 800 }, options: { worktop_cutout: "sink" }, place: { wall: "A", x: 1200 } },
    { id: "B02", type: "box", vars: { W: 1000 }, options: { corner: "blind_right" }, place: { wall: "A" } },
    { id: "B03", type: "box", place: { wall: "B" } },
    { id: "T01", type: "box", kind: "tall", presets: ["tall-unit"], place: { wall: "B" } },
  ]);
  const p = Object.fromEntries(r.room!.placements.map((q) => [q.cabinet, q]));

  it("stops the worktop at a tall unit without overhang, overhangs at an open end", () => {
    expect(r.diagnostics).toEqual([]);
    const wt = r.room!.worktops;
    expect(wt.map((w) => [w.wall, w.x0, w.x1])).toEqual([
      ["A", 1180, 3000],
      ["B", 600, p.T01!.x],
    ]);
  });

  it("cuts the sink out of the worktop, centred over its cabinet", () => {
    const top = r.parts.find((q) => q.id === "ROOM-WT1")!;
    expect(top.operations).toEqual([
      expect.objectContaining({ kind: "pocket", face: "t1", u0: 20 + 400 - 280, u1: 20 + 400 + 280, v0: 600 - 50 - 490, v1: 550, w0: 0, w1: 38 }),
    ]);
  });

  it("runs plinth panels along floor runs and meets them in the corner", () => {
    const pl = r.room!.plinths;
    // A: B01 + B02 (1200 → wall end), front face 560 − 50 from the wall; it ends in B's front plane.
    expect(pl.map((x) => [x.wall, x.x0, x.x1, x.front, x.h, x.t])).toEqual([
      ["A", 1200, 3000 - 510, 510, 97, 16],
      ["B", 510, p.T01!.x + 600, 510, 97, 16],
    ]);
    expect(r.parts.filter((q) => q.role === "plinth").map((q) => [q.length, q.width, q.thickness, q.material])).toEqual([
      [2490 - 1200, 97, 16, "mel-white-16"],
      [p.T01!.x + 600 - 510, 97, 16, "mel-white-16"],
    ]);
  });
});

describe("cutout corner radius (D32)", () => {
  const mk = (vars: Record<string, number>) =>
    build([{ id: "B01", type: "box", vars: { W: 800, ...vars }, options: { worktop_cutout: "sink" }, place: { wall: "A", x: 1000 } }]);

  it("carries the radius into the pocket, the part sheet and the DXF as arcs", () => {
    const r = mk({ cutout_r: 12 });
    const top = r.parts.find((q) => q.role === "worktop")!;
    expect(top.operations[0]).toMatchObject({ kind: "pocket", r: 12 });
    const svg = stackSheets(drawPartSheets({ part: top, cabinet: { W: top.box.dx, H: top.box.dy, D: top.box.dz }, style: resolveStyle(FACTORY_STYLES[0]!.id, FACTORY_STYLES), text: { t: (k) => k } }));
    expect(svg).toMatch(/class="pd-pocket"[^>]* rx="/);
    expect(svg).toContain("R12");
    const dxf = partDxf(top, { W: top.box.dx, H: top.box.dy, D: top.box.dz })[0]!.content;
    expect(dxf.match(/\r\n42\r\n0\.414214\r\n/g)).toHaveLength(4);
    expect(floorPlanSvg(r.room!, "R", { t: (k) => k })).toMatch(/<path class="rm-cut" d="M [^"]* A /);
  });

  it("keeps square corners at radius 0 and rejects a radius over half the cutout", () => {
    expect(mk({ cutout_r: 0 }).parts.find((q) => q.role === "worktop")!.operations[0]).not.toHaveProperty("r");
    expect(mk({ cutout_r: 100, cutout_d: 150 }).diagnostics.map((d) => d.code)).toContain("worktop_cutout_radius");
  });
});
