import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fitToPaper, largerFormat, PAPER_FORMATS, PAPER_MM, paperNote, type PaperFormat } from "../src/index.ts";

/** Scale the sheet would get on the paper turned the other way (same rule: 1 if it fits, else inside 5 mm). */
function otherWay(page: { w: number; h: number }, fit: { w: number; h: number }): number {
  const [w, h] = [fit.h, fit.w];
  return page.w <= w + 0.01 && page.h <= h + 0.01 ? 1 : Math.min((w - 10) / page.w, (h - 10) / page.h);
}

describe("paper (D75, D77)", () => {
  it("knows the ISO 216 formats A4 to A0", () => {
    expect(PAPER_FORMATS).toEqual(["a4", "a3", "a2", "a1", "a0"]);
    expect(PAPER_MM.a2).toEqual([594, 420]);
    expect(PAPER_MM.a1).toEqual([841, 594]);
    expect(PAPER_MM.a0).toEqual([1189, 841]);
    // Each format is the next larger one halved (within the rounding of the standard).
    for (let i = 1; i < PAPER_FORMATS.length; i++) {
      const [l, s] = PAPER_MM[PAPER_FORMATS[i]!];
      const [l0, s0] = PAPER_MM[PAPER_FORMATS[i - 1]!];
      expect(Math.abs(s - l0)).toBeLessThanOrEqual(1);
      expect(Math.abs(Math.floor(l / 2) - s0)).toBeLessThanOrEqual(1);
    }
    expect(largerFormat("a4", "a3")).toBe("a3");
    expect(largerFormat("a0", "a3")).toBe("a0");
    expect(largerFormat("a3", "a3")).toBe("a3");
  });

  it("places a sheet that fits unscaled, centred, the paper turned to it", () => {
    expect(fitToPaper({ w: 420, h: 297 }, "a3")).toEqual({ w: 420, h: 297, scale: 1, x: 0, y: 0 });
    expect(fitToPaper({ w: 210, h: 297 }, "a3")).toEqual({ w: 297, h: 420, scale: 1, x: 43.5, y: 61.5 });
    expect(fitToPaper({ w: 420, h: 297 }, "a0")).toMatchObject({ w: 1189, h: 841, scale: 1 });
    expect(fitToPaper({ w: 297, h: 420 }, "a1")).toMatchObject({ w: 594, h: 841, scale: 1 });
    // Square: both ways hold it equally; the paper follows the sheet (landscape for w = h).
    expect(fitToPaper({ w: 200, h: 200 }, "a4")).toMatchObject({ w: 297, h: 210, scale: 1 });
    expect(fitToPaper({ w: 400, h: 400 }, "a4")).toMatchObject({ w: 297, h: 210 });
  });

  it("reduces a larger sheet with one scale and turns the paper the way it holds the sheet largest", () => {
    const a = fitToPaper({ w: 420, h: 297 }, "a4");
    expect(a).toMatchObject({ w: 297, h: 210 });
    expect(a.scale).toBeCloseTo(200 / 297, 6);
    // An almost-A4 part sheet that grew 2.6 mm: landscape, 94 %.
    const b = fitToPaper({ w: 297, h: 212.6 }, "a4");
    expect(b).toMatchObject({ w: 297, h: 210 });
    expect(b.scale).toBeCloseTo(200 / 212.6, 6);
    expect(b.scale).toBeGreaterThan(otherWay({ w: 297, h: 212.6 }, b));
    // A long, flat sheet (a worktop drawn 1:1) on A0.
    const c = fitToPaper({ w: 3000, h: 300 }, "a0");
    expect(c).toMatchObject({ w: 1189, h: 841 });
    expect(c.scale).toBeCloseTo(1179 / 3000, 6);
  });

  it("never does worse than the other orientation, and the sheet stays inside the paper", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20, max: 3000, noNaN: true }),
        fc.double({ min: 20, max: 3000, noNaN: true }),
        fc.constantFrom<PaperFormat>(...PAPER_FORMATS),
        (w, h, paper) => {
          const page = { w, h };
          const fit = fitToPaper(page, paper);
          const [long, short] = PAPER_MM[paper];
          expect([fit.w, fit.h].sort((x, y) => x - y)).toEqual([short, long]);
          expect(fit.scale).toBeLessThanOrEqual(1);
          expect(fit.scale).toBeGreaterThanOrEqual(otherWay(page, fit) - 1e-9);
          expect(fit.x).toBeGreaterThanOrEqual(-0.01);
          expect(fit.y).toBeGreaterThanOrEqual(-0.01);
          expect(fit.x + w * fit.scale).toBeLessThanOrEqual(fit.w + 0.01);
          expect(fit.y + h * fit.scale).toBeLessThanOrEqual(fit.h + 0.01);
          // Reduced sheets keep the 5 mm margin.
          if (fit.scale < 1) expect(Math.min(fit.x, fit.y)).toBeGreaterThanOrEqual(5 - 1e-6);
        },
      ),
    );
  });

  it("keeps the page itself for paper 'sheet'", () => {
    expect(fitToPaper({ w: 297, h: 212.6 })).toEqual({ w: 297, h: 212.6, scale: 1, x: 0, y: 0 });
    expect(fitToPaper({ w: 1500, h: 300 }, "sheet")).toEqual({ w: 1500, h: 300, scale: 1, x: 0, y: 0 });
  });

  it("writes the reduction note only on reduced sheets", () => {
    const text = (n: number): string => `Reduced to ${n} % <scale> & more`;
    expect(paperNote(fitToPaper({ w: 297, h: 210 }, "a4"), text)).toBe("");
    expect(paperNote(fitToPaper({ w: 420, h: 297 }, "a0"), text)).toBe("");
    const note = paperNote(fitToPaper({ w: 420, h: 297 }, "a4"), text);
    expect(note).toContain(">Reduced to 67 % &lt;scale&gt; &amp; more</text>");
    expect(note).toMatch(/^<text class="paper-note" x="5" y="208.5" /);
  });
});
