import { describe, expect, it } from "vitest";
import type { Bore, Part, ProjectResult } from "../src/index.ts";
import { buildOne, partsByCode, size } from "./helpers.ts";

/*
 * Metal-sided drawer systems from the brand packs (D76): Grass Vionaro V8
 * (catalogue 2026.27 pp. 226–231, 239) and Blum LEGRABOX (ordering and
 * planning information, CA edition 2023). Base 600: D 560, LWK 562, clear
 * inside depth 542 → NL 500 for both.
 */
const bores = (p: Part | undefined, ref: string): Bore[] =>
  (p?.operations ?? []).filter((o): o is Bore => o.kind === "bore" && o.sources.some((s) => s.ref === ref));
const drawers = (r: ProjectResult) => r.cabinets[0]!.layout!.drawers;
/** Front fixing holes of drawer i as heights above the rail screw axis (cabinet frame), per side. */
function holesAboveAxis(r: ProjectResult, item: string, i: number): number[] {
  const p = partsByCode(r);
  const df = p[`DF${i}`]!;
  const d = drawers(r).find((x) => x.index === i)!;
  const vs = bores(df, `${item}:front`).map((b) => Math.round((df.box.y + b.v - d.axisY) * 10) / 10);
  return [...new Set(vs)].sort((a, b) => a - b);
}

describe("Grass Vionaro V8 on Dynapro 40 kg", () => {
  const item = "grass-vionaro-v8-40";
  const r = buildOne({ presets: ["base-unit"], options: { "hardware.slide": item }, fronts: [{ type: "drawer", h: 150 }, { type: "drawer", h: 250 }, { type: "drawer" }] });
  const p = partsByCode(r);

  it("builds without findings: bottom and back only, the sides are hardware", () => {
    expect(r.diagnostics).toEqual([]);
    expect(p.DL1).toBeUndefined();
    expect(drawers(r).map((d) => [d.nl, d.box, d.sideH])).toEqual([
      [500, "metal", 89],
      [500, "metal", 121],
      [500, "metal", 121],
    ]);
  });

  it("cuts bottom LWK − 22 × NL − 11 and back LWK − 32 × RWH (16 mm back on the bottom)", () => {
    expect(size(p.DT1)).toBe("540 × 489 × 16");
    expect(size(p.DB1)).toBe("530 × 59 × 16"); // H89
    expect(size(p.DB2)).toBe("530 × 91 × 16"); // H121
    // The back stands on the bottom, at its rear edge.
    expect(p.DB1!.box.y).toBe(p.DT1!.box.y + 16);
    expect(p.DB1!.box.z).toBe(p.DT1!.box.z);
  });

  it("puts the bottom underside 8.5 below the rail screw axis, the axis at least 38 above the carcase bottom", () => {
    for (const d of drawers(r)) expect(p[`DT${d.index}`]!.box.y).toBe(d.axisY - 8.5);
    expect(drawers(r).at(-1)!.axisY - 19).toBeGreaterThanOrEqual(38);
  });

  it("drills the front holder bores Ø5 × 13, 12 from the side's inner face, 13 and 45 above the axis", () => {
    for (const i of [1, 2, 3]) {
      const b = bores(p[`DF${i}`], `${item}:front`);
      expect(b).toHaveLength(4);
      expect(b.every((x) => x.d === 5 && x.depth === 13)).toBe(true);
      expect(holesAboveAxis(r, item, i)).toEqual([13, 45]);
      const xs = [...new Set(b.map((x) => p[`DF${i}`]!.box.x + x.u))].sort((a, c) => a - c);
      expect(xs).toEqual([19 + 12, 600 - 19 - 12]);
    }
  });

  it("drills the Dynapro rail fixings for NL 500 into both sides", () => {
    const sl = bores(p.SL, item);
    expect(sl).toHaveLength(3 * 4);
    const z = [...new Set(sl.map((b) => 560 - b.v))].sort((a, c) => a - c);
    expect(z).toEqual([37, 69, 293, 325]);
    expect(bores(p.SR, item)).toHaveLength(12);
  });

  it("H72 is not made in NL 350: a low drawer falls back to H89 or reports that it does not fit", () => {
    const low = buildOne({ presets: ["base-unit"], vars: { D: 430 }, options: { "hardware.slide": item }, fronts: [{ type: "drawer", h: 120 }, { type: "drawer" }] });
    const d = drawers(low);
    expect(d[0]!.nl).toBe(400);
    expect(d[0]!.sideH).toBe(72);
    const short = buildOne({ presets: ["base-unit"], vars: { D: 380 }, options: { "hardware.slide": item }, fronts: [{ type: "drawer", h: 120 }, { type: "drawer" }] });
    expect(drawers(short)[0]?.nl ?? 350).toBe(350);
    expect(short.diagnostics.map((x) => x.code)).toContain("drawer_too_low");
  });

  it("refuses a back narrower than the front locking device needs and boards other than 16 mm", () => {
    const narrow = buildOne({ presets: ["base-unit"], vars: { W: 200 }, options: { "hardware.slide": item }, fronts: [{ type: "drawer" }] });
    expect(narrow.diagnostics).toContainEqual(expect.objectContaining({ code: "hardware_limit", params: expect.objectContaining({ name: "back_w" }) }));
    const thick = buildOne({ presets: ["base-unit"], vars: { drawer_side_t: 19 }, options: { "hardware.slide": item }, fronts: [{ type: "drawer" }] });
    expect(thick.diagnostics).toContainEqual(expect.objectContaining({ code: "hardware_limit", params: expect.objectContaining({ name: "drawer_side_t" }) }));
  });
});

