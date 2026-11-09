import { describe, expect, it } from "vitest";
import { buildOne, partsByCode, size } from "./helpers.ts";
import { cutlistRows } from "../src/index.ts";

const codes = (r: ReturnType<typeof buildOne>): string[] => r.diagnostics.map((d) => `${d.severity}:${d.code}`);
const bores = (p: { operations: { kind: string; sources: { kind: string; ref: string }[] }[] }, ref: string): number =>
  p.operations.filter((o) => o.kind === "bore" && o.sources.some((s) => s.ref === ref)).length;

describe("cabinet parameters (D45)", () => {
  it("a parameter default is a value under the cabinet's own; formulas may use it", () => {
    const cab = {
      vars: { W: 800, H: "2 * niche + 100" },
      params: [{ name: "niche", label: { en: "Niche height", de: "Nischenhöhe" }, default: 310, min: 100, max: 600 }],
    };
    const r = buildOne(cab);
    expect(r.cabinets[0]!.resolved.values.get("H")).toBe(720);
    const v = r.cabinets[0]!.resolved.vars.get("niche")!;
    expect(v.source).toEqual({ layer: "cabinet", param: true });
    expect(v.known).toBe(false);

    const own = buildOne({ ...cab, vars: { ...cab.vars, niche: 350 } });
    expect(own.cabinets[0]!.resolved.values.get("H")).toBe(800);
    expect(own.cabinets[0]!.resolved.vars.get("niche")!.inherited).toEqual({ input: 310, source: { layer: "cabinet", param: true } });
  });

  it("limits of a parameter are checked like catalogue limits", () => {
    const r = buildOne({ vars: { niche: 50 }, params: [{ name: "niche", default: 310, min: 100, integer: true }] });
    expect(codes(r)).toContain("error:var_below_min");
    const f = buildOne({ vars: { n: 2.5 }, params: [{ name: "n", default: 2, integer: true, unit: "count" }] });
    expect(codes(f)).toContain("error:var_not_integer");
  });

  it("a parameter may not shadow a material constant", () => {
    expect(codes(buildOne({ params: [{ name: "mat_carcase_t", default: 5 }] }))).toContain("error:var_shadows_constant");
  });
});

