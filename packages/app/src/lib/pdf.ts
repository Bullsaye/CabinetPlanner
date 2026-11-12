/**
 * PDF export of drawing sheets (D75). Loaded on demand (dynamic import from
 * the drawings view), so the PDF writer and the font files stay out of the
 * app's start-up bundle.
 *
 * The fonts are the app's own: Inter and JetBrains Mono (SIL Open Font
 * License 1.1) from @fontsource, as WOFF files the engine reads itself. They
 * are fetched as assets of the app (no network in the desktop shell; cached
 * by the service worker after the first export in the PWA).
 */
import { sheetsPdf, type PdfFonts, type PdfPaper, type PdfSheet } from "@cabinet-planner/engine";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import interExt400 from "@fontsource/inter/files/inter-latin-ext-400-normal.woff?url";
import interExt600 from "@fontsource/inter/files/inter-latin-ext-600-normal.woff?url";
import mono400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url";
import mono600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff?url";
import monoExt400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-400-normal.woff?url";
import monoExt600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-ext-600-normal.woff?url";

let fonts: Promise<PdfFonts> | undefined;

async function loadFonts(): Promise<PdfFonts> {
  const file = async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const face = (...urls: string[]): Promise<Uint8Array[]> => Promise.all(urls.map(file));
  const [sans, sansBold, mono, monoBold] = await Promise.all([
    face(inter400, interExt400),
    face(inter600, interExt600),
    face(mono400, monoExt400),
    face(mono600, monoExt600),
  ]);
  return { sans, sansBold, mono, monoBold };
}

/** The sheets as one PDF, a sheet per page. Rejects when the fonts cannot be loaded. */
export async function sheetsToPdf(sheets: readonly PdfSheet[], opts: { paper: PdfPaper; title?: string; timestamp?: string }): Promise<Uint8Array> {
  fonts ??= loadFonts().catch((e) => {
    fonts = undefined; // try again next time (offline now, online later)
    throw e;
  });
  return sheetsPdf(sheets, { fonts: await fonts, ...opts });
}
