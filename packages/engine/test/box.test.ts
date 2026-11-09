import { describe, expect, it } from "vitest";
import { buildOne, partsByCode, size } from "./helpers.ts";

/*
 * Expected values below are derived by hand from the rules in DECISIONS.md.
 * They are NOT yet verified against a cabinet built in the shop; replace
 * with measured reference cabinets when available.
 *
 * Factory defaults: W 600, H 720, D 560, 19 mm carcase, 8 mm back in a groove
 * 10 mm from the rear and 8 mm deep with 1 mm play, rails 100, one shelf,
 * one door, front gap 3, 1 mm edgeband with deduction on.
 */
describe("box cabinet, factory defaults", () => {
  const r = buildOne();
  const p = partsByCode(r);

  it("builds without diagnostics", () => {
    expect(r.diagnostics).toEqual([]);
    expect(r.parts.map((x) => x.code)).toEqual(["SL", "SR", "BO", "RF", "RR", "BK", "SH1", "DO1"]);
  });

  it("sizes the carcase with sides over bottom", () => {
    expect(size(p.SL)).toBe("720 × 560 × 19");
    expect(size(p.SR)).toBe("720 × 560 × 19");
    expect(size(p.BO)).toBe("562 × 560 × 19"); // 600 − 2·19
    expect(size(p.RF)).toBe("562 × 100 × 19");
    expect(size(p.RR)).toBe("562 × 100 × 19");
  });

  it("sizes the back into the grooves", () => {
    // Width: 600 − 2·19 + 2·(8 − 1) = 576. Height: from 19 − 7 = 12 up to 720 − 1 = 719.
    expect(size(p.BK)).toBe("707 × 576 × 8");
    expect(p.BK!.box.z).toBe(10);
  });

  it("sizes the shelf between back and front setback", () => {
    // Width: 600 − 2·19 − 2·1 = 560. Depth: from 10 + 8 + 2 = 20 to 560 − 10 = 550.
    expect(size(p.SH1)).toBe("560 × 530 × 19");
  });

  it("sizes the door with the front gaps", () => {
    expect(size(p.DO1)).toBe("717 × 597 × 19"); // 720 − 3, 600 − 2·1.5
    expect(p.DO1!.box.z).toBe(560);
  });

  it("deducts edgeband thickness for cut sizes", () => {
    expect([p.SL!.cutLength, p.SL!.cutWidth]).toEqual([720, 559]); // front edge banded
    expect([p.RR!.cutLength, p.RR!.cutWidth]).toEqual([562, 100]); // rear rail not banded
    expect([p.DO1!.cutLength, p.DO1!.cutWidth]).toEqual([715, 595]); // all four edges
    expect([p.BK!.cutLength, p.BK!.cutWidth]).toEqual([707, 576]);
  });

  it("numbers parts as <cabinet>-<code>", () => {
    expect(r.parts.map((x) => x.id)).toContain("C1-SH1");
  });
});

describe("box cabinet variants", () => {
  it("sides between bottom and top, full top", () => {
    const p = partsByCode(buildOne({ options: { carcase_joint: "sides_between", top: "full" } }));
    expect(size(p.SL)).toBe("682 × 560 × 19"); // 720 − 2·19
    expect(size(p.BO)).toBe("600 × 560 × 19");
    expect(size(p.TO)).toBe("600 × 560 × 19");
    expect(p.RF).toBeUndefined();
    // Full top: back runs from 12 up to 720 − 19 + 7 = 708.
    expect(size(p.BK)).toBe("696 × 576 × 8");
  });

  it("back in rebate", () => {
    const p = partsByCode(buildOne({ options: { back_mount: "rebate", top: "full" } }));
    expect(size(p.BK)).toBe("696 × 576 × 8");
    expect(p.BK!.box.z).toBe(0);
    // Shelf depth: from 8 + 2 = 10 to 550.
    expect(p.SH1!.width).toBe(540);
  });

  it("surface-mounted back shortens the carcase depth", () => {
    const p = partsByCode(buildOne({ options: { back_mount: "surface" } }));
    expect(size(p.BK)).toBe("720 × 600 × 8");
    expect(size(p.SL)).toBe("720 × 552 × 19"); // 560 − 8
    expect(p.SL!.box.z).toBe(8);
  });

  it("two doors share the width with one gap", () => {
    const p = partsByCode(buildOne({ vars: { W: 800, door_count: 2 } }));
    expect(size(p.DO1)).toBe("717 × 397 × 19"); // (800 − 3 − 3) / 2
    expect(size(p.DO2)).toBe("717 × 397 × 19");
    expect(p.DO2!.box.x).toBe(401.5); // 1.5 + 397 + 3
  });

  it("no doors and no shelves", () => {
    const r = buildOne({ vars: { door_count: 0, shelf_count: 0 } });
    expect(r.parts.map((x) => x.code)).toEqual(["SL", "SR", "BO", "RF", "RR", "BK"]);
  });

  it("cut size equals finished size without deduction", () => {
    const p = partsByCode(buildOne({ options: { "edge.deduct": false } }));
    expect([p.DO1!.cutLength, p.DO1!.cutWidth]).toEqual([717, 597]);
  });

  it("part layer overrides material and edges", () => {
    const r = buildOne(
      { parts: { SH1: { material: "oak-veneer-19", edges: { l2: "oak-veneer-05" }, note: "glass later" } } },
    );
    const sh = partsByCode(r).SH1!;
    expect(sh.material).toBe("oak-veneer-19");
    expect(sh.grain).toBe(true);
    expect(sh.cutWidth).toBe(529.5);
    expect(sh.note).toBe("glass later");
  });

  it("warns about overrides for parts that do not exist", () => {
    const r = buildOne({ vars: { door_count: 0 }, parts: { DO1: { note: "x" } } });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["part_override_unused"]);
  });

  it("rejects grooves as deep as the board", () => {
    const r = buildOne({ vars: { back_groove_depth: 19 } });
    expect(r.diagnostics.map((d) => d.code)).toContain("back_groove_too_deep");
    expect(r.ok).toBe(false);
  });

  it("rejects rails that overlap in a shallow carcase", () => {
    const r = buildOne({ vars: { D: 150 } });
    expect(r.diagnostics.map((d) => d.code)).toContain("rails_overlap");
  });

  it("keeps part numbers stable when parts are added", () => {
    const before = buildOne({ vars: { shelf_count: 1 } }).parts.map((x) => x.id);
    const after = buildOne({ vars: { shelf_count: 3 } }).parts.map((x) => x.id);
    for (const id of before) expect(after).toContain(id);
  });
});
