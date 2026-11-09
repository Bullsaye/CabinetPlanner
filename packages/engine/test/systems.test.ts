import { describe, expect, it } from "vitest";
import { dowelPositions, gridPositions, type Bore, type Part } from "../src/index.ts";
import { buildOne, partsByCode } from "./helpers.ts";

/*
 * Expected positions are derived by hand from DECISIONS.md D13–D16 for the
 * factory base 600 (H 720, D 560, 19 mm board, groove back 10 mm from the
 * rear). Not yet verified on a machined part.
 */

const bores = (p: Part, ref?: string): Bore[] =>
  p.operations.filter((o): o is Bore => o.kind === "bore" && (!ref || o.sources.some((s) => s.ref === ref)));

describe("grid helpers", () => {
  it("lists grid positions inside a range", () => {
    expect(gridPositions(9.5, 32, 59, 161)).toEqual([73.5, 105.5, 137.5]);
    expect(gridPositions(9.5, 32, 200, 100)).toEqual([]);
  });

  const o = { pitch: 32, offsetFront: 37, offsetRear: 20, maxSpacing: 160, minCount: 2 };

  it("places dowels on the pitch from the front, at most maxSpacing apart", () => {
    // 560 deep: candidates 523, 491, … 43; thinned to steps of 160.
    expect(dowelPositions(0, 560, o)).toEqual([523, 363, 203, 43]);
  });

  it("keeps both dowels on a 100 mm rail", () => {
    expect(dowelPositions(460, 560, o)).toEqual([523, 491]);
  });

  it("returns one or none on very short joints", () => {
    expect(dowelPositions(500, 560, o)).toEqual([523]);
    expect(dowelPositions(530, 560, o)).toEqual([]);
  });

  it("spreads dowels to reach the minimum count", () => {
    expect(dowelPositions(0, 560, { ...o, maxSpacing: 1000, minCount: 3 })).toEqual([523, 267, 43]);
  });
});

describe("base 600 machining", () => {
  const r = buildOne();
  const p = partsByCode(r);

  it("builds without findings", () => {
    expect(r.diagnostics).toEqual([]);
  });

  it("grooves sides and bottom for the back", () => {
    const groove = p.SL!.operations.find((o) => o.kind === "pocket")!;
    // Groove 10 mm from the rear, 8.5 wide, 8 deep, from the back's lower end to the top.
    expect(groove).toMatchObject({ face: "t1", u0: 11, u1: 720, v0: 9.75, v1: 18.25, w0: 11, w1: 19 });
    expect(p.BO!.operations.find((o) => o.kind === "pocket")).toMatchObject({ face: "t1", u0: 0, u1: 562, w0: 11 });
    expect(p.RR!.operations.some((o) => o.kind === "pocket")).toBe(false);
  });

  it("dowels sides to bottom and rails on the grid", () => {
    expect(bores(p.SL!, "SL-BO").map((b) => [b.u, b.v, b.d, b.depth])).toEqual([
      [9.5, 523, 8, 12],
      [9.5, 363, 8, 12],
      [9.5, 203, 8, 12],
      [9.5, 43, 8, 12],
    ]);
    expect(bores(p.BO!, "SL-BO").every((b) => b.face === "w1" && b.w === 9.5 && b.depth === 25)).toBe(true);
    expect(bores(p.BO!, "SR-BO").every((b) => b.face === "w2")).toBe(true);
    expect(bores(p.SL!, "SL-RF").map((b) => b.v)).toEqual([523, 491]);
    expect(bores(p.SL!, "SL-RR").map((b) => b.v)).toEqual([81, 49]);
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "dowel-8x35")!.qty).toBe(16);
  });

  it("drills system rows 37 mm from the front and behind the back", () => {
    const rows = bores(p.SL!, "rows");
    expect(new Set(rows.map((b) => b.v))).toEqual(new Set([523, 75]));
    // From 19 + 40 up to 701 − 40 on the 9.5 + 32k grid.
    const ys = [...new Set(rows.map((b) => b.u))].sort((a, b) => a - b);
    expect(ys[0]).toBe(73.5);
    expect(ys[ys.length - 1]).toBe(649.5);
    expect(rows.every((b) => b.d === 5 && b.depth === 13)).toBe(true);
  });

  it("hangs the door on two hinges whose plates use the system holes", () => {
    const cups = bores(p.DO1!, "generic-hinge-110");
    // 80 mm from the door ends, snapped so the plate holes (±16) hit the grid.
    expect(cups.map((b) => [b.u, b.v, b.d])).toEqual([
      [89.5, 21.5, 35],
      [633.5, 21.5, 35],
    ]);
    const plates = bores(p.SL!, "generic-hinge-110");
    expect(plates.map((b) => b.u)).toEqual([73.5, 105.5, 617.5, 649.5]);
    expect(plates.every((b) => b.sources.some((s) => s.kind === "system"))).toBe(true);
    expect(bores(p.SR!, "generic-hinge-110")).toEqual([]);
  });

  it("puts shelves on the support holes", () => {
    // Target 19 + 682/2 − 9.5 = 350.5; nearest rest height is hole 361.5 + 3.
    expect(p.SH1!.box.y).toBe(364.5);
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "shelf-pin-5")!.qty).toBe(4);
  });
});