describe("free parts (D45)", () => {
  it("places a board by formulas; thickness follows the material; edges by cabinet direction", () => {
    const r = buildOne({
      vars: { W: 800, D: 500, shelf_count: 0 },
      construction: {
        parts: [{ id: "MB", name: "Mittelboden", plane: "horizontal", x: "t_carcase", y: "H / 2", z: "t_back + 20", dx: "W - 2 * t_carcase", dz: "D - t_back - 20 - 10", edges: { front: "edge.carcase" } }],
      },
    });
    expect(codes(r)).toEqual([]);
    const p = partsByCode(r)["MB"]!;
    expect(p.id).toBe("C1-MB");
    expect(p.role).toBe("custom");
    expect(size(p)).toBe("762 × 462 × 19");
    expect(p.box).toEqual({ x: 19, y: 360, z: 28, dx: 762, dy: 19, dz: 462 });
    expect([p.lengthAxis, p.widthAxis]).toEqual(["x", "z"]);
    // Front edge = high end of the width axis = l2; deducted from the cut width.
    expect(p.edges).toEqual({ l1: null, l2: "abs-white-1", w1: null, w2: null });
    expect(p.cutWidth).toBe(461);
    expect(p.label).toBe("Mittelboden");
    expect(cutlistRows(r.parts, r.library).find((x) => x.part === "C1-MB")!.label).toBe("Mittelboden");
  });

  it("joins the ends of a free part to the panels they meet, like a fixed shelf", () => {
    const r = buildOne({
      vars: { W: 800, D: 500, shelf_count: 0 },
      options: { system_holes: "none" },
      construction: { parts: [{ id: "MB", plane: "horizontal", x: "t_carcase", y: 300, z: 40, dx: "W - 2 * t_carcase", dz: "D - 40" }] },
    });
    expect(codes(r)).toEqual([]);
    const parts = partsByCode(r);
    const n = bores(parts["MB"]!, "SL-MB");
    expect(n).toBeGreaterThanOrEqual(2);
    expect(bores(parts["SL"]!, "SL-MB")).toBe(n);
    expect(bores(parts["SR"]!, "SR-MB")).toBe(n);
    // Dowel holes in the side sit at mid-thickness of the free part.
    const b = parts["SL"]!.operations.find((o) => o.kind === "bore" && o.sources.some((s) => s.ref === "SL-MB"))! as { u: number };
    expect(b.u).toBe(309.5);
    // The dowels are in the hardware list.
    const plain = buildOne({ vars: { W: 800, D: 500, shelf_count: 0 }, options: { system_holes: "none" } });
    const dowels = (x: typeof r): number => x.cabinets[0]!.hardware.find((h) => h.item.startsWith("dowel"))!.qty;
    expect(dowels(r)).toBe(dowels(plain) + 2 * n);
  });

  it("joint: none leaves the part loose", () => {
    const r = buildOne({
      vars: { shelf_count: 0 },
      construction: { parts: [{ id: "MB", plane: "horizontal", x: "t_carcase", y: 300, z: 40, dx: "W - 2 * t_carcase", dz: 300, joint: "none" }] },
    });
    expect(partsByCode(r)["MB"]!.operations).toEqual([]);
  });

  it("a vertical free part standing on the bottom is joined to it; free parts join each other", () => {
    const r = buildOne({
      vars: { W: 900, shelf_count: 0 },
      options: { system_holes: "none", top: "full" },
      construction: {
        parts: [
          { id: "V", plane: "vertical", x: 400, y: "t_carcase", z: 40, dy: "H - 2 * t_carcase", dz: "D - 40" },
          { id: "Q", plane: "horizontal", x: "t_carcase", y: 300, z: 40, dx: "400 - t_carcase", dz: "D - 40" },
        ],
      },
    });
    expect(codes(r)).toEqual([]);
    const parts = partsByCode(r);
    expect(bores(parts["V"]!, "BO-V")).toBeGreaterThanOrEqual(2);
    expect(bores(parts["V"]!, "TO-V")).toBeGreaterThanOrEqual(2);
    expect(bores(parts["Q"]!, "V-Q")).toBeGreaterThanOrEqual(2);
    expect(bores(parts["V"]!, "V-Q")).toBe(bores(parts["Q"]!, "V-Q"));
    expect(bores(parts["Q"]!, "SL-Q")).toBeGreaterThanOrEqual(2);
  });

  it("repeat makes numbered copies that see i and n; when switches a part off", () => {
    const r = buildOne({
      vars: { W: 600, H: 2000, shelf_count: 0, door_count: 0, slats: 3 },
      params: [{ name: "slats", default: 2, integer: true, unit: "count" }],
      construction: {
        parts: [
          { id: "L", plane: "frontal", x: "t_carcase", y: "i * H / (n + 1)", z: "D - t_carcase", dx: "W - 2 * t_carcase", dy: 80, repeat: "slats", joint: "none" },
          { id: "OFF", plane: "horizontal", dx: 100, dz: 100, when: "slats > 5" },
        ],
      },
    });
    expect(codes(r)).toEqual([]);
    const parts = partsByCode(r);
    expect(Object.keys(parts).filter((c) => /^L\d$/.test(c))).toEqual(["L1", "L2", "L3"]);
    expect(parts["L2"]!.box.y).toBe(1000);
    expect(parts["OFF"]).toBeUndefined();
  });

  it("reports bad formulas, reserved and duplicate codes instead of throwing", () => {
    const r = buildOne({
      construction: {
        parts: [
          { id: "A", plane: "horizontal", dx: "nope * 2", dz: 100 },
          { id: "B", plane: "horizontal", dz: 100 },
          { id: "SL", plane: "vertical", dy: 100, dz: 100 },
          { id: "SH2", plane: "vertical", dy: 100, dz: 100 },
          { id: "K", plane: "vertical", x: 100, y: 19, dy: 100, dz: 100, joint: "none" },
          { id: "K", plane: "vertical", x: 200, y: 19, dy: 100, dz: 100, joint: "none" },
          { id: "M", plane: "vertical", x: 300, y: 19, dy: 100, dz: 100, material: "no-such-board" },
          { id: "N", plane: "vertical", x: 300, y: 19, dy: -5, dz: 100, joint: "none" },
          { id: "R", plane: "vertical", x: 300, y: 19, dy: 5, dz: 100, repeat: "1.5" },
        ],
      },
    });
    const c = codes(r);
    expect(c.filter((x) => x === "error:custom_part_invalid")).toHaveLength(3);
    expect(c.filter((x) => x === "error:custom_part_code_reserved")).toHaveLength(2);
    expect(c).toContain("error:custom_part_duplicate");
    expect(c).toContain("error:material_unknown");
    expect(c).toContain("error:part_nonpositive");
    expect(r.ok).toBe(false);
  });

  it("omit leaves box parts out, with their joints, grooves and fittings", () => {
    const full = buildOne({ vars: { shelf_count: 1 } });
    const r = buildOne({ vars: { shelf_count: 1 }, options: { top: "full" }, construction: { omit: ["TO", "BK", "DO1", "XX"] } });
    expect(codes(r)).toEqual(["warning:construction_omit_unknown"]);
    const parts = partsByCode(r);
    expect(parts["TO"]).toBeUndefined();
    expect(parts["BK"]).toBeUndefined();
    expect(parts["DO1"]).toBeUndefined();
    expect(parts["SL"]!.operations.some((o) => o.kind === "pocket")).toBe(false);
    expect(parts["SL"]!.operations.some((o) => o.sources.some((s) => s.ref === "SL-TO"))).toBe(false);
    expect(r.cabinets[0]!.hardware.some((h) => h.item.includes("hinge"))).toBe(false);
    expect(full.cabinets[0]!.hardware.some((h) => h.item.includes("hinge"))).toBe(true);
  });

  it("a piece of furniture from free parts only: everything of the box left out", () => {
    // A bench: two cheeks, a seat between them, a stretcher.
    const r = buildOne({
      vars: { W: 1200, H: 450, D: 380, shelf_count: 0, door_count: 0, plinth_h: 0 },
      options: { back_mount: "none", system_holes: "none", "hardware.leg": null },
      construction: {
        omit: ["SL", "SR", "BO", "RF", "RR"],
        parts: [
          { id: "WL", name: { en: "Cheek left", de: "Wange links" }, plane: "vertical", x: 0, y: 0, z: 0, dy: "H", dz: "D" },
          { id: "WR", name: { en: "Cheek right", de: "Wange rechts" }, plane: "vertical", x: "W - t_carcase", y: 0, z: 0, dy: "H", dz: "D" },
          { id: "SI", plane: "horizontal", x: "t_carcase", y: "H - t_carcase", z: 0, dx: "W - 2 * t_carcase", dz: "D" },
          { id: "ST", plane: "frontal", x: "t_carcase", y: 100, z: "D / 2 - t_carcase / 2", dx: "W - 2 * t_carcase", dy: 120 },
        ],
      },
    });
    expect(codes(r)).toEqual([]);
    expect(r.parts.map((p) => p.code)).toEqual(["WL", "WR", "SI", "ST"]);
    const parts = partsByCode(r);
    expect(bores(parts["SI"]!, "WL-SI")).toBeGreaterThanOrEqual(2);
    // The stretcher stands across: its joint runs along Y.
    const st = bores(parts["ST"]!, "WL-ST");
    expect(st).toBeGreaterThanOrEqual(2);
    expect(bores(parts["WL"]!, "WL-ST")).toBe(st);
  });
});

