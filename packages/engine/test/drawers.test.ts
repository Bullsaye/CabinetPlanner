import { describe, expect, it } from "vitest";
import { layoutFronts, type Bore, type Part } from "../src/index.ts";
import { buildOne, partsByCode, size } from "./helpers.ts";

/*
 * Drawers (DECISIONS.md D24). Grass values from the catalogue 2026/27
 * (Dynapro p. 434–436, Nova Pro Scala p. 29–45); generic slide values are
 * placeholders. Base 600: H 720, D 560, back in a groove → 542 mm clear
 * inside depth, LWK 562.
 */
const bores = (p: Part, ref: string): Bore[] =>
  p.operations.filter((o): o is Bore => o.kind === "bore" && o.sources.some((s) => s.ref === ref));
const at = { cabinet: "C1" };

describe("front stack", () => {
  const gaps = { top: 3, bottom: 0, between: 3 };

  it("keeps given heights and shares the rest", () => {
    const r = layoutFronts([{ type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer" }], 720, gaps, 1, new Map(), at);
    expect(r.diagnostics).toEqual([]);
    expect(r.fronts.map((f) => [f.y0, f.y1])).toEqual([
      [567, 717],
      [414, 564],
      [0, 411],
    ]);
  });

  it("evaluates formulas and reports sums that do not fit", () => {
    const ok = layoutFronts([{ type: "drawer", h: "H / 2 - 3" }, { type: "door" }], 720, gaps, 2, new Map([["H", 720]]), at);
    expect(ok.fronts.map((f) => f.y1 - f.y0)).toEqual([357, 357]);
    expect(ok.fronts[1]!.doors).toBe(2);
    const bad = layoutFronts([{ type: "drawer", h: 400 }, { type: "drawer", h: 400 }], 720, gaps, 1, new Map(), at);
    expect(bad.diagnostics.map((d) => d.code)).toContain("fronts_sum_mismatch");
    const over = layoutFronts([{ type: "drawer", h: 800 }, { type: "door" }], 720, gaps, 1, new Map(), at);
    expect(over.diagnostics.map((d) => d.code)).toContain("fronts_too_high");
  });

  it("without a stack, one door zone gives the same door as before", () => {
    const p = partsByCode(buildOne());
    expect(size(p.DO1)).toBe("717 × 597 × 19");
  });
});

describe("wooden drawers (generic slide)", () => {
  const r = buildOne({ presets: ["base-unit"], fronts: [{ type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer" }] });
  const p = partsByCode(r);

  it("builds fronts and boxes without findings", () => {
    expect(r.diagnostics).toEqual([]);
    expect(size(p.DF1)).toBe("597 × 150 × 19");
    expect(size(p.DF3)).toBe("597 × 411 × 19");
  });

  it("sizes the box from the slide: inner width LWK − 42, length NL − 10, NL 500 in 542 mm", () => {
    expect(size(p.DL1)).toBe("490 × 101 × 16");
    expect(size(p.DI1)).toBe("520 × 101 × 16");
    expect(size(p.DT1)).toBe("532 × 470 × 8"); // 520 + 2·6, 490 − 2·16 + 2·6
  });

  it("puts rails on system-grid lines, at least 38 above the bottom", () => {
    const sl = p.SL!;
    const ys = [...new Set(bores(sl, "generic-undermount").map((b) => b.u))].sort((a, b) => a - b);
    // Lowest: 19 + 38 = 57 → next grid line 73.5. Others: front bottom + 25, down to the grid.
    expect(ys).toEqual([73.5, 425.5, 585.5]);
    expect(bores(sl, "generic-undermount").filter((b) => b.u === 73.5).map((b) => b.v)).toEqual([523, 491, 267, 235]);
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "generic-undermount")!.qty).toBe(3);
  });

  it("keeps every box below the top of its front minus the clearance", () => {
    for (const i of [1, 2, 3]) {
      const df = p[`DF${i}`]!;
      const dl = p[`DL${i}`]!;
      expect(dl.box.y + dl.box.dy).toBeLessThanOrEqual(df.box.y + df.box.dy - 40 + 1e-6);
    }
  });

  it("grooves the box parts for the bottom", () => {
    for (const c of ["DL1", "DR1", "DI1", "DB1"]) expect(p[c]!.operations.some((o) => o.kind === "pocket")).toBe(true);
  });

  it("has no shelves without a door zone", () => {
    expect(r.parts.some((x) => x.role === "shelf")).toBe(false);
  });
});

describe("Grass drawer systems", () => {
  it("Dynapro: NL 520, rails 0/32/256/288 behind 37, shelf in the door zone", () => {
    const r = buildOne({ presets: ["base-unit"], options: { "hardware.slide": "grass-dynapro-40" }, fronts: [{ type: "drawer", h: 180 }, { type: "door" }] });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    expect(p.DL1!.length).toBe(510);
    expect(bores(p.SL!, "grass-dynapro-40").map((b) => b.v)).toEqual([523, 491, 267, 235]);
    // Shelf sits in the door zone below the drawer.
    expect(p.SH1!.box.y + p.SH1!.box.dy).toBeLessThan(p.DF1!.box.y);
    expect(p.DO1!.length).toBe(534);
  });

  it("Dynapro refuses drawer sides thicker than 16 mm", () => {
    const r = buildOne({ options: { "hardware.slide": "grass-dynapro-40" }, vars: { drawer_side_t: 18 }, fronts: [{ type: "drawer" }] });
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ code: "hardware_limit", params: expect.objectContaining({ name: "drawer_side_t" }) }));
  });

  it("Nova Pro Scala: bottom LWK − 58 × NL − 19, back height by side height", () => {
    const r = buildOne({ presets: ["base-unit"], vars: { W: 800 }, options: { "hardware.slide": "grass-nova-pro-scala-40" }, fronts: [{ type: "drawer", h: 180 }, { type: "drawer" }] });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    expect(size(p.DT1)).toBe("704 × 481 × 16");
    expect(p.DB1!.width).toBe(116); // H122
    expect(p.DB2!.width).toBe(249); // H250
    expect(p.DL1).toBeUndefined(); // metal sides are hardware
  });

  it("reports a cabinet too shallow for any slide", () => {
    const r = buildOne({ vars: { D: 250 }, fronts: [{ type: "drawer" }], options: { top: "full" } });
    expect(r.diagnostics.map((d) => d.code)).toContain("slide_no_length");
  });
});
