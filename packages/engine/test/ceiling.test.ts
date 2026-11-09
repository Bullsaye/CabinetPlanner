import { describe, expect, it } from "vitest";
import { buildProject, ceilingAlong, cutlistRows, cutlistTable, loadProject, partDxf, type Part } from "../src/index.ts";

// 3 × 3 m room; the roof rises from wall D (west) at 45° from a 1000 knee wall up to the flat ceiling at 2500.
const room = {
  walls: [{ id: "A", length: 3000 }, { id: "B", length: 3000 }, { id: "C", length: 3000 }, { id: "D", length: 3000 }],
  ceiling: { slopes: [{ wall: "D", knee: 1000, angle: 45 }] },
};
const tall = (id: string) => ({
  id,
  type: "box",
  kind: "tall",
  presets: ["tall-unit"],
  vars: { W: 600, H: "ceiling_h - plinth_h - ceiling_gap", door_count: 1 },
  options: { ceiling_filler: "front" },
  place: { wall: "A" },
});
const build = () => buildProject(loadProject({ schemaVersion: 1, name: "Attic", room, cabinets: ["T01", "T02", "T03", "T04", "T05"].map(tall) }));

describe("sloped ceilings (D44)", () => {
  it("lays the ceiling as the lowest of the flat ceiling and the slopes", () => {
    const r = build();
    // Along wall A from x 0 to 3000 (rising away from wall D, then flat from x 1500).
    expect(ceilingAlong(r.room!.ceiling, [0, 0], [3000, 0])).toEqual([[0, 1000], [1500, 2500], [3000, 2500]]);
  });

  it("fits a row of tall units under the roof with ceiling_h and fills up to the slope", () => {
    const r = build();
    expect(r.diagnostics).toEqual([]);
    // Lowest ceiling over each carcase is at its left edge (x 0, 600, …): 1000 + x, at most 2500.
    const H = r.cabinets.map((c) => c.resolved.values.get("H"));
    expect(H).toEqual([1000 - 130, 1600 - 130, 2200 - 130, 2500 - 130, 2500 - 130]);
    // Fillers: flush with the doors, one gap above them, cut to the 45° line where it slopes.
    const pb = r.parts.filter((p) => p.role === "ceiling_filler");
    expect(pb.map((p) => p.id)).toEqual(["T01-PB", "T02-PB", "T03-PB", "T04-PB", "T05-PB"]);
    const t1 = pb[0]!;
    // T01: from x 1.5 to 598.5, ceiling 1001.5 … 1598.5 at the front, minus 100 plinth and the carcase top 870.
    expect(t1.outline).toEqual([[0, 0], [597, 0], [597, 628.5], [0, 31.5]]);
    expect([t1.length, t1.width]).toEqual([597, 628.5]);
    // T03 reaches the flat ceiling at x 1500 (300 into its width): a kink in the outline.
    expect(pb[2]!.outline).toEqual([[0, 0], [597, 0], [597, 330], [298.5, 330], [0, 31.5]]);
    // T04 and T05 sit under the flat ceiling: plain rectangles.
    expect(pb[3]!.outline).toBeUndefined();
  });

  it("puts the outline on the cutlist row, in the DXF contour", () => {
    const r = build();
    const rows = cutlistRows(r.parts, r.library, { group: true }).filter((x) => x.parts[0]!.endsWith("-PB"));
    expect(rows.filter((x) => x.outline).length).toBe(3);
    // The flag reaches the written cutlist: the sizes alone would read as a plain rectangle.
    const text = { locale: "en", header: (c: string) => c, role: () => "", shaped: "SHAPED" };
    const table = cutlistTable(rows, r.library, text, ["part", "length", "width", "note"]);
    expect(table.slice(1).map((x) => x.join(" "))).toEqual(["T01-PB 597 628.5 SHAPED", "T02-PB 597 628.5 SHAPED", "T03-PB 597 330 SHAPED", "T04-PB 597 30 ", "T05-PB 597 30 "]);
    const dxf = partDxf(r.parts.find((p) => p.id === "T01-PB")!, { W: 600, H: 870, D: 560 })[0]!.content;
    // Four contour vertices, the sloped edge from 31.5 to 628.5.
    expect(dxf).toContain("628.5");
    expect(dxf).toContain("31.5");
  });

  it("groups shaped parts only with parts of the same shape (D43)", () => {
    const r = buildProject(loadProject({ schemaVersion: 1, name: "S", cabinets: [{ id: "C1", type: "box", vars: { shelf_count: 3 } }] }));
    const shelves = r.parts.filter((p) => p.role === "shelf") as Part[];
    const [a, b, c] = shelves as [Part, Part, Part];
    const qty = (): number[] => cutlistRows(shelves, r.library, { group: true }).map((x) => x.qty);
    expect(qty()).toEqual([3]);
    // Same bounding rectangle, two different contours, one plain rectangle.
    a.outline = [[0, 0], [a.length, 0], [a.length, a.width], [0, a.width - 100]];
    b.outline = [[0, 0], [b.length, 0], [b.length, b.width - 100], [0, b.width]];
    expect(qty()).toEqual([1, 1, 1]);
    c.outline = [[0, 0], [c.length, 0], [c.length, c.width - 100], [0, c.width]];
    expect(qty()).toEqual([1, 2]);
  });

  it("warns when a cabinet reaches above the ceiling", () => {
    const r = buildProject(loadProject({ schemaVersion: 1, name: "A", room, cabinets: [{ ...tall("T01"), vars: { W: 600 } }] }));
    expect(r.diagnostics.map((d) => d.code)).toContain("room_above_ceiling");
  });
});