describe("free bores and extra hardware (D45)", () => {
  it("drills a row of holes by formula on a face of any part", () => {
    const r = buildOne({
      options: { system_holes: "none" },
      vars: { shelf_count: 0 },
      construction: { bores: [{ part: "SL", face: "t1", u: "200 + (i - 1) * 64", v: "part_w / 2", d: 8, depth: 12, repeat: 3 }] },
    });
    expect(codes(r)).toEqual([]);
    const ops = partsByCode(r)["SL"]!.operations.filter((o) => o.sources.some((s) => s.kind === "custom"));
    expect(ops.map((o) => (o as { u: number }).u)).toEqual([200, 264, 328]);
    expect(ops[0]).toMatchObject({ kind: "bore", face: "t1", v: 280, w: 19, d: 8, depth: 12 });
  });

  it("depth 0 or more than the thickness drills through", () => {
    const r = buildOne({ options: { system_holes: "none" }, vars: { shelf_count: 0 }, construction: { bores: [{ part: "SL", face: "t0", u: 300, v: 300, d: 6, depth: "through" }] } });
    expect(codes(r)).toEqual([]);
    const op = partsByCode(r)["SL"]!.operations.find((o) => o.sources.some((s) => s.kind === "custom"))!;
    expect(op).toMatchObject({ through: true });
  });

  it("reports bores outside the part, unknown parts and collisions", () => {
    const r = buildOne({
      vars: { shelf_count: 0 },
      construction: {
        bores: [
          { part: "SL", u: 5000, v: 10, d: 5, depth: 5 },
          { part: "ZZ", u: 10, v: 10, d: 5, depth: 5 },
          { part: "SL", u: "foo", v: 10, d: 5, depth: 5 },
          { part: "SL", face: "l2", u: 100, v: 9.5, d: 5, depth: 2000 },
        ],
      },
    });
    const c = codes(r);
    expect(c.filter((x) => x === "error:custom_bore_outside")).toHaveLength(2);
    expect(c).toContain("warning:custom_bore_part_unknown");
    expect(c).toContain("error:custom_bore_invalid");
  });

  it("an edge bore enters the edge at mid-thickness", () => {
    const r = buildOne({ options: { system_holes: "none" }, vars: { shelf_count: 0 }, construction: { bores: [{ part: "SL", face: "l2", u: 360, v: "part_t / 2", d: 5, depth: 20 }] } });
    expect(codes(r)).toEqual([]);
    const op = partsByCode(r)["SL"]!.operations.find((o) => o.sources.some((s) => s.kind === "custom"))!;
    expect(op).toMatchObject({ face: "l2", u: 360, w: 9.5, depth: 20 });
  });

  it("extra hardware lands in the hardware list, quantity by formula", () => {
    const r = buildOne({ vars: { W: 900 }, construction: { hardware: [{ item: "generic-knob", qty: "ceil(W / 400)" }, { item: "nope" }] } });
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "generic-knob")!.qty).toBe(3);
    expect(codes(r)).toContain("error:hardware_unknown");
  });
});

