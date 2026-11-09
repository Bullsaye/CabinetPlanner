import type { OpSource } from "../ops.ts";
import type { Part, PartEdges } from "../part.ts";
import { localName } from "../text.ts";
import { formatNumber } from "../output/format.ts";
import { extractFeatures, groupFeatures, tagName, type DFeature, type FeatureGroup } from "./features.ts";
import type { ResolvedStyle } from "./style.ts";
import { faceDir, innerFace, machinedFaces, otherFace, partView, type Dir, type PartView, type Side } from "./view.ts";

/**
 * Part drawing on a paper sheet (SVG, mm units, to scale). Layout:
 * header (part, material, sizes, view, origin, scale) · part view with
 * machining, edge names and banding · dimensions on the bottom (X) and
 * left (Y) from the origin at the bottom-left corner · legend of tagged
 * feature groups · optional coordinate table.
 *
 * All text comes from `text.t(key, params)`, so the engine stays free of UI
 * language (keys live in packages/i18n under `drawing.*`).
 */
export interface DrawingText {
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Display number (locale decimal separator). Defaults to a dot. */
  number?: (x: number, decimals: number) => string;
  /** Name of a hardware item for legends. */
  hardwareName?: (id: string) => string | undefined;
  materialName?: (id: string) => string | undefined;
  edgeCode?: (id: string) => string | undefined;
  roleName?: (role: string) => string;
  /** Locale for names given by the user (free parts). */
  locale?: string;
  styleName?: string;
}

export interface DrawingInput {
  part: Part;
  cabinet: { W: number; H: number; D: number };
  style: ResolvedStyle;
  text: DrawingText;
  /** Embed the default stylesheet (off when a host page styles the classes). */
  css?: boolean;
  /** For two-sided parts: which side this sheet shows. Set by drawPartSheets. */
  side?: { face: "t0" | "t1"; index: number; of: number };
}

/** Default look; a host page can restyle the same classes (light/dark). */
export const DRAWING_CSS = `
.pd{font-family:"Inter",system-ui,sans-serif}.pd-sheet{fill:#fff}
.pd-part{fill:#f5f6f8;stroke:#1b1f24;stroke-width:.35}
.pd-band-outline{fill:none}.pd-band{stroke:#1f5fd1;stroke-width:.9}
.pd-edge{fill:#7a828d;font-family:"Inter",system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.pd-hole{fill:#fff;stroke:#1b1f24;stroke-width:.25}.pd-hole-far{fill:none;stroke:#5b6470;stroke-width:.2;stroke-dasharray:.8 .5}
.pd-hidden{fill:none;stroke:#5b6470;stroke-width:.2;stroke-dasharray:.8 .5}
.pd-pocket{fill:#d7e2f5;stroke:#1b1f24;stroke-width:.2}.pd-pocket-far{fill:none;stroke:#5b6470;stroke-width:.2;stroke-dasharray:.8 .5}
.pd-centre{stroke:#1f5fd1;stroke-width:.13}
.pd-dim,.pd-ext{stroke:#5b6470;stroke-width:.13;fill:none}.pd-tick{stroke:#1b1f24;stroke-width:.3}
.pd-arrow{fill:#1b1f24}.pd-origin{fill:#fff;stroke:#1b1f24;stroke-width:.3}
.pd-dimtext{fill:#1b1f24;font-family:"JetBrains Mono",ui-monospace,monospace}.pd-overall{font-weight:600}
.pd-textbg{fill:#fff}.pd-namebg{fill:#f5f6f8;opacity:.85}
.pd-leader{stroke:#1f5fd1;stroke-width:.15}.pd-tag{fill:#fff;stroke:#1f5fd1;stroke-width:.3}
.pd-tagtext{fill:#1f5fd1;font-weight:600;font-family:"Inter",system-ui,sans-serif}
.pd-title{fill:#1b1f24;font-weight:600}.pd-sub{fill:#4a525c}.pd-head{fill:#1b1f24;font-weight:600}
.pd-mono{fill:#1b1f24;font-family:"JetBrains Mono",ui-monospace,monospace}.pd-rule{stroke:#c9ced6;stroke-width:.2}`;

// ---------------------------------------------------------------------------
// Primitive canvas in paper mm, Y up, origin at the part's bottom-left corner.

type Prim =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; cls: string }
  | { t: "rect"; x: number; y: number; w: number; h: number; cls: string; rx?: number }
  | { t: "circle"; cx: number; cy: number; r: number; cls: string }
  | { t: "poly"; pts: [number, number][]; cls: string }
  | { t: "text"; x: number; y: number; s: string; cls: string; size: number; anchor: "start" | "middle" | "end"; rot?: -90 };

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Text width estimate for the mono/UI fonts used on drawings. */
const textW = (s: string, size: number): number => [...s].length * size * 0.6;

