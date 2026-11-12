import { buildProject, drawingText, floorPlanFrame, floorPlanSvg, loadProject, loadShop } from "@cabinet-planner/engine";
import { createTranslator } from "@cabinet-planner/i18n";
import { describe, expect, it } from "vitest";
import { applyMove, insertion, itemsOf, nearestWall, onWall, rayToPlan, simulate, snapX, stepAnchor, type ArrItem, type ArrWall } from "../src/lib/arrange.ts";
import example from "../../../examples/kitchen-basic.project.json" with { type: "json" };
import shop from "../../../examples/shop.json" with { type: "json" };

type Doc = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const build = (doc: Doc) => buildProject(loadProject(doc), loadShop(shop));

/** Rectangular room 3600 × 2400, walls clockwise from the top left. */
const walls: ArrWall[] = [
  { id: "A", index: 0, start: [0, 0], d: [1, 0], length: 3600, turn: "right" },
  { id: "B", index: 1, start: [3600, 0], d: [0, -1], length: 2400, turn: "right" },
  { id: "C", index: 2, start: [3600, -2400], d: [-1, 0], length: 3600, turn: "right" },
  { id: "D", index: 3, start: [0, -2400], d: [0, 1], length: 2400, turn: "right" },
];
const item = (id: string, W: number, wall = "A", extra: Partial<ArrItem> = {}): ArrItem => ({ id, level: "floor", wall, W, depth: 580, ...extra });
const four = [item("B01", 600), item("B02", 450), item("B03", 600), item("B04", 750)];

describe("simulate", () => {
  it("places runs like the engine, corner start and fixed positions included", () => {
    const check = (doc: Doc): void => {
      const r = build(doc);
      const pos = simulate(r.room!.walls, itemsOf(doc.cabinets, r.room!.placements));
      for (const q of r.room!.placements) expect(pos.get(q.cabinet), q.cabinet).toBeCloseTo(q.x, 6);
    };
    check(example);
    // The same kitchen in other orders and on other walls.
    const doc = clone(example) as Doc;
    doc.cabinets.reverse();
    check(doc);
    doc.cabinets[0].place = { wall: "C" };
    doc.cabinets[3].place = { wall: "B", x: 300 };
    doc.cabinets[5].place = { wall: "D" };
    check(doc);
  });
});

describe("insertion", () => {
  const others = four.slice(0, 3); // B04 (750) is dragged
  const at = (left: number) => insertion(walls, others, "A", "floor", left);

  it("keeps the place until the neighbour's middle is passed", () => {
    // B03 stands at 1050..1650, its middle at 1350.
    expect(at(1650).index).toBe(3);
    expect(at(1351).anchor).toEqual({ after: "B03" });
    expect(at(1349).anchor).toEqual({ after: "B02" });
    // B02 at 600..1050, middle 825; B01 middle 300.
    expect(at(826).index).toBe(2);
    expect(at(824).anchor).toEqual({ after: "B01" });
    expect(at(301).index).toBe(1);
    expect(at(299).anchor).toEqual({ before: "B01" });
    expect(at(-500).index).toBe(0);
    expect(at(9000).index).toBe(3);
  });

  it("swaps at the same line in both directions", () => {
    // Dragged left of B03 (index 2): B03 then stands at 1800..2400, its middle
    // at 2100; the dragged right side reaches it at left = 2100 - 750 = 1350.
    expect(at(1350 - 1).index).toBe(2);
    expect(at(1350 + 1).index).toBe(3);
  });

  it("uses the run of the same level only", () => {
    const mixed = [...others, item("W01", 800, "A", { level: "wall", depth: 340 }), item("W02", 800, "A", { level: "wall", depth: 340 })];
    expect(insertion(walls, mixed, "A", "wall", 500).anchor).toEqual({ after: "W01" });
    expect(insertion(walls, mixed, "A", "wall", 500).run).toEqual(["W01", "W02"]);
    expect(insertion(walls, mixed, "A", "floor", 2000).anchor).toEqual({ after: "B03" });
  });

  it("starts behind the corner unit of the previous wall", () => {
    // A is filled to its end (3600), so the run on B starts at 580.
    const corner = [item("B01", 3000), item("B02", 600), item("B10", 600, "B"), item("B11", 600, "B")];
    expect(simulate(walls, corner).get("B10")).toBe(580);
    // B10 at 580..1180: middle 880.
    expect(insertion(walls, corner, "B", "floor", 870).anchor).toEqual({ before: "B10" });
    expect(insertion(walls, corner, "B", "floor", 890).anchor).toEqual({ after: "B10" });
  });

  it("goes before fixed cabinets on a wall without a run, and anywhere on an empty wall", () => {
    const fixed = [...others, item("T01", 1000, "B", { x: 1400 })];
    expect(insertion(walls, fixed, "B", "floor", 200).anchor).toEqual({ before: "T01" });
    expect(insertion(walls, fixed, "C", "floor", 200).anchor).toBeNull();
  });
});

