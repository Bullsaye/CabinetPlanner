import { describe, expect, it } from "vitest";
import { partSvg, sceneOf, spread, type PartSvgText } from "../src/index.ts";
import { buildOne, partsByCode } from "./helpers.ts";

const text: PartSvgText = {
  title: "T",
  subtitle: "S",
  face: (f) => f,
  legend: { viewed: "a", opposite: "b", edge: "c", banded: "d", table: "e", count: "pcs" },
};

describe("label spreading", () => {
  it("keeps labels apart and leaves free ones alone", () => {
    expect(spread([0, 100, 200], 10)).toEqual([0, 100, 200]);
    const s = spread([100, 104], 10);
    expect(s[1]! - s[0]!).toBeCloseTo(10);
    expect((s[0]! + s[1]!) / 2).toBeCloseTo(102);
  });
});

describe("part drawing", () => {
  const r = buildOne();
  const p = partsByCode(r);

  it("draws every bore and the groove of the left side", () => {
    const svg = partSvg(p.SL!, text);
    const sl = p.SL!;
    const faceBores = sl.operations.filter((o) => o.kind === "bore" && (o.face === "t0" || o.face === "t1")).length;
    expect((svg.match(/<circle class="pd-op/g) ?? []).length - 2).toBe(faceBores); // minus 2 legend circles
    expect(svg).toContain('class="pd-pocket"');
    expect(svg).toContain("Ø5 × 13");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("draws edge bores as hidden rectangles", () => {
    const svg = partSvg(p.BO!, text);
    const edgeBores = p.BO!.operations.filter((o) => o.kind === "bore" && o.face.startsWith("w")).length;
    expect((svg.match(/<rect class="pd-op-far"/g) ?? []).length - 1).toBe(edgeBores); // minus legend
  });

  it("is deterministic and can omit the embedded style", () => {
    expect(partSvg(p.SL!, text)).toBe(partSvg(p.SL!, text));
    expect(partSvg(p.SL!, text, { style: false })).not.toContain("<style>");
  });
});

describe("scene", () => {
  it("puts bores on the part surface in cabinet coordinates, pointing inwards", () => {
    const scene = sceneOf(buildOne().cabinets[0]!);
    const sl = scene.parts.find((x) => x.code === "SL")!;
    for (const b of sl.bores) {
      expect(b.at.x).toBe(19); // inner face of the left side
      expect(b.dir).toEqual({ axis: "x", sign: -1 });
    }
    const door = scene.parts.find((x) => x.code === "DO1")!;
    expect(door.bores.every((b) => b.at.z === 560 && b.dir.axis === "z" && b.dir.sign === 1)).toBe(true);
    expect(sl.pockets[0]).toMatchObject({ x: 11, dx: 8, z: 9.75, dz: 8.5 });
  });
});
