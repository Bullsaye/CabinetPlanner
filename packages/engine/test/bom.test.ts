import { describe, expect, it } from "vitest";
import {
  BOM_COLUMNS,
  bomCsv,
  bomTable,
  buildBom,
  buildProject,
  BUNDLED,
  formatLengths,
  loadProject,
  partArea,
  type BomText,
} from "../src/index.ts";
import { buildOne } from "./helpers.ts";

const text: BomText = {
  locale: "en",
  header: (c) => c,
  section: (s) => s,
  unit: (u) => u,
  total: (of) => `sum ${of}`,
  unpriced: (n) => `${n} unpriced`,
};

const factory = (id: string) => BUNDLED.hardware.find((h) => h.id === id)!;
const priced = {
  materials: [
    { id: "mel-white-19", name: "Melamine", thickness: 19, pricePerM2: 10 },
    { id: "hdf-white-8", name: "HDF", thickness: 8, pricePerM2: 5 },
    { id: "mdf-lacquer-19", name: "MDF", thickness: 19, pricePerM2: 40 },
  ],
  edgebands: [{ id: "abs-white-1", name: "ABS", thickness: 1, width: 23, code: "W1", pricePerM: 0.4 }],
  hardware: [
    { ...factory("dowel-8x35"), bom: { perPlacement: 1, unit: "pcs", price: 0.03 } },
    { ...factory("generic-hinge-110"), bom: { perPlacement: 1, unit: "pcs", price: 3.5 } },
  ],
};

/*
 * The factory box without a shelf (600 × 720 × 560, one door), by hand:
 *   melamine 19: 2 sides 720 × 560, bottom 562 × 560, 2 rails 562 × 100
 *                = 806 400 + 314 720 + 112 400 = 1 233 520 mm²
 *   HDF 8:       back 707 × 576 = 407 232 mm²
 *   MDF 19:      door 717 × 597 = 428 049 mm²
 *   edgeband:    front edges 720 + 720 + 562 + 562, door 2 × 717 + 2 × 597
 *                = 5 192 mm on 8 edges
 */