describe("applyMove", () => {
  const list = (): Doc[] => ["B01", "B02", "B03", "B04"].map((id) => ({ id, place: { wall: "A" } }));
  const ids = (l: Doc[]): string => l.map((c) => c.id).join(" ");

  it("moves in the list without writing a position", () => {
    const l = list();
    expect(applyMove(l, "B04", "A", { after: "B02" })).toBe(true);
    expect(ids(l)).toBe("B01 B02 B04 B03");
    expect(applyMove(l, "B04", "A", { after: "B01" })).toBe(true);
    expect(ids(l)).toBe("B01 B04 B02 B03");
    expect(applyMove(l, "B04", "A", { before: "B01" })).toBe(true);
    expect(ids(l)).toBe("B04 B01 B02 B03");
    expect(applyMove(l, "B04", "A", { after: "B03" })).toBe(true);
    expect(ids(l)).toBe("B01 B02 B03 B04");
    expect(l.every((c) => !("x" in c.place))).toBe(true);
  });

  it("is idempotent and reports no change", () => {
    const l = list();
    expect(applyMove(l, "B04", "A", { after: "B03" })).toBe(false);
    expect(applyMove(l, "B02", "A", { before: "B03" })).toBe(false);
    expect(applyMove(l, "B02", "A", null)).toBe(false);
    expect(ids(l)).toBe("B01 B02 B03 B04");
  });

  it("changes the wall, and sets or clears a fixed position", () => {
    const l = list();
    expect(applyMove(l, "B02", "B", null)).toBe(true);
    expect(l[1]!.place).toEqual({ wall: "B" });
    expect(applyMove(l, "B02", "B", null, 400)).toBe(true);
    expect(l[1]!.place).toEqual({ wall: "B", x: 400 });
    expect(applyMove(l, "B02", "A", { after: "B04" })).toBe(true);
    expect(l[3]!.place).toEqual({ wall: "A" });
  });
});

describe("drag in a run, checked with the engine", () => {
  const project = (): Doc => ({
    schemaVersion: 1,
    name: "Four",
    revision: 1,
    vars: {},
    room: { walls: [{ id: "A", length: 3600 }, { id: "B", length: 2400 }, { id: "C", length: 3600 }, { id: "D", length: 2400 }], openings: [] },
    cabinets: ["B01", "B02", "B03", "B04"].map((id, i) => ({ id, type: "box", kind: "base", presets: ["base-unit"], vars: { W: [600, 450, 600, 750][i] }, options: {}, place: { wall: "A" } })),
  });
  /** Drops `id` with its left side at `left` on `wall`, as the plan does. */
  const drop = (doc: Doc, id: string, wall: string, left: number): void => {
    const room = build(doc).room!;
    const others = itemsOf(doc.cabinets, room.placements).filter((it) => it.id !== id);
    const level = room.placements.find((q) => q.cabinet === id)!.kind === "wall" ? "wall" : "floor";
    applyMove(doc.cabinets, id, wall, insertion(room.walls, others, wall, level, left).anchor);
  };
  const xs = (doc: Doc): Record<string, string> => Object.fromEntries(build(doc).room!.placements.map((q) => [q.cabinet, `${q.wall}${q.x}`]));

  it("puts the rightmost of four between the others, gap-free", () => {
    const doc = project();
    expect(xs(doc)).toEqual({ B01: "A0", B02: "A600", B03: "A1050", B04: "A1650" });
    drop(doc, "B04", "A", 1300);
    expect(xs(doc)).toEqual({ B01: "A0", B02: "A600", B04: "A1050", B03: "A1800" });
    drop(doc, "B04", "A", 700);
    expect(xs(doc)).toEqual({ B01: "A0", B04: "A600", B02: "A1350", B03: "A1800" });
    drop(doc, "B04", "A", 5000);
    expect(xs(doc)).toEqual({ B01: "A0", B02: "A600", B03: "A1050", B04: "A1650" });
    expect(doc.cabinets.every((c: Doc) => c.place.x === undefined)).toBe(true);
  });

  it("moves to another wall, behind the corner unit where there is one", () => {
    const doc = project();
    drop(doc, "B02", "B", 100);
    expect(xs(doc)).toEqual({ B01: "A0", B03: "A600", B04: "A1200", B02: "B0" });
    // The example kitchen: A is full to the corner, the run on B starts behind B05.
    const kitchen = clone(example) as Doc;
    const before = build(kitchen).room!.placements.find((q) => q.cabinet === "B06")!;
    drop(kitchen, "B02", "B", 0);
    const after = build(kitchen).room!.placements;
    const at = (id: string) => after.find((q) => q.cabinet === id)!;
    // B05 no longer reaches the end of A (450 mm are missing): no corner start.
    expect(at("B05").x + at("B05").W).toBe(3600 - 450);
    expect(at("B02")).toMatchObject({ wall: "B", x: 0 });
    expect(at("B06").x).toBe(450);
    expect(before.x).toBeGreaterThan(500);
  });
});

