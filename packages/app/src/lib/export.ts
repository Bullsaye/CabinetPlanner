import type { Sheet } from "@cabinet-planner/engine";

/**
 * CSV as a file for spreadsheet programs: Excel only reads UTF-8 (ß, ä, ²,
 * Ø) correctly when the file starts with a byte order mark. Copying to the
 * clipboard and the CLI stay without one.
 */
export const csvForDownload = (csv: string): string => "﻿" + csv;

export type Paper = "sheet" | "a4" | "a3";

const PAPER = { a4: [297, 210], a3: [420, 297] } as const;
const MARGIN = 8;

/**
 * Prints drawing sheets, one per page, through the browser's print dialog
 * (which also saves a PDF). Paper "sheet" makes every page exactly as large
 * as its drawing (true to scale, best for PDF); A4 / A3 fit each drawing on
 * that paper, turned to match the drawing.
 *
 * The sheets go into #print-root, which only shows in print (app.css); each
 * sits in a shadow root so the sheet's own stylesheet cannot touch the app
 * and the app's theme cannot touch the sheet.
 */
export function printSheets(sheets: readonly Sheet[], paper: Paper = "sheet"): void {
  document.getElementById("print-root")?.remove();
  const root = document.createElement("div");
  root.id = "print-root";
  const pages = new Map<string, string>();
  for (const s of sheets) {
    const landscape = s.page.w >= s.page.h;
    const [long, short] = paper === "sheet" ? [0, 0] : PAPER[paper];
    const w = paper === "sheet" ? s.page.w : landscape ? long : short;
    const h = paper === "sheet" ? s.page.h : landscape ? short : long;
    const margin = paper === "sheet" ? 0 : MARGIN;
    const name = `p${String(w).replace(".", "_")}x${String(h).replace(".", "_")}`;
    pages.set(name, `@page ${name} { size: ${w}mm ${h}mm; margin: ${margin}mm; } .${name} { page: ${name}; width: ${w - 2 * margin}mm; height: ${h - 2 * margin}mm; }`);
    const page = document.createElement("div");
    page.className = `print-page ${name}`;
    const shadow = page.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>:host{display:block;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${s.svg}`;
    root.append(page);
  }
  const style = document.createElement("style");
  style.textContent = [...pages.values()].join("\n");
  root.prepend(style);
  document.body.append(root);
  const done = (): void => {
    root.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