describe("parameters in presets, layout variables, fittings (D45)", () => {
  const lock = {
    id: "lock-a",
    name: "Lock A",
    category: "other",
    params: { backset: 25 },
    drilling: [
      { mount: "part", d: 19, depth: 0, a: 0, b: "backset", through: true },
      { mount: "part", d: 3, depth: 8, a: 20, b: "backset + 10" },
    ],
  };
  const lib = (extra: Record<string, unknown> = {}) => ({ library: { hardware: [lock], ...extra } });

  it("a preset brings its own variable with label, description and default; the cabinet may change the value", () => {
    const preset = {
      id: "inset",
      name: "Boden zurückgesetzt",
      vars: { fixed_shelf_setback: "board_inset" },
      params: [{ name: "board_inset", label: "Einsprung vorne", description: "Querboden springt von der Vorderkante zurück", default: 2, min: 0, max: 100 }],
    };
    const fronts = [{ type: "open" }, { type: "door", h: 300 }];
    const r = buildOne({ presets: ["inset"], fronts }, { library: { presets: [preset] } });
    expect(codes(r)).toEqual([]);
    const rc = r.cabinets[0]!.resolved;
    expect(rc.params.map((p) => p.name)).toEqual(["board_inset"]);
    expect(rc.vars.get("board_inset")!.source).toEqual({ layer: "cabinet", preset: "inset", param: true });
    const fs = partsByCode(r)["FS1"]!;
    expect(fs.box.z + fs.box.dz).toBe(558);
    // 50 mm instead: the board and its dowels move back together.
    const r50 = buildOne({ presets: ["inset"], fronts, vars: { board_inset: 50 } }, { library: { presets: [preset] } });
    const fs50 = partsByCode(r50)["FS1"]!;
    expect(fs50.box.z + fs50.box.dz).toBe(510);
    const firstDowel = (x: typeof r): number => Math.max(...partsByCode(x)["SL"]!.operations.filter((o) => o.sources.some((s) => s.ref === "SL-FS1")).map((o) => (o as { v: number }).v));
    expect(firstDowel(r) - firstDowel(r50)).toBe(48);
    // The preset applied at project level reaches every cabinet.
    const p = buildOne({ fronts }, { presets: ["inset"], library: { presets: [preset] } });
    expect(p.cabinets[0]!.resolved.params).toHaveLength(1);
    expect(p.cabinets[0]!.resolved.values.get("fixed_shelf_setback")).toBe(2);
  });

  it("a free board ends at the back whatever the back rule is (back_front_z)", () => {
    const part = { id: "QB", plane: "horizontal", x: "inner_x0", y: 300, z: "back_front_z", dx: "inner_x1 - inner_x0", dz: "D - back_front_z - 2" };
    const groove = partsByCode(buildOne({ vars: { shelf_count: 0 }, construction: { parts: [part] } }))["QB"]!;
    expect(groove.box.z).toBe(18);
    const rebate = partsByCode(buildOne({ vars: { shelf_count: 0 }, options: { back_mount: "rebate" }, construction: { parts: [part] } }))["QB"]!;
    expect(rebate.box.z).toBe(8);
    expect(rebate.box.z + rebate.box.dz).toBe(558);
  });

  it("one bore on the inner face of both sides is a mirrored pair", () => {
    const r = buildOne({ options: { system_holes: "none" }, vars: { shelf_count: 0 }, construction: { bores: [{ part: ["SL", "SR"], u: 400, v: "part_w - 50", d: 5, depth: 12 }] } });
    expect(codes(r)).toEqual([]);
    const op = (c: string) => partsByCode(r)[c]!.operations.find((o) => o.sources.some((s) => s.kind === "custom"))!;
    expect(op("SL")).toMatchObject({ face: "t1", u: 400, v: 510 });
    expect(op("SR")).toMatchObject({ face: "t0", u: 400, v: 510 });
  });

  it("a placed fitting drills the item's pattern; mirror flips it; swapping the item swaps the holes", () => {
    const cab = (item: string) => ({
      vars: { W: 800, door_count: 2, shelf_count: 0 },
      construction: {
        fittings: [
          { item, part: "DO1", face: "inner", u: "part_l / 2", v: 0 },
          { item, part: "DO2", face: "inner", u: "part_l / 2", v: 0, mirror: true },
        ],
      },
    });
    const r = buildOne(cab("lock-a"), lib());
    expect(codes(r)).toEqual([]);
    const holes = (x: typeof r, c: string) =>
      partsByCode(x)[c]!.operations.filter((o) => o.sources.some((s) => s.ref === "lock-a" || s.ref === "lock-b")).map((o) => [(o as { d: number }).d, (o as { v: number }).v]).sort((a, b) => b[0]! - a[0]!);
    const w = partsByCode(r)["DO2"]!.width;
    expect(holes(r, "DO1")).toEqual([[19, 25], [3, 35]]);
    expect(holes(r, "DO2")).toEqual([[19, w - 25], [3, w - 35]]);
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "lock-a")!.qty).toBe(2);
    const other = { ...lock, id: "lock-b", params: { backset: 40 } };
    const b = buildOne(cab("lock-b"), { library: { hardware: [other] } });
    expect(holes(b, "DO1")).toEqual([[19, 40], [3, 50]]);
  });

  it("fittings report unknown items, parts and holes off the part", () => {
    const r = buildOne({ construction: { fittings: [{ item: "nope", part: "SL", u: 1, v: 1 }, { item: "lock-a", part: "ZZ", u: 1, v: 1 }, { item: "lock-a", part: "SL", u: 100, v: "part_w" }] } }, lib());
    const c = codes(r);
    expect(c).toContain("error:hardware_unknown");
    expect(c).toContain("warning:fitting_part_unknown");
    expect(c).toContain("error:fitting_outside");
  });
});