describe("variants", () => {
  it("hinges on the right side", () => {
    const p = partsByCode(buildOne({ options: { door_hinge_side: "right" } }));
    expect(bores(p.DO1!, "generic-hinge-110").every((b) => b.v === 597 - 21.5)).toBe(true);
    expect(bores(p.SR!, "generic-hinge-110")).toHaveLength(4);
    expect(bores(p.SL!, "generic-hinge-110")).toHaveLength(0);
  });

  it("hangs two doors outwards", () => {
    const r = buildOne({ vars: { W: 800, door_count: 2 } });
    const p = partsByCode(r);
    expect(bores(p.SL!, "generic-hinge-110")).toHaveLength(4);
    expect(bores(p.SR!, "generic-hinge-110")).toHaveLength(4);
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "generic-hinge-110")!.qty).toBe(4);
  });

  it("takes hinge distance and count from cabinet variables", () => {
    const p = partsByCode(buildOne({ vars: { hinge_end_offset: 120, hinge_count: 3 }, options: { system_holes: "none" } }));
    expect(bores(p.DO1!).map((b) => b.u)).toEqual([120, 358.5, 597]);
  });

  it("uses more hinges on tall doors", () => {
    const r = buildOne({ vars: { H: 2000 }, options: { top: "full" } });
    expect(r.diagnostics).toEqual([]);
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "generic-hinge-110")!.qty).toBe(4);
  });

  it("sides between: dowels go into the bottom face and the side ends", () => {
    const p = partsByCode(buildOne({ options: { carcase_joint: "sides_between", top: "full" } }));
    expect(bores(p.BO!, "BO-SL").every((b) => b.face === "t1" && b.depth === 12 && b.u === 9.5)).toBe(true);
    expect(bores(p.SL!, "BO-SL").every((b) => b.face === "w1" && b.depth === 25)).toBe(true);
    expect(bores(p.TO!, "TO-SL").every((b) => b.face === "t0")).toBe(true);
    expect(bores(p.SL!, "TO-SL").every((b) => b.face === "w2")).toBe(true);
  });

  it("rebate back: rebate opens to the face and the rear edge", () => {
    const p = partsByCode(buildOne({ options: { back_mount: "rebate" } }));
    expect(p.SL!.operations.find((o) => o.kind === "pocket")).toMatchObject({ face: "t1", v0: 0, v1: 8.25 });
  });

  it("surface back: no pockets", () => {
    const r = buildOne({ options: { back_mount: "surface" } });
    expect(r.parts.flatMap((x) => x.operations).some((o) => o.kind === "pocket")).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("joint method none: no construction holes", () => {
    const r = buildOne({ options: { joint_method: "none" } });
    expect(r.parts.flatMap((x) => x.operations).some((o) => o.sources.some((s) => s.kind === "joint"))).toBe(false);
    expect(r.cabinets[0]!.hardware.some((h) => h.item === "dowel-8x35")).toBe(false);
  });

  it("no system holes: hinges unsnapped, warning for shelf supports", () => {
    const r = buildOne({ options: { system_holes: "none" } });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["shelf_supports_without_holes"]);
    const p = partsByCode(r);
    expect(bores(p.DO1!).map((b) => b.u)).toEqual([80, 637]);
  });

  it("moves dowels off a groove that sits where a dowel would go", () => {
    // Groove at 39.75–48.25 from the rear: the dowel at 43 is skipped, the next free grid point is 75.
    const r = buildOne({ vars: { back_groove_offset: 40 } });
    expect(r.diagnostics).toEqual([]);
    expect(bores(partsByCode(r).SL!, "SL-BO").map((b) => b.v)).toEqual([523, 363, 203, 75]);
  });

  it("reports dowels too deep for thin board", () => {
    const r = buildOne(
      { options: { "material.carcase": "thin" } },
      { library: { materials: [{ id: "thin", name: "Thin", thickness: 12 }] } },
    );
    expect(r.diagnostics.map((d) => d.code)).toContain("bore_too_deep");
  });
});

