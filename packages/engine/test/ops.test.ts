import { describe, expect, it } from "vitest";
import {
  addBore,
  addPocketFromBox,
  addThroughBore,
  resolveOpposing,
  checkOperations,
  entryFace,
  toCabinet,
  toLocal,
  type Part,
} from "../src/index.ts";

/** A left side: 720 high (Y = length), 560 deep (Z = width), 19 thick (X). */
function side(): Part {
  return {
    id: "T-SL",
    code: "SL",
    cabinet: "T",
    role: "side_left",
    material: "m",
    length: 720,
    width: 560,
    thickness: 19,
    cutLength: 720,
    cutWidth: 560,
    lengthAxis: "y",
    widthAxis: "z",
    grain: false,
    edges: { l1: null, l2: null, w1: null, w2: null },
    box: { x: 0, y: 0, z: 0, dx: 19, dy: 720, dz: 560 },
    operations: [],
  };
}
const src = { kind: "system" as const, ref: "test" };

describe("part-local coordinates", () => {
  it("maps cabinet axes to u (length), v (width), w (thickness)", () => {
    const p = side();
    p.box = { ...p.box, x: 581, y: 10, z: 5 };
    expect(toLocal(p, { x: 600, y: 110, z: 55 })).toEqual({ u: 100, v: 50, w: 19 });
    expect(toCabinet(p, { u: 100, v: 50, w: 19 })).toEqual({ x: 600, y: 110, z: 55 });
  });

  it("names the entry face from the drilling direction", () => {
    const p = side();
    expect(entryFace(p, "-x")).toBe("t1"); // inner face of a left side
    expect(entryFace(p, "+x")).toBe("t0");
    expect(entryFace(p, "-z")).toBe("l2"); // front edge
    expect(entryFace(p, "+y")).toBe("w1"); // bottom end
  });
});

describe("operations", () => {
  it("rejects bores whose entry is not on the part surface (rule bug)", () => {
    expect(() => addBore(side(), { x: 10, y: 100, z: 100 }, "-x", 5, 13, src)).toThrow(/not on face/);
  });

  it("merges identical bores and keeps both sources", () => {
    const p = side();
    addBore(p, { x: 19, y: 100, z: 523 }, "-x", 5, 13, src);
    addBore(p, { x: 19, y: 100, z: 523 }, "-x", 5, 11, { kind: "hardware", ref: "hinge" });
    expect(p.operations).toHaveLength(1);
    expect(p.operations[0]).toMatchObject({ depth: 13, sources: [src, { kind: "hardware", ref: "hinge" }] });
  });

  it("clips pockets to the part and picks the face they open to", () => {
    const p = side();
    const pocket = addPocketFromBox(p, { x0: 11, x1: 30, y0: -5, y1: 800, z0: 10, z1: 18 }, src)!;
    expect(pocket).toMatchObject({ face: "t1", u0: 0, u1: 720, v0: 10, v1: 18, w0: 11, w1: 19 });
    expect(addPocketFromBox(p, { x0: 100, x1: 200, y0: 0, y1: 1, z0: 0, z1: 1 }, src)).toBeUndefined();
  });

  it("refuses a pocket through the whole thickness", () => {
    expect(() => addPocketFromBox(side(), { x0: -1, x1: 20, y0: 0, y1: 10, z0: 0, z1: 10 }, src)).toThrow(/through/);
  });
});

describe("operation checks", () => {
  const codes = (p: Part): string[] => checkOperations(p, 2).map((d) => d.code);

  it("accepts a sound bore", () => {
    const p = side();
    addBore(p, { x: 19, y: 100, z: 523 }, "-x", 5, 13, src);
    expect(codes(p)).toEqual([]);
  });

  it("flags bores that are too deep or near an edge or outside", () => {
    const deep = side();
    addBore(deep, { x: 19, y: 100, z: 300 }, "-x", 5, 18, src);
    expect(codes(deep)).toEqual(["bore_too_deep"]);

    const edge = side();
    addBore(edge, { x: 19, y: 100, z: 558 }, "-x", 5, 13, src);
    expect(codes(edge)).toEqual(["bore_outside_part"]);

    const near = side();
    addBore(near, { x: 19, y: 100, z: 556 }, "-x", 5, 13, src); // 1.5 mm wall to the front edge
    expect(codes(near)).toEqual(["bore_too_close_to_edge"]);
  });

  it("flags edge bores that break out of the faces", () => {
    const p = side();
    addBore(p, { x: 3, y: 0, z: 300 }, "+y", 8, 25, src); // Ø8 centred 3 mm from a face
    expect(codes(p)).toEqual(["bore_outside_part"]);
  });

  it("flags overlapping operations", () => {
    const p = side();
    addBore(p, { x: 19, y: 100, z: 300 }, "-x", 8, 12, src);
    addBore(p, { x: 19, y: 104, z: 300 }, "-x", 5, 13, src);
    expect(codes(p)).toEqual(["ops_collide"]);

    const q = side();
    addPocketFromBox(q, { x0: 11, x1: 19, y0: 0, y1: 720, z0: 10, z1: 18 }, src);
    addBore(q, { x: 19, y: 100, z: 20 }, "-x", 8, 12, src);
    expect(codes(q)).toEqual(["ops_collide"]);
  });
});

describe("through holes (D23)", () => {
  const panel = (): Part => {
    // A middle panel: 720 high, 560 deep, 19 thick, standing at x 300–319.
    const p = side();
    p.box = { ...p.box, x: 300 };
    return p;
  };

  it("drills a through hole from one face, or from both faces meeting in the middle", () => {
    const a = panel();
    addThroughBore(a, { x: 319, y: 100, z: 300 }, "-x", 5, "one_side", 1, src);
    expect(a.operations).toMatchObject([{ face: "t1", depth: 19, through: true }]);
    expect(checkOperations(a, 2)).toEqual([]);

    const b = panel();
    addThroughBore(b, { x: 319, y: 100, z: 300 }, "-x", 5, "both_sides", 1, src);
    expect(b.operations).toMatchObject([
      { face: "t1", depth: 10, split: true },
      { face: "t0", depth: 10, split: true },
    ]);
    expect(checkOperations(b, 2)).toEqual([]);
  });

  it("resolves shelf-pin holes from both faces of a middle panel", () => {
    const make = (): Part => {
      const p = panel();
      addBore(p, { x: 300, y: 100, z: 523 }, "+x", 5, 13, src);
      addBore(p, { x: 319, y: 100, z: 523 }, "-x", 5, 13, src);
      return p;
    };
    const err = make();
    expect(resolveOpposing(err, "error", 1, 2)).toBe(0);
    expect(checkOperations(err, 2).map((d) => d.code)).toContain("ops_collide");

    const both = make();
    expect(resolveOpposing(both, "both_sides", 1, 2)).toBe(1);
    expect(both.operations.map((o) => (o as { depth: number }).depth)).toEqual([10, 10]);
    expect(checkOperations(both, 2)).toEqual([]);

    const thru = make();
    resolveOpposing(thru, "through", 1, 2);
    expect(thru.operations).toMatchObject([{ face: "t0", through: true, depth: 19 }]);
    expect(checkOperations(thru, 2)).toEqual([]);
  });

  it("leaves holes alone that keep enough material between them", () => {
    const p = panel();
    addBore(p, { x: 300, y: 100, z: 523 }, "+x", 5, 8, src);
    addBore(p, { x: 319, y: 100, z: 523 }, "-x", 5, 8, src);
    expect(resolveOpposing(p, "both_sides", 1, 2)).toBe(0);
  });
});