describe("stepAnchor", () => {
  it("steps over the neighbour of the same run", () => {
    const items = [four[0]!, item("W01", 800, "A", { level: "wall" }), four[1]!, item("T01", 600, "A", { x: 3000 }), four[2]!];
    expect(stepAnchor(items, "B02", -1)).toEqual({ before: "B01" });
    expect(stepAnchor(items, "B02", 1)).toEqual({ after: "B03" });
    expect(stepAnchor(items, "B01", -1)).toBeNull();
    expect(stepAnchor(items, "B03", 1)).toBeNull();
    expect(stepAnchor(items, "W01", 1)).toBeNull();
    expect(stepAnchor(items, "T01", 1)).toBeNull();
  });
});

describe("nearestWall", () => {
  it("picks the nearest inner face, keeps the current wall on the diagonal and far away", () => {
    expect(nearestWall(walls, [1000, -200], "A")).toBe("A");
    expect(nearestWall(walls, [3400, -1200], "A")).toBe("B");
    expect(nearestWall(walls, [1000, -2300], "A")).toBe("C");
    // Corner of A and B: 300 from A, 250 from B: stays until B is nearer by the hysteresis.
    expect(nearestWall(walls, [3350, -300], "A")).toBe("A");
    expect(nearestWall(walls, [3350, -300], "B")).toBe("B");
    expect(nearestWall(walls, [3500, -300], "A")).toBe("B");
    expect(nearestWall(walls.slice(0, 1), [1800, -4000], "A")).toBe("A");
    expect(nearestWall(walls, [9000, -9000], "C")).toBe("C");
  });
  it("measures along the wall from its start", () => {
    expect(onWall(walls[1]!, [3300, -700])).toEqual({ u: 700, dist: 300 });
    expect(onWall(walls[2]!, [3000, -2000]).u).toBe(600);
  });
});

describe("snapX", () => {
  const cabs = [{ x: 600, W: 600 }];
  const ops = [{ x: 2200, width: 1000 }];
  const snap = (left: number, tol = 40) => snapX(left, 500, 3600, cabs, ops, tol);

  it("snaps to the wall's ends", () => {
    expect(snap(25)).toEqual({ x: 0, to: "wall_start", edge: 0 });
    expect(snap(3120)).toMatchObject({ x: 3100, to: "wall_end" });
    expect(snap(-300)).toEqual({ x: 0 });
    expect(snap(5000)).toEqual({ x: 3100 });
  });
  it("snaps either side to cabinets and openings", () => {
    expect(snap(1215)).toEqual({ x: 1200, to: "cabinet", edge: 1200 });
    expect(snap(80)).toEqual({ x: 100, to: "cabinet", edge: 600 });
    expect(snap(1690)).toEqual({ x: 1700, to: "opening", edge: 2200 });
    expect(snap(2210)).toEqual({ x: 2200, to: "opening", edge: 2200 });
    expect(snap(2720)).toMatchObject({ x: 2700, to: "opening", edge: 3200 });
  });
  it("takes the nearest edge and rounds to the grid otherwise", () => {
    expect(snapX(1190, 500, 3600, [{ x: 600, W: 600 }, { x: 1700, W: 300 }], [], 40)).toMatchObject({ x: 1200 });
    expect(snap(1432)).toEqual({ x: 1430 });
    expect(snap(1215, 10)).toEqual({ x: 1215 });
  });
  it("butts against cabinets, never aligns over them", () => {
    // 20 mm right of the neighbour's left side: no snap onto it.
    expect(snapX(620, 500, 3600, cabs, [], 40)).toEqual({ x: 620 });
    expect(snapX(1180, 500, 3600, cabs, [], 40)).toMatchObject({ x: 1200, to: "cabinet" });
  });
  it("does not snap past the wall", () => {
    // Right of a cabinet that ends 300 before the wall's end: no room for 500.
    expect(snapX(3310, 500, 3600, [{ x: 2700, W: 600 }], [], 40)).toEqual({ x: 3100 });
  });
});

