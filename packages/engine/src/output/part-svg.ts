import { faceAxes, type Bore, type Face, type Pocket } from "../ops.ts";
import type { Part } from "../part.ts";
import { formatNumber } from "./format.ts";

/**
 * Part drawing as SVG: the part seen on one thickness face, length to the
 * right (u), width up (v), with all machining:
 * - bores and pockets on the viewed face: solid;
 * - on the opposite face: dashed (seen through);
 * - edge bores: dashed rectangles from the edge, depth to scale;
 * - banded edges: heavy line.
 * Ordinate dimensions from the part origin along the bottom (u) and left
 * (v), a bore table, and overall sizes. Deterministic output; colours come
 * from CSS classes so a page can theme them (a default style is embedded).
 */
export interface PartSvgText {
  title: string;
  subtitle: string;
  /** Label of a face, e.g. "Face t1 (viewed)". */
  face: (f: Face) => string;
  legend: { viewed: string; opposite: string; edge: string; banded: string; table: string; count: string };
}

export interface PartSvgOptions {
  /** Face to look at; default: the thickness face with the most operations. */
  face?: "t0" | "t1";
  /** Drawing width in px for the part outline (without margins). */
  width?: number;
  /** Embed a default <style>. Off when the host page styles the classes. */
  style?: boolean;
}

const DEFAULT_STYLE = `
.pd-bg{fill:#fff}.pd-part{fill:#f3f4f6;stroke:#1f2937;stroke-width:1.2}
.pd-band{stroke:#1f5fd1;stroke-width:4;stroke-linecap:butt}
.pd-op{fill:#fff;stroke:#1f2937;stroke-width:1}.pd-op-far{fill:none;stroke:#6b7280;stroke-width:1;stroke-dasharray:4 3}
.pd-pocket{fill:#dbe4f3;stroke:#1f2937;stroke-width:1}.pd-pocket-far{fill:none;stroke:#6b7280;stroke-dasharray:4 3}
.pd-dim{stroke:#9aa2ad;stroke-width:.75;fill:none}.pd-dimtext{fill:#4a525c;font:10px ui-monospace,monospace}
.pd-text{fill:#1b1f24;font:12px system-ui,sans-serif}.pd-title{fill:#1b1f24;font:600 15px system-ui,sans-serif}
.pd-mono{fill:#1b1f24;font:11px ui-monospace,monospace}.pd-axis{fill:#9aa2ad;font:10px ui-monospace,monospace}`;

const f = formatNumber;

/**
 * Moves sorted label positions apart so neighbours are at least `gap`
 * apart, keeping the group centred on the original positions.
 */
