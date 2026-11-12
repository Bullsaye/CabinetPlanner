/**
 * Paper for drawing sheets in PDF and print (D60): every sheet at its own
 * size, or placed on A4 / A3. Kept apart from the PDF writer so a client can
 * lay out print pages without loading it.
 */
export type PdfPaper = "sheet" | "a4" | "a3";

/** Long and short side in mm. */
export const PAPER_MM = { a4: [297, 210], a3: [420, 297] } as const;
const FIT_MARGIN = 5;

export interface PaperFit {
  /** Paper size in mm, turned to match the sheet. */
  w: number;
  h: number;
  /** Uniform scale of the sheet on the paper (1: true to the sheet's scale). */
  scale: number;
  /** Where the sheet's top-left corner sits on the paper, mm. */
  x: number;
  y: number;
}

/**
 * Places a sheet on paper. "sheet": the page is the sheet. A4 / A3: the
 * paper is turned to the sheet's orientation; a sheet that fits is centred
 * unscaled (the drawing keeps its scale), a larger one is reduced to fit
 * inside a 5 mm margin. The scale is always the same in both directions.
 */
export function fitToPaper(page: { w: number; h: number }, paper: PdfPaper = "sheet"): PaperFit {
  if (paper === "sheet") return { w: page.w, h: page.h, scale: 1, x: 0, y: 0 };
  const [long, short] = PAPER_MM[paper];
  const [w, h] = page.w >= page.h ? [long, short] : [short, long];
  const fits = page.w <= w + 0.01 && page.h <= h + 0.01;
  const scale = fits ? 1 : Math.min((w - 2 * FIT_MARGIN) / page.w, (h - 2 * FIT_MARGIN) / page.h);
  return { w, h, scale, x: (w - page.w * scale) / 2, y: (h - page.h * scale) / 2 };
}