describe("hardware library", () => {
  const custom = (over: Record<string, unknown>) => ({
    id: "my-hinge",
    name: "My hinge",
    category: "hinge",
    params: { count: 2, cup_d: 35, cup_depth: 12 },
    drilling: [{ mount: "door", d: "cup_d", depth: "cup_depth", a: 0, b: 22.5 }],
    ...over,
  });

  it("uses a user hinge from the project library", () => {
    const r = buildOne({ options: { "hardware.hinge": "my-hinge" } }, { library: { hardware: [custom({})] } });
    expect(r.diagnostics).toEqual([]);
    const cups = bores(partsByCode(r).DO1!, "my-hinge");
    expect(cups.map((b) => [b.u, b.v, b.depth])).toEqual([
      [80, 22.5, 12],
      [637, 22.5, 12],
    ]);
  });

  it("reports unknown items, wrong categories and bad item data", () => {
    expect(buildOne({ options: { "hardware.hinge": "nope" } }).diagnostics.map((d) => d.code)).toEqual([
      "hardware_unknown",
    ]);
    expect(buildOne({ options: { "hardware.hinge": "dowel-8x35" } }).diagnostics.map((d) => d.code)).toEqual([
      "hardware_wrong_category",
    ]);
    const bad = buildOne(
      { options: { "hardware.hinge": "my-hinge" } },
      {
        library: {
          hardware: [
            custom({
              params: { count: 2, W: 3 },
              drilling: [
                { mount: "door", d: "nope", depth: 12, a: 0, b: 20 },
                { mount: "shelf", d: 5, depth: 12, a: 0, b: 20 },
              ],
            }),
          ],
        },
      },
    );
    expect(new Set(bad.diagnostics.map((d) => d.code))).toEqual(
      new Set(["hardware_param_shadows", "hardware_drill_invalid", "hardware_unknown_mount"]),
    );
  });

  it("reports hardware drilling that collides with other holes", () => {
    const r = buildOne(
      { options: { "hardware.hinge": "my-hinge" } },
      {
        library: {
          hardware: [
            custom({ drilling: [{ mount: "side", d: 5, depth: 13, a: 16, b: 40 }] }), // 3 mm off the system row
          ],
        },
      },
    );
    expect(r.diagnostics.map((d) => d.code)).toContain("ops_collide");
    expect(r.ok).toBe(false);
  });

  it("can drop shelf supports", () => {
    const r = buildOne({ options: { "hardware.shelf_support": null } });
    expect(r.cabinets[0]!.hardware.some((h) => h.item === "shelf-pin-5")).toBe(false);
  });
});

describe("brand hinges (values from manufacturer sources, see item files)", () => {
  it("Hettich Sensys: cup position follows the overlay (C = D − 12.5 + A)", () => {
    // Full overlay on 19 mm sides with a 1.5 mm side gap: A = 17.5 → C = 5 → cup centre 22.5.
    const p = partsByCode(buildOne({ options: { "hardware.hinge": "hettich-sensys-8645i-screw" } }));
    expect(bores(p.DO1!, "hettich-sensys-8645i-screw").map((b) => [b.v, b.d, b.depth])).toEqual([
      [22.5, 35, 12.8],
      [22.5, 35, 12.8],
    ]);
    const wider = partsByCode(
      buildOne({ vars: { front_gap: 6 }, options: { "hardware.hinge": "hettich-sensys-8645i-screw" } }),
    );
    expect(bores(wider.DO1!)[0]!.v).toBe(21); // A = 16 → C = 3.5
  });

  it("Hettich Sensys Flash: TH 52 × 5.5 dowels, Ø10 plate holes replace the Ø5 system holes", () => {
    const r = buildOne({ options: { "hardware.hinge": "hettich-sensys-8645i-flash" } });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const dowels = bores(p.DO1!).filter((b) => b.d === 10);
    expect(dowels.map((b) => [b.u, b.v])).toEqual([
      [63.5, 28],
      [115.5, 28],
      [607.5, 28],
      [659.5, 28],
    ]);
    const plate = bores(p.SL!, "hettich-sensys-8645i-flash");
    expect(plate.every((b) => b.d === 10 && b.depth === 13 && b.sources.length === 2)).toBe(true);
  });

  it("Blum CLIP top: TB = overlay − 11, INSERTA dowels 45 apart, 9.5 behind the cup", () => {
    const p = partsByCode(buildOne({ options: { "hardware.hinge": "blum-cliptop-110-inserta" } }));
    const b = bores(p.DO1!, "blum-cliptop-110-inserta");
    expect(b.filter((x) => x.d === 35).map((x) => x.v)).toEqual([24, 24]); // TB 6.5 + 17.5
    expect(b.filter((x) => x.d === 8).slice(0, 2).map((x) => [x.u, x.v])).toEqual([
      [67, 33.5],
      [112, 33.5],
    ]);
  });

  it("Grass Tiomos: TA = A − 15 + plate height (H2)", () => {
    const r = buildOne({ options: { "hardware.hinge": "grass-tiomos-110-screw" } });
    expect(r.diagnostics).toEqual([]);
    // A = 17.5, H = 2 → TA = 4.5 → cup centre 22.
    expect(bores(partsByCode(r).DO1!).map((b) => b.v)).toEqual([22, 22]);
  });

  it("rejects a door the hinge cannot reach", () => {
    const r = buildOne({ vars: { front_gap: 14 }, options: { "hardware.hinge": "blum-cliptop-110-inserta" } });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ code: "hardware_limit", params: expect.objectContaining({ name: "boring_distance", value: 1 }) }),
    );
    expect(r.ok).toBe(false);
  });
});