describe("bill of materials", () => {
  it("sums net areas from finished sizes and adds the waste factor (15 % by default)", () => {
    const bom = buildBom(buildOne({ vars: { shelf_count: 0 } }));
    expect(bom.materials).toEqual([
      { material: "hdf-white-8", thickness: 8, parts: 1, netArea: 0.41, grossArea: 0.47 }, // 0.407232 × 1.15 = 0.4683
      { material: "mdf-lacquer-19", thickness: 19, parts: 1, netArea: 0.43, grossArea: 0.49 }, // 0.428049 × 1.15 = 0.4923
      { material: "mel-white-19", thickness: 19, parts: 5, netArea: 1.23, grossArea: 1.42 }, // 1.23352 × 1.15 = 1.4185
    ]);
  });

  it("sums banded edge lengths and adds the allowance per edge (50 mm by default)", () => {
    const bom = buildBom(buildOne({ vars: { shelf_count: 0 } }));
    // 5.192 m net, + 8 × 0.05 m
    expect(bom.edgebands).toEqual([{ edgeband: "abs-white-1", edges: 8, netLength: 5.19, length: 5.59 }]);
  });

  it("takes waste and allowance from the variables", () => {
    const none = buildBom(buildOne({ vars: { shelf_count: 0 } }, { vars: { waste_pct: 0, edge_allowance: 0 } }));
    expect(none.materials.map((m) => m.grossArea)).toEqual(none.materials.map((m) => m.netArea));
    expect(none.edgebands[0]!.length).toBe(5.19);
    const more = buildBom(buildOne({ vars: { shelf_count: 0, waste_pct: 30, edge_allowance: 100 } }));
    expect(more.materials.find((m) => m.material === "mel-white-19")!.grossArea).toBe(1.6); // 1.23352 × 1.3 = 1.6036
    expect(more.edgebands[0]!.length).toBe(5.99); // 5.192 + 8 × 0.1
  });

  it("prices rows as rounded quantity × unit price and totals the rows", () => {
    const bom = buildBom(buildOne({ vars: { shelf_count: 0 } }, { library: priced }));
    expect(bom.materials.map((m) => [m.material, m.pricePerM2, m.cost])).toEqual([
      ["hdf-white-8", 5, 2.35], // 0.47 × 5
      ["mdf-lacquer-19", 40, 19.6], // 0.49 × 40
      ["mel-white-19", 10, 14.2], // 1.42 × 10
    ]);
    expect(bom.edgebands[0]!.cost).toBe(2.24); // 5.59 × 0.4 = 2.236
    expect(bom.hardware).toEqual([
      { item: "dowel-8x35", article: "", category: "connector", qty: 16, unit: "pcs", lengths: [], price: 0.03, cost: 0.48 },
      { item: "generic-hinge-110", article: "", category: "hinge", qty: 2, unit: "pcs", lengths: [], price: 3.5, cost: 7 },
      { item: "generic-leg-100", article: "", category: "leg", qty: 4, unit: "pcs", lengths: [] },
    ]);
    expect(bom.totals).toEqual({
      material: 36.15,
      edgeband: 2.24,
      hardware: 7.48,
      total: 45.87,
      unpriced: { material: 0, edgeband: 0, hardware: 1 },
    });
    // Per cabinet from unrounded quantities: 14.1855 + 2.3416 + 19.6903 = 36.22; 5.592 × 0.4 = 2.24.
    expect(bom.cabinets).toEqual([{ cabinet: "C1", name: "", netArea: 2.07, material: 36.22, edgeband: 2.24, hardware: 7.48, total: 45.94 }]);
  });

  it("sums hardware over cabinets, keeps variant articles apart and collects cut lengths", () => {
    const r = buildProject(
      loadProject({
        schemaVersion: 1,
        name: "t",
        cabinets: [
          { id: "A1", type: "box" },
          { id: "A2", type: "box", vars: { W: 450 } },
          { id: "T1", type: "box", kind: "tall", presets: ["tall-unit", "wardrobe"], vars: { W: 1000 } },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    // Lift fittings come in variants by weight; two cabinets may need different articles.
    r.cabinets[0]!.hardware.push({ item: "hettich-lift-advanced-hk", qty: 1, unit: "sets", article: "9302191" });
    r.cabinets[1]!.hardware.push({ item: "hettich-lift-advanced-hk", qty: 1, unit: "sets", article: "9302190" });
    r.cabinets[2]!.hardware.push({ item: "hettich-lift-advanced-hk", qty: 2, unit: "sets", article: "9302191" });
    const bom = buildBom(r);
    const perCabinet = (id: string): number => r.cabinets.reduce((a, c) => a + c.hardware.filter((h) => h.item === id).reduce((b, h) => b + h.qty, 0), 0);
    for (const row of bom.hardware.filter((h) => h.item !== "hettich-lift-advanced-hk")) expect(row.qty, row.item).toBe(perCabinet(row.item));
    expect(bom.hardware.filter((h) => h.item === "hettich-lift-advanced-hk").map((h) => [h.article, h.qty])).toEqual([
      ["9302190", 1],
      ["9302191", 3],
    ]);
    expect(bom.hardware.find((h) => h.item === "generic-wardrobe-rail")).toMatchObject({ qty: 1, lengths: [960] });
    // Consumables first, legs last.
    expect(bom.hardware[0]!.category).toBe("connector");
    expect(bom.hardware.at(-1)!.category).toBe("leg");
  });

  it("counts non-rectangular parts with their bounding rectangle (D43)", () => {
    const r = buildOne({ vars: { shelf_count: 0 } });
    const before = buildBom(r);
    const door = r.parts.find((p) => p.role === "door")!;
    door.outline = [
      [0, 0],
      [door.length, 0],
      [0, door.width],
    ];
    expect(partArea(door)).toBe(717 * 597);
    expect(buildBom(r)).toEqual(before);
  });

  it("includes worktops and plinth panels of the room, with the project's waste factor", () => {
    const r = buildProject(
      loadProject({
        schemaVersion: 1,
        name: "t",
        vars: { waste_pct: 10 },
        room: { walls: [{ id: "A", length: 3000 }] },
        cabinets: [{ id: "B1", type: "box", presets: ["base-unit"], vars: { waste_pct: 0 }, place: { wall: "A" } }],
      }),
    );
    const top = r.parts.find((p) => p.role === "worktop")!;
    const bom = buildBom(r);
    const row = bom.materials.find((m) => m.material === top.material)!;
    const net = (top.length * top.width) / 1e6;
    expect(row.parts).toBe(1);
    expect(row.netArea).toBeCloseTo(net, 2);
    expect(row.grossArea).toBeCloseTo(net * 1.1, 2);
    // The cabinet itself asks for no waste.
    const carcase = bom.materials.find((m) => m.material === "mel-white-19")!;
    const plinthToo = r.parts.filter((p) => p.material === "mel-white-19" && p.cabinet === "ROOM").length;
    if (!plinthToo) expect(carcase.grossArea).toBe(carcase.netArea);
    expect(bom.cabinets.map((c) => c.cabinet)).toEqual(["B1", "ROOM"]);
    expect(bom.materials.reduce((a, m) => a + m.parts, 0)).toBe(r.parts.length);
  });

  it("is deterministic and independent of the cabinet order for the totals", () => {
    const cabinets = [
      { id: "A1", type: "box" },
      { id: "A2", type: "box", vars: { W: 450, shelf_count: 3 } },
    ];
    const a = buildBom(buildProject(loadProject({ schemaVersion: 1, name: "t", cabinets })));
    const b = buildBom(buildProject(loadProject({ schemaVersion: 1, name: "t", cabinets: [...cabinets].reverse() })));
    expect({ ...b, cabinets: [] }).toEqual({ ...a, cabinets: [] });
  });
});

describe("bill of materials writer", () => {
  it("writes one table with sections and totals", () => {
    const r = buildOne({ vars: { shelf_count: 0 } }, { library: priced });
    const csv = bomCsv(buildBom(r), r, text, { cabinets: true });
    expect(csv).toBe(
      [
        "section,item,name,article,count,net,qty,unit,price,cost,note",
        "material,hdf-white-8,HDF,,1,0.41,0.47,m2,5,2.35,",
        "material,mdf-lacquer-19,MDF,,1,0.43,0.49,m2,40,19.6,",
        "material,mel-white-19,Melamine,,5,1.23,1.42,m2,10,14.2,",
        "edgeband,abs-white-1,ABS,,8,5.19,5.59,m,0.4,2.24,",
        "hardware,dowel-8x35,Dowel Ø8 × 35,,,,16,pcs,0.03,0.48,",
        "hardware,generic-hinge-110,Cup hinge 110° (generic),,,,2,pcs,3.5,7,",
        "hardware,generic-leg-100,Adjustable leg 100 (generic),,,,4,pcs,,,",
        "cabinet,C1,,,,2.07,,m2,,45.94,",
        "total,,sum material,,,,,,,36.15,",
        "total,,sum edgeband,,,,,,,2.24,",
        "total,,sum hardware,,,,,,,7.48,1 unpriced",
        "total,,sum all,,,,,,,45.87,1 unpriced",
        "",
      ].join("\n"),
    );
  });

  it("leaves sums empty when nothing has a price, and honours columns and delimiter", () => {
    const r = buildOne({ vars: { shelf_count: 0 } });
    const table = bomTable(buildBom(r), r, text);
    expect(table[0]).toEqual([...BOM_COLUMNS]);
    expect(table.at(-1)).toEqual(["total", "", "sum all", "", "", "", "", "", "", "", "7 unpriced"]);
    const csv = bomCsv(buildBom(r), r, text, { delimiter: ";", columns: ["item", "qty", "unit"] });
    expect(csv.split("\n")[1]).toBe("hdf-white-8;0.47;m2");
  });

  it("formats cut lengths", () => {
    expect(formatLengths([562, 562, 762.5])).toBe("2× 562 mm, 1× 762.5 mm");
    expect(formatLengths([])).toBe("");
  });
});
