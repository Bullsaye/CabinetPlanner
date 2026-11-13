import type { PdfFonts } from "@cabinet-planner/engine";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * The fonts of the drawings for PDF output: Inter and JetBrains Mono (SIL
 * Open Font License 1.1) from the @fontsource packages, the same files the
 * app bundles, so a PDF from the command line and one from the app are the
 * same bytes. Latin first, latin-ext as fallback (ą, ő, ž …).
 */
export function pdfFonts(): PdfFonts {
  const require = createRequire(import.meta.url);
  const file = (pkg: string, name: string): Uint8Array => new Uint8Array(readFileSync(require.resolve(`@fontsource/${pkg}/files/${name}.woff`)));
  const face = (pkg: string, weight: number): Uint8Array[] => ["latin", "latin-ext"].map((subset) => file(pkg, `${pkg}-${subset}-${weight}-normal`));
  return {
    sans: face("inter", 400),
    sansBold: face("inter", 600),
    mono: face("jetbrains-mono", 400),
    monoBold: face("jetbrains-mono", 600),
  };
}