export function spread(positions: readonly number[], gap: number): number[] {
  const out = [...positions];
  for (let pass = 0; pass < 50; pass++) {
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
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function partSvg(part: Part, text: PartSvgText, opts: PartSvgOptions = {}): string {
  const count = (face: Face): number => part.operations.filter((o) => o.face === face).length;
  const face = opts.face ?? (count("t0") > count("t1") ? "t0" : "t1");
  const far: Face = face === "t1" ? "t0" : "t1";
  const W = opts.width ?? 760;
  const s = W / part.length; // px per mm
  const H = part.width * s;
  const left = 84;
  const top = 64;
  const X = (u: number): number => left + u * s;
  const Y = (v: number): number => top + H - v * s; // v up
  const n = (x: number): string => (Math.round(x * 100) / 100).toString();

  const out: string[] = [];
  const bores = part.operations.filter((o): o is Bore => o.kind === "bore");
  const pockets = part.operations.filter((o): o is Pocket => o.kind === "pocket");

  // Outline and banded edges.
  out.push(`<rect class="pd-part" x="${n(X(0))}" y="${n(Y(part.width))}" width="${n(W)}" height="${n(H)}"/>`);
  const band = (x1: number, y1: number, x2: number, y2: number): string =>
    `<line class="pd-band" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
  if (part.edges.l1) out.push(band(X(0), Y(0), X(part.length), Y(0)));
  if (part.edges.l2) out.push(band(X(0), Y(part.width), X(part.length), Y(part.width)));
  if (part.edges.w1) out.push(band(X(0), Y(0), X(0), Y(part.width)));
  if (part.edges.w2) out.push(band(X(part.length), Y(0), X(part.length), Y(part.width)));

  // Pockets.
  for (const p of pockets) {
    const cls = p.face === far ? "pd-pocket-far" : "pd-pocket";
    out.push(
      `<rect class="${cls}" x="${n(X(p.u0))}" y="${n(Y(p.v1))}" width="${n((p.u1 - p.u0) * s)}" height="${n((p.v1 - p.v0) * s)}"/>`,
    );
  }

  // Bores.
  for (const b of bores) {
    const r = (b.d / 2) * s;
    if (b.face === face || b.face === far) {
      out.push(`<circle class="${b.face === face ? "pd-op" : "pd-op-far"}" cx="${n(X(b.u))}" cy="${n(Y(b.v))}" r="${n(Math.max(r, 1.5))}"/>`);
    } else {
      // Edge bore: rectangle from the edge inwards, depth to scale.
      const { normal } = faceAxes(b.face);
      if (normal === "v") {
        const v0 = b.face === "l1" ? 0 : part.width - b.depth;
        out.push(`<rect class="pd-op-far" x="${n(X(b.u) - r)}" y="${n(Y(v0 + b.depth))}" width="${n(2 * r)}" height="${n(b.depth * s)}"/>`);
      } else {
        const u0 = b.face === "w1" ? 0 : part.length - b.depth;
        out.push(`<rect class="pd-op-far" x="${n(X(u0))}" y="${n(Y(b.v) - r)}" width="${n(b.depth * s)}" height="${n(2 * r)}"/>`);
      }
    }
  }

  // Ordinate dimensions: every distinct u (bottom) and v (left) position.
  // Labels that would touch are pushed apart and joined to their tick by a leader.
  const us = [...new Set(bores.map((b) => b.u).filter((u) => u > 0 && u < part.length))].sort((a, b) => a - b);
  const vs = [...new Set(bores.map((b) => b.v).filter((v) => v > 0 && v < part.width))].sort((a, b) => a - b);
  const dimY = top + H + 14;
  const uTicks = [0, ...us, part.length];
  const uLabels = spread(uTicks.map(X), 11);
  out.push(`<line class="pd-dim" x1="${n(X(0))}" y1="${n(dimY)}" x2="${n(X(part.length))}" y2="${n(dimY)}"/>`);
  uTicks.forEach((u, i) => {
    const lx = uLabels[i]!;
    out.push(`<line class="pd-dim" x1="${n(X(u))}" y1="${n(top + H + 4)}" x2="${n(X(u))}" y2="${n(dimY + 4)}"/>`);
    if (Math.abs(lx - X(u)) > 0.5) {
      out.push(`<line class="pd-dim" x1="${n(X(u))}" y1="${n(dimY + 4)}" x2="${n(lx)}" y2="${n(dimY + 10)}"/>`);
    }
    out.push(`<text class="pd-dimtext" transform="translate(${n(lx - 3)} ${n(dimY + 12)}) rotate(90)">${f(u)}</text>`);
  });
  const dimX = left - 14;
  const vTicks = [0, ...vs, part.width];
  // Spread in screen space (y grows downwards, so spread the negated values).
  const vLabels = spread(vTicks.map((v) => -Y(v)), 11).map((y) => -y);
  out.push(`<line class="pd-dim" x1="${n(dimX)}" y1="${n(Y(0))}" x2="${n(dimX)}" y2="${n(Y(part.width))}"/>`);
  vTicks.forEach((v, i) => {
    const ly = vLabels[i]!;
    out.push(`<line class="pd-dim" x1="${n(dimX)}" y1="${n(Y(v))}" x2="${n(left - 4)}" y2="${n(Y(v))}"/>`);
    out.push(`<line class="pd-dim" x1="${n(dimX)}" y1="${n(Y(v))}" x2="${n(dimX - 6)}" y2="${n(ly)}"/>`);
    out.push(`<text class="pd-dimtext" x="${n(dimX - 8)}" y="${n(ly + 3)}" text-anchor="end">${f(v)}</text>`);
  });

  // Axis hints.
  out.push(`<text class="pd-axis" x="${n(X(part.length) + 8)}" y="${n(Y(0) + 3)}">u</text>`);
  out.push(`<text class="pd-axis" x="${n(X(0) + 4)}" y="${n(Y(part.width) - 6)}">v</text>`);

  // Bore table.
  const groups = new Map<string, number>();
  for (const b of bores) {
    const key = `${b.face}|${b.d}|${b.depth}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  let ty = dimY + 56;
  out.push(`<text class="pd-text" x="${left}" y="${n(ty)}" font-weight="600">${esc(text.legend.table)}</text>`);
  const faceOrder: Face[] = [face, far, "l1", "l2", "w1", "w2"];
  const rows = [...groups.entries()].sort(
    ([a], [b]) =>
      faceOrder.indexOf(a.split("|")[0] as Face) - faceOrder.indexOf(b.split("|")[0] as Face) ||
      Number(a.split("|")[1]) - Number(b.split("|")[1]),
  );
  for (const [key, c] of rows) {
    ty += 16;
    const [fc, d, depth] = key.split("|");
    out.push(
      `<text class="pd-mono" x="${left}" y="${n(ty)}">Ø${d} × ${depth}   ${esc(text.face(fc as Face))}   ${c} ${esc(text.legend.count)}</text>`,
    );
  }
  for (const p of pockets) {
    ty += 16;
    out.push(
      `<text class="pd-mono" x="${left}" y="${n(ty)}">${f(p.u1 - p.u0)} × ${f(p.v1 - p.v0)} × ${f(p.w1 - p.w0)}   ${esc(text.face(p.face))}</text>`,
    );
  }

  // Legend (right of the table).
  const lx = left + W * 0.55;
  let ly = dimY + 56;
  const legend: [string, string][] = [
    [`<circle class="pd-op" cx="${n(lx + 6)}" cy="${n(ly + 12)}" r="5"/>`, text.legend.viewed],
    [`<circle class="pd-op-far" cx="${n(lx + 6)}" cy="${n(ly + 28)}" r="5"/>`, text.legend.opposite],
    [`<rect class="pd-op-far" x="${n(lx)}" y="${n(ly + 40)}" width="12" height="8"/>`, text.legend.edge],
    [`<line class="pd-band" x1="${n(lx)}" y1="${n(ly + 60)}" x2="${n(lx + 12)}" y2="${n(ly + 60)}"/>`, text.legend.banded],
  ];
  legend.forEach(([shape, label], i) => {
    out.push(shape);
    out.push(`<text class="pd-text" x="${n(lx + 20)}" y="${n(ly + 16 + i * 16)}">${esc(label)}</text>`);
  });
  ly += 80;

  const totalW = left + W + 60;
  const totalH = Math.max(ty, ly) + 20;
  const header = [
    `<text class="pd-title" x="${left}" y="24">${esc(text.title)}</text>`,
    `<text class="pd-text" x="${left}" y="44">${esc(text.subtitle)} · ${esc(text.face(face))}</text>`,
  ];
  const style = opts.style === false ? "" : `<style>${DEFAULT_STYLE}</style>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(totalW)} ${n(totalH)}" width="${n(totalW)}" height="${n(totalH)}">` +
    style +
    (opts.style === false ? "" : `<rect class="pd-bg" width="100%" height="100%"/>`) +
    header.join("") +
    out.join("") +
    `</svg>\n`
  );
}