describe("floorPlanFrame", () => {
  it("maps plan points to where the drawing has them", () => {
    const r = build(example);
    const room = r.room!;
    const f = floorPlanFrame(room);
    const svg = floorPlanSvg(room, "x", drawingText(createTranslator("en"), r.library));
    expect(svg).toContain(`viewBox="0 0 ${f.width} ${f.height}"`);
    // The floor polygon is drawn from the walls' start points.
    const pts = room.walls.map((w) => f.toPaper(w.start[0], w.start[1]).map((c) => Math.round(c * 1000) / 1000).join(",")).join(" ");
    expect(svg).toContain(`<polygon class="rm-floor" points="${pts}"/>`);
    const [x, y] = f.toPlan(...f.toPaper(1234, -567));
    expect(x).toBeCloseTo(1234, 6);
    expect(y).toBeCloseTo(-567, 6);
  });
});

describe("rayToPlan: the pointer of the 3D view as a plan point", () => {
  it("meets the plane at the given height; scene −Z is plan north", () => {
    // Straight down onto the floor.
    expect(rayToPlan([1200, 3000, -400], [0, -1, 0], 0)).toEqual([1200, 400]);
    // At 45° towards +X and towards the viewer (+Z = south), onto a plane 870 above the floor.
    const p = rayToPlan([0, 1870, 0], [1, -1, 1], 870)!;
    expect(p[0]).toBeCloseTo(1000, 6);
    expect(p[1]).toBeCloseTo(-1000, 6);
  });

  it("gives nothing for a level ray, a ray away from the plane or one near the horizon", () => {
    expect(rayToPlan([0, 1000, 0], [1, 0, 0], 0)).toBeNull();
    expect(rayToPlan([0, 1000, 0], [0, 1, 0], 0)).toBeNull();
    expect(rayToPlan([0, 1000, 0], [1, -0.001, 0], 0)).toBeNull();
    // From below the plane upwards (looking at a wall unit's underside) works.
    expect(rayToPlan([500, 0, 0], [0, 1, 0], 1400)).toEqual([500, -0]);
  });

  it("a ray onto a cabinet of the example gives its place along the wall, as the floor plan does", () => {
    const room = build(example).room!;
    const q = room.placements.find((x) => x.cabinet === "B03")!;
    const w = room.walls.find((x) => x.id === q.wall)!;
    // The middle of the cabinet's top, seen from somewhere in the room.
    const top = q.baseY + q.H;
    const mid: [number, number] = [q.origin[0] + q.d[0] * (q.W / 2) + q.n[0] * (q.depth / 2), q.origin[1] + q.d[1] * (q.W / 2) + q.n[1] * (q.depth / 2)];
    const eye: [number, number, number] = [mid[0] + 900, 2600, -mid[1] + 2100];
    const p = rayToPlan(eye, [mid[0] - eye[0], top - eye[1], -mid[1] - eye[2]], top)!;
    expect(onWall(w, p).u).toBeCloseTo(q.x + q.W / 2, 6);
    expect(nearestWall(room.walls, p, "C")).toBe(q.wall);
  });
});

describe("nearestWall for a cabinet held at its front (3D view)", () => {
  it("a cabinet at the end of wall A, held 580 in front of it, stays on A although wall B is nearer to the pointer", () => {
    // 300 from wall B (x = 3600), 580 in front of wall A (y = 0, room to the south).
    const p: [number, number] = [3300, -580];
    expect(nearestWall(walls, p, "A")).toBe("B");
    expect(nearestWall(walls, p, "A", 150, 1500, 580)).toBe("A");
  });

  it("held in front of a place on the other wall, it goes there", () => {
    // 580 in front of wall B, 900 along it; 320 behind that point as seen from wall A.
    const p: [number, number] = [3600 - 580, -900];
    expect(nearestWall(walls, p, "A", 150, 1500, 580)).toBe("B");
    // And it stays there on the way back until wall A is clearly nearer.
    expect(nearestWall(walls, [3600 - 580, -700], "B", 150, 1500, 580)).toBe("B");
    expect(nearestWall(walls, [2000, -600], "B", 150, 1500, 580)).toBe("A");
  });

  it("the engine's wall normals are the default normals", () => {
    for (const w of build(example).room!.walls) {
      expect(w.n[0]).toBeCloseTo(w.d[1], 9);
      expect(w.n[1]).toBeCloseTo(-w.d[0], 9);
    }
  });
});
