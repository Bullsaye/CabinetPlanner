/**
 * Paper for drawing sheets in PDF and print (D75, D77): every sheet at its
 * own size, or placed on an ISO 216 A format from A4 to A0 (plotters). Kept
 * apart from the PDF writer so a client can lay out print pages without
 * loading it.
 */
export type PaperFormat = "a4" | "a3" | "a2" | "a1" | "a0";
export type PdfPaper = "sheet" | PaperFormat;

/** Long and short side in mm (ISO 216), smallest first. */
export const PAPER_MM = {
  a4: [297, 210],
  a3: [420, 297],
  a2: [594, 420],
  a1: [841, 594],
  a0: [1189, 841],
} as const satisfies Record<PaperFormat, readonly [number, number]>;
export const PAPER_FORMATS = Object.keys(PAPER_MM) as PaperFormat[];
const FIT_MARGIN = 5;

/** The larger of two formats (A0 is the largest). */
export const largerFormat = (a: PaperFormat, b: PaperFormat): PaperFormat => (PAPER_FORMATS.indexOf(a) >= PAPER_FORMATS.indexOf(b) ? a : b);

export interface PaperFit {
  /** Paper size in mm, turned the way the sheet sits best. */
  w: number;
  h: number;
  /** Uniform scale of the sheet on the paper (1: true to the sheet's scale). */
  scale: number;
  /** Where the sheet's top-left corner sits on the paper, mm. */
  x: number;
  y: number;
}

/**
 * Places a sheet on paper. "sheet": the page is the sheet. A format: the
 * paper is turned whichever way holds the sheet larger; a sheet that fits is
 * centred unscaled (the drawing keeps its scale), a larger one is reduced to
 * fit inside a 5 mm margin. When both ways hold it equally (it fits either
 * way), the paper follows the sheet's own orientation. The scale is always
 * the same in both directions.
 */
export function fitToPaper(page: { w: number; h: number }, paper: PdfPaper = "sheet"): PaperFit {
  if (paper === "sheet") return { w: page.w, h: page.h, scale: 1, x: 0, y: 0 };
  const [long, short] = PAPER_MM[paper];
  const scaleOn = (w: number, h: number): number =>
    page.w <= w + 0.01 && page.h <= h + 0.01 ? 1 : Math.min((w - 2 * FIT_MARGIN) / page.w, (h - 2 * FIT_MARGIN) / page.h);
  const same: [number, number] = page.w >= page.h ? [long, short] : [short, long];
  const turned: [number, number] = [same[1], same[0]];
  const a = scaleOn(...same);
  const b = scaleOn(...turned);
  const [w, h] = b > a + 1e-9 ? turned : same;
  const scale = Math.max(a, b);
  return { w, h, scale, x: (w - page.w * scale) / 2, y: (h - page.h * scale) / 2 };
}

/** Text height of the paper note, mm. */
const NOTE_H = 2;

/**
 * The note a reduced sheet carries on its paper (D77): "reduced to 71 % –
 * the stated scales do not apply", bottom left in the margin. `text` is the
 * host's translation; the result is an SVG <text> in paper mm, or "" when
 * the sheet is not reduced.
 */
export function paperNote(fit: PaperFit, text: (percent: number) => string): string {
  if (fit.scale >= 1 - 1e-9) return "";
  const pct = Math.floor(fit.scale * 100);
  const s = text(pct).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<text class="paper-note" x="${FIT_MARGIN}" y="${Math.round((fit.h - 1.5) * 1000) / 1000}" font-size="${NOTE_H}" font-family="Inter, system-ui, sans-serif" fill="#a32020">${s}</text>`;
}