describe("Blum LEGRABOX, cabinet profile 750", () => {
  const item = "blum-legrabox-40";
  const r = buildOne({ presets: ["base-unit"], options: { "hardware.slide": item }, fronts: [{ type: "drawer", h: 150 }, { type: "drawer", h: 250 }, { type: "drawer" }] });
  const p = partsByCode(r);

  it("builds without findings, M for the low front and C for the high ones", () => {
    expect(r.diagnostics).toEqual([]);
    expect(drawers(r).map((d) => [d.nl, d.sideH])).toEqual([
      [500, 90.5],
      [500, 177],
      [500, 177],
    ]);
  });

  it("cuts drawer base LW − 35 × NL − 10 and chipboard back LW − 38 × back height", () => {
    expect(size(p.DT1)).toBe("527 × 490 × 16");
    expect(size(p.DB1)).toBe("524 × 63 × 16"); // M
    expect(size(p.DB2)).toBe("524 × 148 × 16"); // C
  });

  it("drills EXPANDO holes Ø10, 14 from the side's inner face; M: 13 and 45 above the axis, C: one more 96 higher", () => {
    expect(holesAboveAxis(r, item, 1)).toEqual([13, 45]);
    expect(holesAboveAxis(r, item, 2)).toEqual([13, 45, 141]);
    const b = bores(p.DF1, `${item}:front`);
    expect(b.every((x) => x.d === 10)).toBe(true);
    expect([...new Set(b.map((x) => p.DF1!.box.x + x.u))].sort((a, c) => a - c)).toEqual([19 + 14, 600 - 19 - 14]);
  });

  it("drills the profile's system screw positions for NL 500: 37, 69, 261, 293", () => {
    const z = [...new Set(bores(p.SL, item).map((b) => 560 - b.v))].sort((a, c) => a - c);
    expect(z).toEqual([37, 69, 261, 293]);
  });

  it("height N exists in NL 450/500 only, with its own bracket: holes 7.5 and 23.5 above the axis", () => {
    const n = buildOne({ presets: ["base-unit"], vars: { drawer_clearance: 50 }, options: { "hardware.slide": item }, fronts: [{ type: "drawer", h: 100 }, { type: "drawer" }] });
    expect(n.diagnostics).toEqual([]);
    expect(drawers(n)[0]!.sideH).toBe(66.5);
    expect(size(partsByCode(n).DB1)).toBe("524 × 39 × 16");
    expect(holesAboveAxis(n, item, 1)).toEqual([7.5, 23.5]);
    // NL 400: no N side; the low drawer does not fit.
    const short = buildOne({ presets: ["base-unit"], vars: { D: 430, drawer_clearance: 50 }, options: { "hardware.slide": item }, fronts: [{ type: "drawer", h: 100 }, { type: "drawer" }] });
    expect(drawers(short).find((d) => d.index === 1)).toBeUndefined();
    expect(short.diagnostics.map((x) => x.code)).toContain("drawer_too_low");
  });

  it("a wardrobe drawer zone builds on the same item", () => {
    const w = buildOne({ presets: ["tall-unit", "wardrobe"], vars: { W: 1000 }, options: { "hardware.slide": item }, fronts: [{ type: "door", doors: 2 }, { type: "drawer", h: 200 }, { type: "drawer", h: 200 }] });
    expect(w.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(drawers(w)).toHaveLength(2);
  });
});
