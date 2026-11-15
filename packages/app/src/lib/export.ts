import { fitToPaper, PAPER_MM, paperNote, type PaperFormat, type PdfPaper, type Sheet } from "@cabinet-planner/engine";

/**
 * CSV as a file for spreadsheet programs: Excel only reads UTF-8 (ß, ä, ²,
 * Ø) correctly when the file starts with a byte order mark. Copying to the
 * clipboard and the CLI stay without one.
 */
export const csvForDownload = (csv: string): string => "﻿" + csv;

export type Paper = PdfPaper;

/** Now as a local ISO timestamp without zone ("2026-03-01T09:30:00"), for sheet footers and file comments. */
export function localTimestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface PrintJob {
  /** Paper, upright, in mm: the same for every page. */
  w: number;
  h: number;
  /** One SVG per page, exactly the paper's size. */
  pages: string[];
}

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * Lays drawing sheets out for the print dialog (D75, D77): every page is the
 * same upright paper (A4 … A0), each sheet is placed on it by fitToPaper
 * (true to scale when it fits, reduced otherwise, never stretched; turned
 * the way it sits largest) and a reduced sheet gets `reducedNote` on its
 * paper. A sheet that lies landscape is turned a quarter turn.
 *
 * Everything happens inside one SVG per page, in mm: the sheet becomes a
 * nested <svg> with explicit position, size and viewBox. Nothing depends on
 * the browser supporting pages of different sizes in one job or on CSS
 * percentages resolving against the page box — the two things the earlier
 * layout relied on and print engines disagree about.
 */
export function printJob(sheets: readonly Sheet[], paper: PaperFormat, reducedNote?: (percent: number) => string): PrintJob {
  const [long, short] = PAPER_MM[paper];
  const pages = sheets.map((s) => {
    const fit = fitToPaper(s.page, paper);
    const note = reducedNote ? paperNote(fit, reducedNote) : "";
    const root = /^<svg [^>]*>/.exec(s.svg)?.[0] ?? "";
    const cls = /\bclass="([^"]*)"/.exec(root)?.[1] ?? "";
    const viewBox = /\bviewBox="([^"]*)"/.exec(root)?.[1] ?? `0 0 ${s.page.w} ${s.page.h}`;
    const inner =
      `<svg x="${r3(fit.x)}" y="${r3(fit.y)}" width="${r3(s.page.w * fit.scale)}" height="${r3(s.page.h * fit.scale)}" viewBox="${viewBox}" class="${cls}">` +
      s.svg.slice(root.length);
    const body = fit.w > fit.h ? `<g transform="translate(${short} 0) rotate(90)">${inner}${note}</g>` : inner + note;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${short}mm" height="${long}mm" viewBox="0 0 ${short} ${long}">${body}</svg>`;
  });
  return { w: short, h: long, pages };
}

/**
 * Prints drawing sheets, one per page, through the browser's print dialog.
 * For a file, the PDF export (lib/pdf.ts) is the better way: it needs no
 * dialog and keeps every sheet at its own size.
 *
 * The pages go into #print-root, which only shows in print (app.css); each
 * sits in a shadow root so the sheet's own stylesheet cannot touch the app
 * and the app's theme cannot touch the sheet.
 */
export function printSheets(sheets: readonly Sheet[], paper: PaperFormat = "a4", reducedNote?: (percent: number) => string): void {
  const job = printJob(sheets, paper, reducedNote);
  document.getElementById("print-root")?.remove();
  const root = document.createElement("div");
  root.id = "print-root";
  const style = document.createElement("style");
  style.textContent = `@page { size: ${job.w}mm ${job.h}mm; margin: 0; } #print-root .print-page { width: ${job.w}mm; height: ${job.h}mm; }`;
  root.append(style);
  for (const svg of job.pages) {
    const page = document.createElement("div");
    page.className = "print-page";
    const shadow = page.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>:host{display:block;overflow:hidden}svg{display:block}</style>${svg}`;
    root.append(page);
  }
  document.body.append(root);
  const done = (): void => {
    root.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