function primBox(p: Prim): Box {
  switch (p.t) {
    case "line":
      return { x0: Math.min(p.x1, p.x2), y0: Math.min(p.y1, p.y2), x1: Math.max(p.x1, p.x2), y1: Math.max(p.y1, p.y2) };
    case "rect":
      return { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h };
    case "circle":
      return { x0: p.cx - p.r, y0: p.cy - p.r, x1: p.cx + p.r, y1: p.cy + p.r };
    case "poly": {
      const xs = p.pts.map((q) => q[0]);
      const ys = p.pts.map((q) => q[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case "text": {
      const w = textW(p.s, p.size);
      if (p.rot === -90) {
        const y0 = p.anchor === "start" ? p.y : p.anchor === "end" ? p.y - w : p.y - w / 2;
        return { x0: p.x - p.size * 0.8, y0, x1: p.x + p.size * 0.2, y1: y0 + w };
      }
      const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
      return { x0, y0: p.y - p.size * 0.25, x1: x0 + w, y1: p.y + p.size * 0.8 };
    }
  }
}

const overlaps = (a: Box, b: Box, pad = 0): boolean =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** Spreads sorted positions so neighbours are at least `gap` apart, centred on the originals. */
export function spread(positions: readonly number[], gap: number): number[] {
  const out = [...positions];
  for (let pass = 0; pass < 100; pass++) {
    let moved = false;
    for (let i = 1; i < out.length; i++) {
      const overlap = out[i - 1]! + gap - out[i]!;
      if (overlap > 1e-6) {
        out[i - 1] = out[i - 1]! - overlap / 2;
        out[i] = out[i]! + overlap / 2;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

/** Like spread(), with per-label widths: centres at least (wᵢ + wⱼ)/2 + pad apart. */
export function spreadVar(centres: readonly number[], widths: readonly number[], pad: number): number[] {
  const out = [...centres];
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let i = 1; i < out.length; i++) {
      const need = (widths[i - 1]! + widths[i]!) / 2 + pad;
      const overlap = out[i - 1]! + need - out[i]!;
      if (overlap > 1e-6) {
        out[i - 1] = out[i - 1]! - overlap / 2;
        out[i] = out[i]! + overlap / 2;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

const STANDARD_SCALES = [1, 2, 5, 10, 20, 50];
const PAPER = { A4: [297, 210], A3: [420, 297] } as const;
const MARGIN = 10;

// ---------------------------------------------------------------------------

export interface PartDrawing {
  svg: string;
  view: PartView;
  groups: FeatureGroup[];
  scale: number;
  /** Sheet size in mm. */
  page: { w: number; h: number };
}

/** Several sheets in one SVG, stacked top to bottom with a gap. */
export function stackSheets(sheets: readonly PartDrawing[], gap = 10): string {
  if (sheets.length === 1) return sheets[0]!.svg;
  const w = Math.max(...sheets.map((s) => s.page.w));
  const h = sheets.reduce((a, s) => a + s.page.h, 0) + gap * (sheets.length - 1);
  let y = 0;
  const inner = sheets.map((s) => {
    const body = s.svg.replace(/^<svg [^>]*>/, "").replace(/<\/svg>\s*$/, "");
    const part = `<svg x="0" y="${r3(y)}" width="${r3(s.page.w)}" height="${r3(s.page.h)}" viewBox="0 0 ${r3(s.page.w)} ${r3(s.page.h)}" class="pd">${body}</svg>`;
    y += s.page.h + gap;
    return part;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(w)} ${r3(h)}" width="${r3(w)}mm" height="${r3(h)}mm" class="pd">${inner.join("")}</svg>\n`;
}

export function drawPart(input: DrawingInput): PartDrawing {
  const { part, cabinet, style, text } = input;
  const t = text.t;
  const h = style.dims.textHeight;
  const dec = style.dims.decimals;
  const num = (x: number): string => (text.number ? text.number(x, dec) : formatNumber(x, dec));

  const spec = style.view.roles[part.role] ?? style.view.default;
  const view = partView(part, spec, cabinet, input.side?.face);
  const features = extractFeatures(view);
  const groups = groupFeatures(features, part, style);
  if (input.side && input.side.of > 1) {
    // The other side has its own sheet: show its machining dashed for
    // orientation, without dimensions or tags.
    for (const g of groups) {
      if (g.where === "far") {
        g.rules = { ...g.rules, positions: "none", tag: false, table: false };
        g.tag = "";
      }
    }
    let letter = 0;
    for (const g of groups) if (g.tag) g.tag = tagName(letter++);
  }

  // Scale: largest standard scale (smallest denominator) that fits the sheet.
  const [pw0, ph0] = PAPER[style.paper.size];
  const portrait =
    style.paper.orientation === "portrait" || (style.paper.orientation === "auto" && view.height > view.width * 1.05);
  const [paperW, paperH] = portrait ? [ph0, pw0] : [pw0, ph0];
  let den: number;
  if (style.paper.scale === "auto") {
    const areaW = paperW - 2 * MARGIN - 34;
    const areaH = paperH - 2 * MARGIN - 20 - 26 - 24;
    den = STANDARD_SCALES.find((d) => view.width / d <= areaW && view.height / d <= areaH) ?? 50;
  } else {
    den = style.paper.scale;
  }
  const s = 1 / den;
  const W = view.width * s;
  const H = view.height * s;

  const prims: Prim[] = [];
  const add = (p: Prim): void => void prims.push(p);
  let edgeNameStart = -1;

  // --- Part outline, banding, edge names ---------------------------------------
  const contour = part.outline?.map(([u, v]) => {
    const q = view.projectLocal({ u, v, w: 0 });
    return [q.X, q.Y] as [number, number];
  });
  if (contour) add({ t: "poly", pts: contour.map(([x, y]) => [x * s, y * s] as [number, number]), cls: "pd-part" });
  else add({ t: "rect", x: 0, y: 0, w: W, h: H, cls: "pd-part" });
  const sideOf = (d: Dir): Side | undefined => (Object.keys(view.sides) as Side[]).find((k) => view.sides[k] === d);
  const bandBySide: Partial<Record<Side, string>> = {};
  for (const e of ["l1", "l2", "w1", "w2"] as (keyof PartEdges)[]) {
    const band = part.edges[e];
    const side = sideOf(faceDir(part, e));
    if (!side || !band) continue;
    bandBySide[side] = text.edgeCode?.(band) ?? band;
    const o = 0.7;
    if (contour) continue; // outline parts: banding drawn along the contour below
    if (side === "bottom") add({ t: "line", x1: 0, y1: -o, x2: W, y2: -o, cls: "pd-band" });
    if (side === "top") add({ t: "line", x1: 0, y1: H + o, x2: W, y2: H + o, cls: "pd-band" });
    if (side === "left") add({ t: "line", x1: -o, y1: 0, x2: -o, y2: H, cls: "pd-band" });
    if (side === "right") add({ t: "line", x1: W + o, y1: 0, x2: W + o, y2: H, cls: "pd-band" });
  }
  // Outline parts (D43): banded edges follow the contour.
  if (contour && Object.keys(bandBySide).length) {
    add({ t: "poly", pts: contour.map(([x, y]) => [x * s, y * s] as [number, number]), cls: "pd-band pd-band-outline" });
  }
  if (style.show.edgeNames) {
    const en = h * 0.8;
    const before = prims.length;
    for (const side of ["bottom", "top", "left", "right"] as Side[]) {
      const name = t(`drawing.dir.${view.sides[side]}`) + (bandBySide[side] ? ` · ${bandBySide[side]}` : "");
      if (side === "bottom") add({ t: "text", x: W / 2, y: 1.6, s: name, cls: "pd-edge", size: en, anchor: "middle" });
      if (side === "top") add({ t: "text", x: W / 2, y: H - 1.4 - en * 0.8, s: name, cls: "pd-edge", size: en, anchor: "middle" });
      if (side === "left") add({ t: "text", x: 1.4 + en * 0.8, y: H / 2, s: name, cls: "pd-edge", size: en, anchor: "middle", rot: -90 });
      if (side === "right") add({ t: "text", x: W - 1.6, y: H / 2, s: name, cls: "pd-edge", size: en, anchor: "middle", rot: -90 });
    }
    edgeNameStart = before;
  }

  // --- Features -------------------------------------------------------------------
  // (edge names are moved on top of the features below, with a background)
  const visible = groups.filter((g) => !g.rules.hide);
  for (const g of visible) {
    for (const f of g.features) drawFeature(f, s, style.show.centreMarks, add);
  }

  if (edgeNameStart >= 0) {
    const names = prims.splice(edgeNameStart, 4);
    for (const n of names) {
      const bx = primBox(n);
      add({ t: "rect", x: bx.x0 - 0.5, y: bx.y0 - 0.2, w: bx.x1 - bx.x0 + 1, h: bx.y1 - bx.y0 + 0.2, cls: "pd-namebg" });
      add(n);
    }
  }

  // --- Tags -----------------------------------------------------------------------
  const tagBoxes: Box[] = [];
  if (style.show.tags) {
    for (const g of visible.filter((x) => x.tag)) {
      const f = g.features[0]!;
      const r = f.op === "bore" ? (f.d / 2) * s : 0;
      const ax = f.rect ? f.rect.x1 * s : f.X * s;
      const ay = f.rect ? f.rect.y1 * s : f.Y * s;
      const tr = h * 0.75;
      let cx = ax + r + tr + 0.6;
      let cy = ay + r + tr + 0.6;
      for (let k = 0; k < 8; k++) {
        const b = { x0: cx - tr, y0: cy - tr, x1: cx + tr, y1: cy + tr };
        if (!tagBoxes.some((o) => overlaps(o, b, 0.4))) break;
        cx += tr * 2.4;
      }
      // Keep tags inside the sheet area near the part.
      tagBoxes.push({ x0: cx - tr, y0: cy - tr, x1: cx + tr, y1: cy + tr });
      add({ t: "line", x1: ax, y1: ay, x2: cx - tr * 0.7, y2: cy - tr * 0.7, cls: "pd-leader" });
      add({ t: "circle", cx, cy, r: tr, cls: "pd-tag" });
      add({ t: "text", x: cx, y: cy - h * 0.35, s: g.tag, cls: "pd-tagtext", size: h * 0.9, anchor: "middle" });
    }
  }

  // --- Dimension positions --------------------------------------------------------
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const g of visible) {
    if (g.rules.positions === "none") continue;
    const list = g.rules.positions === "pattern" ? g.singles : g.features;
    for (const f of list) positionsOf(f, xs, ys);
    if (g.rules.positions === "pattern") {
      for (const p of g.patterns) {
        const end = p.start + (p.count - 1) * p.pitch;
        if (p.axis === "x") {
          xs.add(p.start);
          xs.add(end);
          ys.add(p.at);
        } else {
          ys.add(p.start);
          ys.add(end);
          xs.add(p.at);
        }
      }
    }
  }
  const clean = (set: Set<number>, max: number): number[] =>
    [...set].map((v) => Math.round(v * 100) / 100).filter((v) => v > 1e-6 && v < max - 1e-6).sort((a, b) => a - b);
  const X = [...new Set(clean(xs, view.width))];
  const Y = [...new Set(clean(ys, view.height))];

  // Origin mark (ISO 129-1: small circle at the origin of running dimensions).
  add({ t: "circle", cx: 0, cy: 0, r: 0.9, cls: "pd-origin" });

  const yAxisBottom = dimX(X, view.width, s, W, style, num, add);
  const xAxisLeft = dimY(Y, view.height, s, H, style, num, add);

  if (style.dims.overall) {
    // Overall length below, overall width on the left.
    const ly = yAxisBottom - 5;
    add({ t: "line", x1: 0, y1: -1, x2: 0, y2: ly - 1, cls: "pd-ext" });
    add({ t: "line", x1: W, y1: -1, x2: W, y2: ly - 1, cls: "pd-ext" });
    dimLine(0, ly, W, ly, add, style.dims.terminator);
    add({ t: "text", x: W / 2, y: ly + 0.8, s: num(view.width), cls: "pd-dimtext pd-overall", size: h * 1.1, anchor: "middle" });
    const lx = xAxisLeft - 5;
    add({ t: "line", x1: -1, y1: 0, x2: lx - 1, y2: 0, cls: "pd-ext" });
    add({ t: "line", x1: -1, y1: H, x2: lx - 1, y2: H, cls: "pd-ext" });
    dimLine(lx, 0, lx, H, add, style.dims.terminator);
    if (style.dims.text === "aligned") {
      add({ t: "text", x: lx - 0.8, y: H / 2, s: num(view.height), cls: "pd-dimtext pd-overall", size: h * 1.1, anchor: "middle", rot: -90 });
    } else {
      const label = num(view.height);
      add({ t: "rect", x: lx - textW(label, h * 1.1) / 2 - 0.6, y: H / 2 - h * 0.6, w: textW(label, h * 1.1) + 1.2, h: h * 1.3, cls: "pd-textbg" });
      add({ t: "text", x: lx, y: H / 2 - h * 0.35, s: label, cls: "pd-dimtext pd-overall", size: h * 1.1, anchor: "middle" });
    }
  }

  // Outline corners off the bounding rectangle: their coordinates from the origin (D43).
  if (contour) {
    for (const [x, y] of contour) {
      const onCorner = (Math.abs(x) < 0.01 || Math.abs(x - view.width) < 0.01) && (Math.abs(y) < 0.01 || Math.abs(y - view.height) < 0.01);
      if (onCorner) continue;
      add({ t: "circle", cx: x * s, cy: y * s, r: 0.5, cls: "pd-origin" });
      add({ t: "text", x: x * s + 1.2, y: y * s + 1.2, s: `${num(x)} / ${num(y)}`, cls: "pd-dimtext", size: h * 0.9, anchor: "start" });
    }
  }

  // --- Page assembly ---------------------------------------------------------------
  const b = prims.map(primBox).reduce((a, c) => ({
    x0: Math.min(a.x0, c.x0),
    y0: Math.min(a.y0, c.y0),
    x1: Math.max(a.x1, c.x1),
    y1: Math.max(a.y1, c.y1),
  }));

  const header = headerLines(part, view, style, den, text, cabinet, input.side);
  const headerH = 6 + header.length * h * 1.7;
  const legend = style.show.legend ? legendRows(visible, view, text, num) : [];
  const table = style.show.table ? tableRows(visible, num, (k) => t(k)) : [];

  const contentW = b.x1 - b.x0;
  const drawTop = MARGIN + headerH + 4;
  const drawH = b.y1 - b.y0;
  const legendTop = drawTop + drawH + 7;
  const legendH = legend.length ? legend.length * h * 1.75 + h * 2 : 0;
  const tableTop = legendTop + legendH + (legend.length ? 3 : 0);
  const tableCols = Math.ceil(table.length / 18);
  const tableRowsN = Math.min(table.length, 18);
  const tableH = table.length ? (tableRowsN + 1) * h * 1.6 + 2 : 0;
  const pageW = Math.max(paperW, contentW + 2 * MARGIN, tableCols * 92 + 2 * MARGIN);
  const pageH = Math.max(paperH, tableTop + tableH + MARGIN);

  const ox = MARGIN - b.x0;
  const toX = (x: number): number => r3(ox + x);
  const toY = (y: number): number => r3(drawTop + (b.y1 - y));

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r3(pageW)} ${r3(pageH)}" width="${r3(pageW)}mm" height="${r3(pageH)}mm" class="pd">`,
  );
  if (input.css !== false) out.push(`<style>${DRAWING_CSS}</style>`);
  out.push(`<rect class="pd-sheet" x="0" y="0" width="${r3(pageW)}" height="${r3(pageH)}"/>`);
  // Header.
  header.forEach((line, i) => {
    out.push(
      `<text class="${i === 0 ? "pd-title" : "pd-sub"}" x="${MARGIN}" y="${r3(MARGIN + 3 + i * h * 1.7 + (i === 0 ? 1 : 1.5))}" font-size="${r3(i === 0 ? h * 1.45 : h)}">${esc(line)}</text>`,
    );
  });
  out.push(`<line class="pd-rule" x1="${MARGIN}" y1="${r3(MARGIN + headerH)}" x2="${r3(pageW - MARGIN)}" y2="${r3(MARGIN + headerH)}"/>`);

  for (const p of prims) out.push(emit(p, toX, toY));

  // Legend.
  if (legend.length) {
    out.push(`<text class="pd-head" x="${MARGIN}" y="${r3(legendTop)}" font-size="${r3(h)}">${esc(t("drawing.legend"))}</text>`);
    legend.forEach((row, i) => {
      const y = legendTop + (i + 1) * h * 1.75;
      if (row.tag) {
        out.push(`<circle class="pd-tag" cx="${r3(MARGIN + h * 0.75)}" cy="${r3(y - h * 0.35)}" r="${r3(h * 0.75)}"/>`);
        out.push(`<text class="pd-tagtext" x="${r3(MARGIN + h * 0.75)}" y="${r3(y)}" font-size="${r3(h * 0.9)}" text-anchor="middle">${esc(row.tag)}</text>`);
      }
      out.push(`<text class="pd-mono" x="${r3(MARGIN + h * 2.4)}" y="${r3(y)}" font-size="${r3(h)}">${esc(row.spec)}</text>`);
      out.push(`<text class="pd-sub" x="${r3(MARGIN + h * 2.4 + 46)}" y="${r3(y)}" font-size="${r3(h)}">${esc(row.text)}</text>`);
    });
  }

  // Coordinate table.
  if (table.length) {
    const heads = [t("drawing.table.hole"), "X", "Y", "Ø", t("drawing.table.depth"), t("drawing.table.where")];
    // Column anchors: name left, numbers right-aligned, face left.
    const colX = [0, 24, 38, 47, 57, 61];
    const align: ("start" | "end")[] = ["start", "end", "end", "end", "end", "start"];
    for (let c = 0; c < tableCols; c++) {
      const x0 = MARGIN + c * 92;
      heads.forEach((hd, i) =>
        out.push(
          `<text class="pd-head" x="${r3(x0 + colX[i]!)}" y="${r3(tableTop)}" font-size="${r3(h)}"${align[i] === "end" ? ' text-anchor="end"' : ""}>${esc(hd)}</text>`,
        ),
      );
      table.slice(c * 18, c * 18 + 18).forEach((row, i) => {
        const y = tableTop + (i + 1) * h * 1.6;
        row.forEach((cell, j) => {
          out.push(
            `<text class="${j === 5 ? "pd-sub" : "pd-mono"}" x="${r3(x0 + colX[j]!)}" y="${r3(y)}" font-size="${r3(h)}"${align[j] === "end" ? ' text-anchor="end"' : ""}>${esc(cell)}</text>`,
          );
        });
      });
    }
  }

  out.push(`</svg>\n`);
  return { svg: out.join(""), view, groups, scale: den, page: { w: r3(pageW), h: r3(pageH) } };
}

/**
 * All sheets of a part: one, or one per machined side when both thickness
 * faces have machining (style setting show.bothSides). Both sheets keep the
 * same edge on the reference, so side 2 is the part turned over.
 */
export function drawPartSheets(input: DrawingInput): PartDrawing[] {
  const { part, style, cabinet } = input;
  const spec = style.view.roles[part.role] ?? style.view.default;
  const first = partView(part, spec, cabinet).face;
  const machined = machinedFaces(part);
  if (!style.show.bothSides || !(machined.has("t0") && machined.has("t1"))) {
    return [drawPart({ ...input, side: { face: first, index: 1, of: 1 } })];
  }
  return [first, otherFace(first)].map((face, i) => drawPart({ ...input, side: { face, index: i + 1, of: 2 } }));
}

// ---------------------------------------------------------------------------

const r3 = (x: number): number => {
  const v = Math.round(x * 1000) / 1000;
  return v === 0 ? 0 : v;
};
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function emit(p: Prim, X: (x: number) => number, Y: (y: number) => number): string {
  switch (p.t) {
    case "line":
      return `<line class="${p.cls}" x1="${X(p.x1)}" y1="${Y(p.y1)}" x2="${X(p.x2)}" y2="${Y(p.y2)}"/>`;
    case "rect":
      return `<rect class="${p.cls}" x="${X(p.x)}" y="${Y(p.y + p.h)}" width="${r3(p.w)}" height="${r3(p.h)}"${p.rx ? ` rx="${r3(p.rx)}"` : ""}/>`;
    case "circle":
      return `<circle class="${p.cls}" cx="${X(p.cx)}" cy="${Y(p.cy)}" r="${r3(p.r)}"/>`;
    case "poly":
      return `<polygon class="${p.cls}" points="${p.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}"/>`;
    case "text": {
      const anchor = p.anchor === "start" ? "" : ` text-anchor="${p.anchor}"`;
      if (p.rot === -90) {
        return `<text class="${p.cls}" font-size="${r3(p.size)}"${anchor} transform="translate(${X(p.x)} ${Y(p.y)}) rotate(-90)">${esc(p.s)}</text>`;
      }
      return `<text class="${p.cls}" x="${X(p.x)}" y="${Y(p.y)}" font-size="${r3(p.size)}"${anchor}>${esc(p.s)}</text>`;
    }
  }
}

function drawFeature(f: DFeature, s: number, centre: boolean, add: (p: Prim) => void): void {
  if (f.op === "pocket" && f.rect) {
    const cls = f.where === "far" ? "pd-pocket-far" : "pd-pocket";
    add({ t: "rect", x: f.rect.x0 * s, y: f.rect.y0 * s, w: (f.rect.x1 - f.rect.x0) * s, h: (f.rect.y1 - f.rect.y0) * s, cls, ...(f.r ? { rx: f.r * s } : {}) });
    return;
  }
  const r = (f.d / 2) * s;
  const x = f.X * s;
  const y = f.Y * s;
  if (f.where === "edge") {
    const dp = f.depth * s;
    if (f.side === "bottom") add({ t: "rect", x: x - r, y: y, w: 2 * r, h: dp, cls: "pd-hidden" });
    if (f.side === "top") add({ t: "rect", x: x - r, y: y - dp, w: 2 * r, h: dp, cls: "pd-hidden" });
    if (f.side === "left") add({ t: "rect", x, y: y - r, w: dp, h: 2 * r, cls: "pd-hidden" });
    if (f.side === "right") add({ t: "rect", x: x - dp, y: y - r, w: dp, h: 2 * r, cls: "pd-hidden" });
    return;
  }
  add({ t: "circle", cx: x, cy: y, r: Math.max(r, 0.4), cls: f.where === "face" ? "pd-hole" : "pd-hole-far" });
  if (centre && f.where === "face") {
    const a = Math.max(r + 0.7, 1.2);
    add({ t: "line", x1: x - a, y1: y, x2: x + a, y2: y, cls: "pd-centre" });
    add({ t: "line", x1: x, y1: y - a, x2: x, y2: y + a, cls: "pd-centre" });
  }
}

function positionsOf(f: DFeature, xs: Set<number>, ys: Set<number>): void {
  if (f.op === "pocket" && f.rect) {
    xs.add(f.rect.x0);
    xs.add(f.rect.x1);
    ys.add(f.rect.y0);
    ys.add(f.rect.y1);
    return;
  }
  if (f.where === "edge") {
    if (f.side === "bottom" || f.side === "top") xs.add(f.X);
    else ys.add(f.Y);
    return;
  }
  xs.add(f.X);
  ys.add(f.Y);
}

/** Filled arrowhead (ISO closed arrow, 15°-ish, 2.5 mm long). */
function arrow(x: number, y: number, dx: number, dy: number, add: (p: Prim) => void): void {
  const L = 2.2;
  const w = 0.55;
  const bx = x - dx * L;
  const by = y - dy * L;
  add({ t: "poly", pts: [[x, y], [bx - dy * w, by + dx * w], [bx + dy * w, by - dx * w]], cls: "pd-arrow" });
}

function dimLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  add: (p: Prim) => void,
  end: "tick" | "arrow" | "dot" = "tick",
): void {
  add({ t: "line", x1, y1, x2, y2, cls: "pd-dim" });
  const len = Math.hypot(x2 - x1, y2 - y1);
  const dx = (x2 - x1) / len;
  const dy = (y2 - y1) / len;
  for (const [x, y, sx, sy] of [
    [x2, y2, dx, dy],
    [x1, y1, -dx, -dy],
  ] as const) {
    if (end === "arrow") arrow(x, y, sx, sy, add);
    else if (end === "dot") add({ t: "circle", cx: x, cy: y, r: 0.45, cls: "pd-arrow" });
    else {
      // Oblique stroke at 45° to the dimension line (ISO 129-1).
      const a = 1.1;
      const tx = (sx - sy) * Math.SQRT1_2 * a;
      const ty = (sy + sx) * Math.SQRT1_2 * a;
      add({ t: "line", x1: x - tx, y1: y - ty, x2: x + tx, y2: y + ty, cls: "pd-tick" });
    }
  }
}

/**
 * Dimensions along X below the part. Returns the lowest Y used, so the
 * overall dimension can go beneath it.
 */
function dimX(
  X: number[],
  width: number,
  s: number,
  W: number,
  style: ResolvedStyle,
  num: (x: number) => string,
  add: (p: Prim) => void,
): number {
  const h = style.dims.textHeight;
  const top = -2.5; // first label row's top
  if (style.dims.mode === "chain") {
    const pts = [0, ...X, width];
    const ly = top - 1.5;
    add({ t: "line", x1: 0, y1: ly, x2: W, y2: ly, cls: "pd-dim" });
    for (const v of pts) {
      add({ t: "line", x1: v * s, y1: -1, x2: v * s, y2: ly - 1.2, cls: "pd-ext" });
      add({ t: "line", x1: v * s - 0.8, y1: ly - 0.8, x2: v * s + 0.8, y2: ly + 0.8, cls: "pd-tick" });
    }
    const rows: Box[][] = [];
    let lowest = ly - 1.5;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]! * s;
      const b = pts[i]! * s;
      const label = num(pts[i]! - pts[i - 1]!);
      const w = textW(label, h);
      const cx = (a + b) / 2;
      let row = 0;
      let box: Box;
      for (;;) {
        const y = ly - 1 - h - row * h * 1.5;
        box = { x0: cx - w / 2, y0: y, x1: cx + w / 2, y1: y + h };
        const fitsBetween = row > 0 || w + 1 <= b - a;
        if (fitsBetween && !(rows[row] ?? []).some((o) => overlaps(o, box, 0.8))) break;
        row++;
      }
      (rows[row] ??= []).push(box);
      add({ t: "text", x: cx, y: box.y0 + h * 0.2, s: label, cls: "pd-dimtext", size: h, anchor: "middle" });
      lowest = Math.min(lowest, box.y0);
    }
    return lowest - 1;
  }

  // Running dimensions from the origin.
  if (style.dims.text === "aligned") {
    // ISO: values written along the extension lines, reading from the right.
    const gap = h * 1.15;
    const labels = spread(X.map((v) => v * s), gap);
    let lowest = top;
    add({ t: "text", x: 0 + h * 0.35, y: top - 0.6, s: "0", cls: "pd-dimtext", size: h, anchor: "end", rot: -90 });
    X.forEach((v, i) => {
      const x = v * s;
      const lx = labels[i]!;
      add({ t: "line", x1: x, y1: -1, x2: x, y2: top + 0.6, cls: "pd-ext" });
      add({ t: "line", x1: x, y1: top + 0.6, x2: lx, y2: top - 0.4, cls: "pd-ext" });
      const label = num(v);
      add({ t: "text", x: lx + h * 0.35, y: top - 0.6, s: label, cls: "pd-dimtext", size: h, anchor: "end", rot: -90 });
      lowest = Math.min(lowest, top - 0.6 - textW(label, h));
    });
    return lowest - 1;
  }

  // Horizontal text in one row: labels that would touch are pushed apart and
  // joined to their tick by a jogged leader (ordinate dimensioning practice).
  const vals = [0, ...X];
  const labels = vals.map((v) => (v === 0 ? "0" : num(v)));
  const widths = labels.map((l) => textW(l, h));
  const centres = spreadVar(vals.map((v) => v * s), widths, 1.6);
  const jog = 2.2; // vertical run of a jogged leader
  const ty = top - jog - h;
  vals.forEach((v, i) => {
    const x = v * s;
    const lx = centres[i]!;
    add({ t: "line", x1: x, y1: -1, x2: x, y2: top, cls: "pd-ext" });
    add({ t: "line", x1: x, y1: top, x2: lx, y2: top - jog + 0.4, cls: "pd-ext" });
    add({ t: "text", x: lx, y: ty + h * 0.2, s: labels[i]!, cls: "pd-dimtext", size: h, anchor: "middle" });
  });
  void width;
  return ty - 1;
}

/** Dimensions along Y left of the part. Returns the leftmost X used. */
function dimY(
  Y: number[],
  height: number,
  s: number,
  H: number,
  style: ResolvedStyle,
  num: (x: number) => string,
  add: (p: Prim) => void,
): number {
  const h = style.dims.textHeight;
  const right = -2.5;
  if (style.dims.mode === "chain") {
    const pts = [0, ...Y, height];
    const lx = right - 1.5;
    add({ t: "line", x1: lx, y1: 0, x2: lx, y2: H, cls: "pd-dim" });
    let leftmost = lx - 1;
    for (const v of pts) {
      add({ t: "line", x1: -1, y1: v * s, x2: lx - 1.2, y2: v * s, cls: "pd-ext" });
      add({ t: "line", x1: lx - 0.8, y1: v * s - 0.8, x2: lx + 0.8, y2: v * s + 0.8, cls: "pd-tick" });
    }
    const segs = pts.slice(1).map((v, i) => ({ c: ((pts[i]! + v) / 2) * s, label: num(v - pts[i]!) }));
    const placed = spread(segs.map((x) => x.c), h * 1.3);
    segs.forEach((sg, i) => {
      const w = textW(sg.label, h);
      add({ t: "text", x: lx - 1.2, y: placed[i]! - h * 0.35, s: sg.label, cls: "pd-dimtext", size: h, anchor: "end" });
      leftmost = Math.min(leftmost, lx - 1.2 - w);
    });
    return leftmost - 1;
  }
  const pts = [0, ...Y];
  const placed = spread(pts.map((v) => v * s), h * 1.35);
  let leftmost = right;
  pts.forEach((v, i) => {
    const y = v * s;
    const ly = placed[i]!;
    const label = v === 0 ? "0" : num(v);
    add({ t: "line", x1: -1, y1: y, x2: right + 0.4, y2: y, cls: "pd-ext" });
    if (Math.abs(ly - y) > 0.05) add({ t: "line", x1: right + 0.4, y1: y, x2: right - 0.6, y2: ly, cls: "pd-ext" });
    add({ t: "text", x: right - 0.9, y: ly - h * 0.35, s: label, cls: "pd-dimtext", size: h, anchor: "end" });
    leftmost = Math.min(leftmost, right - 0.9 - textW(label, h));
  });
  return leftmost - 1;
}

function headerLines(
  part: Part,
  view: PartView,
  style: ResolvedStyle,
  den: number,
  text: DrawingText,
  cabinet: { W: number; H: number; D: number },
  side?: { index: number; of: number },
): string[] {
  const t = text.t;
  const f = (x: number): string => formatNumber(x);
  const role = part.label !== undefined ? localName(part.label, text.locale ?? "en") : (text.roleName?.(part.role) ?? t(`role.${part.role}`));
  const mat = text.materialName?.(part.material) ?? part.material;
  const inner = innerFace(part, cabinet) === view.face;
  return [
    `${part.id} · ${role}`,
    `${mat} · ${t("drawing.finished")} ${f(part.length)} × ${f(part.width)} × ${f(part.thickness)} · ${t("drawing.cut")} ${f(part.cutLength)} × ${f(part.cutWidth)}${part.grain ? ` · ${t("drawing.grain")}` : ""}`,
    `${text.styleName ?? style.id} · ${side && side.of > 1 ? `${t("drawing.side", { n: side.index, of: side.of })} · ` : ""}${t(inner ? "drawing.face.inner" : "drawing.face.outer")} · ${t("drawing.origin", {
      a: t(`drawing.dir.${view.sides.bottom}`),
      b: t(`drawing.dir.${view.sides.left}`),
    })} · ${t("drawing.scale", { n: den })} · mm`,
  ];
}

interface LegendRow {
  tag: string;
  spec: string;
  text: string;
}

function describeSources(sources: OpSource[], text: DrawingText): string {
  const t = text.t;
  return sources
    .map((s) => {
      if (s.kind === "hardware") return text.hardwareName?.(s.ref) ?? s.ref;
      if (s.kind === "system") return t("drawing.src.system");
      if (s.kind === "joint") return t("drawing.src.joint", { ref: s.ref });
      if (s.kind === "custom") return t("drawing.src.custom");
      return t("drawing.src.back", { ref: s.ref });
    })
    .join(" + ");
}

function legendRows(groups: FeatureGroup[], view: PartView, text: DrawingText, num: (x: number) => string): LegendRow[] {
  const t = text.t;
  return groups
    .filter((g) => g.tag)
    .map((g) => {
      const where =
        g.where === "edge" ? t("drawing.where.edge", { edge: t(`drawing.dir.${view.sides[g.side!]}`) }) : t(`drawing.where.${g.where}`);
      let spec: string;
      if (g.op === "bore") {
        spec = g.through
          ? `${g.features.length}× Ø${num(g.d)} ${t("drawing.through")}`
          : `${g.features.length}× Ø${num(g.d)} × ${num(g.depth)}${g.split ? ` (${t("drawing.split")})` : ""}`;
      } else {
        const r = g.features[0]!.rect!;
        const rad = g.features[0]!.r;
        spec = `${t("drawing.pocket")} ${num(r.x1 - r.x0)} × ${num(r.y1 - r.y0)} × ${num(g.depth)}${rad ? ` R${num(rad)}` : ""}`;
      }
      const pats = g.patterns.map((p) =>
        t(p.axis === "x" ? "drawing.pattern.row" : "drawing.pattern.col", {
          count: p.count,
          pitch: num(p.pitch),
          from: num(p.start),
          to: num(p.start + (p.count - 1) * p.pitch),
          at: num(p.at),
        }),
      );
      const what = g.rules.label ?? describeSources(g.sources, text);
      return { tag: g.tag, spec, text: [what, where, ...pats].join(" · ") };
    });
}

function tableRows(groups: FeatureGroup[], num: (x: number) => string, t: (k: string) => string): string[][] {
  const rows: string[][] = [];
  for (const g of groups) {
    if (!g.rules.table || g.op !== "bore") continue;
    g.features
      .slice()
      .sort((a, b) => a.Y - b.Y || a.X - b.X)
      .forEach((f, i) =>
        rows.push([`${g.tag || "·"}${i + 1}`, num(f.X), num(f.Y), num(f.d), num(f.depth), t(`drawing.where.${f.where}`)]),
      );
  }
  return rows;
}
