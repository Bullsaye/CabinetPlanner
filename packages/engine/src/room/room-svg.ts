import type { CabinetResult } from "../project.ts";
import { formatNumber } from "../output/format.ts";
import type { DrawingText } from "../drawing/render.ts";
import { openingSymbolPoints, type OpeningSymbol } from "../drawing/opening.ts";
import { hingeEdges } from "../output/frontview.ts";
import { ceilingAlong, toPlan, type CabinetPlacement, type RoomLayout, type WallLayout, type WorktopLayout, carcaseTopAt, carcaseTopKinks } from "./room.ts";

/**
 * Room drawings (DECISIONS.md D28) on A3 landscape sheets, to scale, mm:
 * - floor plan: walls with their thickness, windows and doors (with swing),
 *   floor units solid, wall units dashed, ids; per wall the inner length and
 *   a chain of cabinet positions; opening positions;
 * - wall elevation (seen from inside the room): wall outline, openings,
 *   cabinets with their fronts, opening symbols (D78) and handles; chain
 *   of widths below (floor units) and above (wall units), heights on the
 *   left.
 */
const PAGE = { W: 420, H: 297 };
const M = 12;
const SCALES = [10, 20, 25, 50, 100];
const TH = 2.5;

export const ROOM_CSS = `
.rm{font-family:"Inter",system-ui,sans-serif}.rm-sheet{fill:#fff}
.rm-wall{fill:#c9ced5;stroke:#1b1f24;stroke-width:.35}.rm-floor{fill:#f5f6f8}
.rm-open{fill:#fff;stroke:#1b1f24;stroke-width:.25}.rm-glass{stroke:#1f5fd1;stroke-width:.3}
.rm-swing{fill:none;stroke:#5b6470;stroke-width:.2;stroke-dasharray:1 .8}
.rm-opening{fill:none;stroke:#5b6470;stroke-width:.18;stroke-dasharray:1.2 .8}
.rm-cab{fill:#e4e7eb;stroke:#1b1f24;stroke-width:.3}.rm-cab-wall{fill:none;stroke:#1b1f24;stroke-width:.25;stroke-dasharray:1.6 .9}
.rm-front{fill:#eef3fb;stroke:#1b1f24;stroke-width:.2}.rm-top{fill:#d8cbb4;stroke:#1b1f24;stroke-width:.3}.rm-cut{fill:#fff;stroke:#1b1f24;stroke-width:.25}.rm-ceil{stroke:#a32020;stroke-width:.35}.rm-plinth{fill:#3a4048}.rm-handle{stroke:#1b1f24;stroke-width:.5}
.rm-id{fill:#1b1f24;font-family:"JetBrains Mono",ui-monospace,monospace;font-weight:600}
.rm-dim{stroke:#5b6470;stroke-width:.15;fill:none}.rm-tick{stroke:#1b1f24;stroke-width:.3}
.rm-num{fill:#1b1f24;font-family:"JetBrains Mono",ui-monospace,monospace}
.rm-title{fill:#1b1f24;font-weight:600}.rm-sub{fill:#4a525c}.rm-rule{stroke:#c9ced6;stroke-width:.2}`;

const r3 = (x: number): number => {
  const v = Math.round(x * 1000) / 1000;
  return v === 0 ? 0 : v;
};
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Sheet {
  out: string[];
  den: number;
  /** Paper position of a model point (mm, Y up in the model). */
  P(x: number, y: number): [number, number];
}

/** Scale and paper origin for model bounds on the A3 sheet. */
function fit(bounds: [number, number, number, number], margins: { l: number; r: number; t: number; b: number }): { den: number; ox: number; oy: number } {
  const [x0, y0, x1, y1] = bounds;
  const areaW = PAGE.W - 2 * M - margins.l - margins.r;
  const areaH = PAGE.H - 2 * M - 20 - margins.t - margins.b;
  const den = SCALES.find((d) => (x1 - x0) / d <= areaW && (y1 - y0) / d <= areaH) ?? 100;
  const s = 1 / den;
  const ox = M + margins.l + (areaW - (x1 - x0) * s) / 2;
  const oy = M + 20 + margins.t + (areaH - (y1 - y0) * s) / 2;
  return { den, ox, oy };
}

function sheet(title: string, sub: string, bounds: [number, number, number, number], margins: { l: number; r: number; t: number; b: number }, css: boolean): Sheet {
  const [x0, , , y1] = bounds;
  const { den, ox, oy } = fit(bounds, margins);
  const s = 1 / den;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.W} ${PAGE.H}" width="${PAGE.W}mm" height="${PAGE.H}mm" class="rm">`);
  if (css) out.push(`<style>${ROOM_CSS}</style>`);
  out.push(`<rect class="rm-sheet" width="${PAGE.W}" height="${PAGE.H}"/>`);
  out.push(`<text class="rm-title" x="${M}" y="${M + 5}" font-size="${TH * 1.6}">${esc(title)}</text>`);
  out.push(`<text class="rm-sub" x="${M}" y="${M + 11}" font-size="${TH}">${esc(sub)}</text>`);
  out.push(`<line class="rm-rule" x1="${M}" y1="${M + 15}" x2="${PAGE.W - M}" y2="${M + 15}"/>`);
  return { out, den, P: (x, y) => [r3(ox + (x - x0) * s), r3(oy + (y1 - y) * s)] };
}

const poly = (sh: Sheet, cls: string, pts: [number, number][]): string =>
  `<polygon class="${cls}" points="${pts.map(([x, y]) => sh.P(x, y).join(",")).join(" ")}"/>`;
const line = (sh: Sheet, cls: string, a: [number, number], b: [number, number]): string => {
  const [x1, y1] = sh.P(a[0], a[1]);
  const [x2, y2] = sh.P(b[0], b[1]);
  return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
};
const text = (sh: Sheet, cls: string, at: [number, number], s: string, size = TH, anchor = "middle", rot = 0, dy = 0): string => {
  const [x, y] = sh.P(at[0], at[1]);
  const tr = rot ? ` transform="rotate(${rot} ${x} ${y + dy})"` : "";
  return `<text class="${cls}" x="${x}" y="${r3(y + dy)}" font-size="${size}" text-anchor="${anchor}"${tr}>${esc(s)}</text>`;
};

/**
 * A chain of dimensions along a model line from `a` in direction `u`,
 * offset by `off` (model mm) along `n`. Positions are distances along u.
 */
function chain(sh: Sheet, a: [number, number], u: [number, number], n: [number, number], off: number, positions: number[], num: (x: number) => string): string[] {
  const out: string[] = [];
  const pts = [...new Set(positions.map((p) => Math.round(p * 100) / 100))].sort((x, y) => x - y);
  const at = (p: number, o: number): [number, number] => [a[0] + u[0] * p + n[0] * o, a[1] + u[1] * p + n[1] * o];
  if (pts.length < 2) return out;
  out.push(line(sh, "rm-dim", at(pts[0]!, off), at(pts[pts.length - 1]!, off)));
  const tick = sh.den * 1.2;
  for (const p of pts) {
    out.push(line(sh, "rm-dim", at(p, 0), at(p, off + Math.sign(off) * sh.den * 1.5)));
    out.push(line(sh, "rm-tick", [at(p, off)[0] - (u[0] + n[0]) * tick * 0.7, at(p, off)[1] - (u[1] + n[1]) * tick * 0.7], [at(p, off)[0] + (u[0] + n[0]) * tick * 0.7, at(p, off)[1] + (u[1] + n[1]) * tick * 0.7]));
  }
  const angle = -(Math.atan2(u[1], u[0]) * 180) / Math.PI;
  const upright = angle > 90 || angle <= -90 ? angle + 180 : angle;
  for (let i = 1; i < pts.length; i++) {
    const mid = (pts[i - 1]! + pts[i]!) / 2;
    const len = pts[i]! - pts[i - 1]!;
    if (len < 1) continue;
    const textOff = off + Math.sign(off || 1) * sh.den * 1.2;
    out.push(text(sh, "rm-num", at(mid, textOff), num(len), TH * 0.9, "middle", upright, TH * 0.3));
  }
  return out;
}

// ---------------------------------------------------------------------------

function planBounds(room: RoomLayout): [number, number, number, number] {
  const all = room.walls.flatMap((w) => [w.start, w.end, outer(w, w.start), outer(w, w.end)]);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const pad = 1100; // room for dimension chains and wall names
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/**
 * Where the floor plan puts the room on its sheet: the sheet size (the SVG
 * viewBox, paper mm), the scale 1:den and both mappings between plan
 * coordinates (D28) and the sheet. For clients that lay something over the
 * drawing (the app's drag and drop); the drawing itself stays plain.
 */
export interface FloorPlanFrame {
  width: number;
  height: number;
  den: number;
  /** The part of the sheet with the room and its dimensions: x, y, width, height (a viewBox to zoom to). */
  view: [number, number, number, number];
  toPaper(x: number, y: number): [number, number];
  toPlan(px: number, py: number): [number, number];
}
export function floorPlanFrame(room: RoomLayout): FloorPlanFrame {
  const b = planBounds(room);
  const { den, ox, oy } = fit(b, { l: 0, r: 0, t: 0, b: 0 });
  return {
    width: PAGE.W,
    height: PAGE.H,
    den,
    view: [ox, oy, (b[2] - b[0]) / den, (b[3] - b[1]) / den],
    toPaper: (x, y) => [ox + (x - b[0]) / den, oy + (b[3] - y) / den],
    toPlan: (px, py) => [b[0] + (px - ox) * den, b[3] - (py - oy) * den],
  };
}

export function floorPlanSvg(room: RoomLayout, title: string, text_: DrawingText, css = true): string {
  const num = (x: number): string => (text_.number ? text_.number(x, 1) : formatNumber(x, 1));
  const t = text_.t;
  const sh = sheet(title, "", planBounds(room), { l: 0, r: 0, t: 0, b: 0 }, css);
  sh.out[sh.out.length - 2] = `<text class="rm-sub" x="${M}" y="${M + 11}" font-size="${TH}">${esc(`${t("room.plan")} · ${t("drawing.scale", { n: sh.den })} · mm`)}</text>`;
  const o = sh.out;

  if (room.closed) o.push(poly(sh, "rm-floor", room.walls.map((w) => w.start)));
  for (const w of room.walls) {
    // Wall band between the inner face and the outer face.
    o.push(poly(sh, "rm-wall", [w.start, w.end, outer(w, w.end), outer(w, w.start)]));
  }
  for (const op of room.openings) {
    const w = room.walls.find((x) => x.id === op.wall);
    if (!w) continue;
    const a = along(w, op.x);
    const b = along(w, op.x + op.width);
    o.push(poly(sh, "rm-open", [a, b, outer(w, b), outer(w, a)]));
    if (op.kind === "window") {
      const m1: [number, number] = mid(a, outer(w, a));
      const m2: [number, number] = mid(b, outer(w, b));
      o.push(line(sh, "rm-glass", m1, m2));
    } else if (op.kind === "door") {
      // Leaf swinging into the room, hinged at the chosen side.
      const hingeAt = op.hinge === "left" ? a : b;
      const free = op.hinge === "left" ? b : a;
      const leafEnd: [number, number] = [hingeAt[0] + w.n[0] * op.width, hingeAt[1] + w.n[1] * op.width];
      o.push(line(sh, "rm-swing", hingeAt, leafEnd));
      const [px, py] = sh.P(leafEnd[0], leafEnd[1]);
      const [fx, fy] = sh.P(free[0], free[1]);
      const r = r3(op.width / sh.den);
      const sweep = op.hinge === "left" ? 0 : 1;
      o.push(`<path class="rm-swing" d="M ${px} ${py} A ${r} ${r} 0 0 ${sweep} ${fx} ${fy}"/>`);
    }
  }
  // Roof slopes: dashed line where each slope reaches the flat ceiling (D44).
  for (const s of room.ceiling.slopes) {
    const w = room.walls.find((x) => x.id === s.wall);
    if (!w) continue;
    const dist = (room.ceiling.height - s.knee) / s.rise;
    const a: [number, number] = [w.start[0] + w.n[0] * dist, w.start[1] + w.n[1] * dist];
    const b: [number, number] = [w.end[0] + w.n[0] * dist, w.end[1] + w.n[1] * dist];
    o.push(line(sh, "rm-swing", a, b));
    o.push(text(sh, "rm-num", mid(a, b), `${num(s.angle)}° · ${num(s.knee)}`, TH * 0.8, "middle", 0, -TH * 0.4));
  }
  // Worktops under the cabinets' ids, wall units dashed on top.
  for (const wt of room.worktops) {
    o.push(poly(sh, "rm-top", wt.outline));
    const w = room.walls.find((x) => x.id === wt.wall)!;
    const at = (u: number, v: number): [number, number] => [w.start[0] + w.d[0] * (wt.x0 + u) + w.n[0] * v, w.start[1] + w.d[1] * (wt.x0 + u) + w.n[1] * v];
    for (const c of wt.cutouts) {
      if (!c.r) {
        o.push(poly(sh, "rm-cut", [at(c.u0, c.v0), at(c.u1, c.v0), at(c.u1, c.v1), at(c.u0, c.v1)]));
        continue;
      }
      // Rounded corners: lines between the corner tangent points, quarter arcs at the corners.
      const r = c.r;
      const pts: [number, number][] = [
        at(c.u0 + r, c.v0), at(c.u1 - r, c.v0), at(c.u1, c.v0 + r), at(c.u1, c.v1 - r),
        at(c.u1 - r, c.v1), at(c.u0 + r, c.v1), at(c.u0, c.v1 - r), at(c.u0, c.v0 + r),
      ].map(([x, y]) => sh.P(x, y));
      const rr = r3(r / sh.den);
      // The outline turns with d × n in the plan; paper flips Y, and SVG's sweep flag 1 is clockwise on paper.
      const sweep = w.d[0] * w.n[1] - w.d[1] * w.n[0] > 0 ? 0 : 1;
      const arc = (p: [number, number]): string => `A ${rr} ${rr} 0 0 ${sweep} ${p[0]} ${p[1]}`;
      const [p0, p1, p2, p3, p4, p5, p6, p7] = pts;
      o.push(`<path class="rm-cut" d="M ${p0![0]} ${p0![1]} L ${p1![0]} ${p1![1]} ${arc(p2!)} L ${p3![0]} ${p3![1]} ${arc(p4!)} L ${p5![0]} ${p5![1]} ${arc(p6!)} L ${p7![0]} ${p7![1]} ${arc(p0!)} Z"/>`);
    }
  }
  // Cabinets: wall units dashed over floor units.
  const order = [...room.placements].sort((a, b) => (a.kind === "wall" ? 1 : 0) - (b.kind === "wall" ? 1 : 0));
  for (const q of order) {
    const c = [q.origin, [q.origin[0] + q.d[0] * q.W, q.origin[1] + q.d[1] * q.W] as [number, number]];
    const pts: [number, number][] = [
      c[0]!,
      c[1]!,
      [c[1]![0] + q.n[0] * q.depth, c[1]![1] + q.n[1] * q.depth],
      [c[0]![0] + q.n[0] * q.depth, c[0]![1] + q.n[1] * q.depth],
    ];
    const topped = q.kind === "base" && room.worktops.some((wt) => wt.wall === q.wall && under(wt, q));
    if (!topped) o.push(poly(sh, q.kind === "wall" ? "rm-cab-wall" : "rm-cab", pts));
    const centre: [number, number] = [(pts[0]![0] + pts[2]![0]) / 2, (pts[0]![1] + pts[2]![1]) / 2];
    o.push(text(sh, "rm-id", centre, q.cabinet, TH * 0.9, "middle", 0, q.kind === "wall" ? -TH * 0.6 : TH * 0.9));
  }
  // Per wall: inner length, and the floor-unit chain just outside.
  for (const w of room.walls) {
    const outward: [number, number] = [-w.n[0], -w.n[1]];
    const floor = room.placements.filter((q) => q.wall === w.id && q.kind !== "wall");
    const chainPts = [0, w.length, ...floor.flatMap((q) => [q.x, q.x + q.W])];
    o.push(...chain(sh, w.start, w.d, outward, w.thickness + sh.den * 6, chainPts, num));
    o.push(...chain(sh, w.start, w.d, outward, w.thickness + sh.den * 13, [0, w.length], num));
    const ops = room.openings.filter((x) => x.wall === w.id);
    if (ops.length) o.push(...chain(sh, w.start, w.d, outward, w.thickness + sh.den * 20, [0, w.length, ...ops.flatMap((x) => [x.x, x.x + x.width])], num));
    // Wall name outside, beyond its dimension chains.
    const off = w.thickness + sh.den * (ops.length ? 27 : 20);
    const label: [number, number] = [w.start[0] + w.d[0] * w.length / 2 - w.n[0] * off, w.start[1] + w.d[1] * w.length / 2 - w.n[1] * off];
    // Beside a vertical wall the name starts at that distance, so it does not run back over the chains.
    const anchor = outward[0] > 0.5 ? "start" : outward[0] < -0.5 ? "end" : "middle";
    o.push(text(sh, "rm-id", label, `${t("room.wall")} ${w.id}`, TH, anchor, 0, TH * 0.35));
  }
  o.push(`</svg>\n`);
  return o.join("");
}

/**
 * A base unit stands under a worktop of its wall. In an inside corner the
 * worktop starts at the other worktop's front edge (D29), a little past
 * the unit's side, so overlap along the wall decides, not full cover.
 */
const under = (wt: WorktopLayout, q: CabinetPlacement): boolean => wt.x0 < q.x + q.W - 1 && wt.x1 > q.x + 1;

function outer(w: WallLayout, p: [number, number]): [number, number] {
  return [p[0] - w.n[0] * w.thickness, p[1] - w.n[1] * w.thickness];
}
function along(w: WallLayout, x: number): [number, number] {
  return [w.start[0] + w.d[0] * x, w.start[1] + w.d[1] * x];
}
const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// ---------------------------------------------------------------------------

/** Elevation of one wall, seen from inside the room. Model X along the wall, Y up. */
export function elevationSvg(
  room: RoomLayout,
  wallId: string,
  cabinets: readonly CabinetResult[],
  title: string,
  text_: DrawingText,
  css = true,
  opts: { openingSymbol?: OpeningSymbol | "none" } = {},
): string {
  const sym = opts.openingSymbol ?? "tip_at_handle";
  const symbol = sym === "none" ? undefined : sym;
  const num = (x: number): string => (text_.number ? text_.number(x, 1) : formatNumber(x, 1));
  const t = text_.t;
  const w = room.walls.find((x) => x.id === wallId);
  if (!w) return "";
  const bounds: [number, number, number, number] = [-700, -700, w.length + 300, w.height + 700];
  const sh = sheet(title, "", bounds, { l: 0, r: 0, t: 0, b: 0 }, css);
  sh.out[sh.out.length - 2] = `<text class="rm-sub" x="${M}" y="${M + 11}" font-size="${TH}">${esc(`${t("room.elevation")} ${t("room.wall")} ${w.id} · ${t("drawing.scale", { n: sh.den })} · mm`)}</text>`;
  const o = sh.out;
  // Wall face up to the ceiling line (sloped where a roof slope meets this wall, D44).
  const ceil = ceilingAlong(room.ceiling, w.start, w.end);
  o.push(poly(sh, "rm-floor", [[0, 0], [w.length, 0], ...ceil.map(([x, h]) => [x, Math.min(h, w.height)] as [number, number]).reverse()]));
  if (room.ceiling.slopes.length) {
    for (let k = 0; k + 1 < ceil.length; k++) o.push(line(sh, "rm-ceil", [ceil[k]![0], ceil[k]![1]], [ceil[k + 1]![0], ceil[k + 1]![1]]));
  }
  o.push(line(sh, "rm-dim", [0, 0], [w.length, 0]));
  for (const op of room.openings.filter((x) => x.wall === w.id)) {
    o.push(poly(sh, "rm-open", [[op.x, op.sill], [op.x + op.width, op.sill], [op.x + op.width, op.sill + op.height], [op.x, op.sill + op.height]]));
    if (op.kind === "window") o.push(line(sh, "rm-glass", [op.x, op.sill + op.height / 2], [op.x + op.width, op.sill + op.height / 2]));
  }
  const here = room.placements.filter((q) => q.wall === w.id);
  for (const q of here) {
    const c = cabinets.find((x) => x.resolved.cabinet.id === q.cabinet);
    if (!c) continue;
    const X = (x: number): number => q.x + x;
    // Carcase outline and plinth.
    // Carcase outline, with sloped top corners cut off (D47).
    const topXs = [...new Set(carcaseTopKinks(q))].sort((m, n) => n - m);
    o.push(poly(sh, "rm-cab", [[X(0), q.baseY], [X(q.W), q.baseY], ...topXs.map((x) => [X(x), q.baseY + carcaseTopAt(q, x)] as [number, number])]));
    if (q.kind !== "wall" && q.baseY > 0 && !room.plinths.length) {
      o.push(poly(sh, "rm-plinth", [[X(0), 0], [X(q.W), 0], [X(q.W), q.baseY], [X(0), q.baseY]]));
    }
    const fronts = ["door", "drawer_front", "blind_panel", "appliance_front", "flap", "ceiling_filler"];
    const hinges = hingeEdges(c);
    for (const f of c.parts.filter((p) => fronts.includes(p.role))) {
      const b = f.box;
      // Fillers cut to a slope carry their outline (u along X, v up).
      const pts: [number, number][] = f.outline
        ? f.outline.map(([u, v]) => [X(b.x + u), q.baseY + b.y + v])
        : [[X(b.x), q.baseY + b.y], [X(b.x + b.dx), q.baseY + b.y], [X(b.x + b.dx), q.baseY + b.y + b.dy], [X(b.x), q.baseY + b.y + b.dy]];
      o.push(poly(sh, "rm-front", pts));
      // Opening symbol on hinged fronts (doors, appliance fronts, lift-up flaps), as in the app's front views.
      const edge = f.outline ? undefined : hinges.get(f.code);
      if (edge && symbol) {
        const [ax, ay] = sh.P(X(b.x), q.baseY + b.y + b.dy);
        const [bx, by] = sh.P(X(b.x + b.dx), q.baseY + b.y);
        const tri = openingSymbolPoints({ x: ax, y: ay, w: bx - ax, h: by - ay }, edge, symbol);
        o.push(`<polyline class="rm-opening" points="${tri.map(([x, y]) => `${r3(x)},${r3(y)}`).join(" ")}"/>`);
      }
    }
    for (const h of c.handles) {
      const pts = h.points.map((p) => [X(p.x), q.baseY + p.y] as [number, number]);
      if (pts.length >= 2) o.push(line(sh, "rm-handle", pts[0]!, pts[pts.length - 1]!));
      else if (pts[0]) {
        const [x, y] = sh.P(pts[0][0], pts[0][1]);
        o.push(`<circle class="rm-front" cx="${x}" cy="${y}" r="${r3(Math.max(15 / sh.den, 0.4))}"/>`);
      }
    }
    const top = room.worktops.find((wt) => wt.wall === w.id && under(wt, q) && q.kind === "base");
    o.push(text(sh, "rm-id", [X(q.W / 2), q.baseY + q.H + (top ? top.t : 0) + 40], q.cabinet, TH * 0.9));
  }
  for (const p of room.plinths.filter((x) => x.wall === w.id)) {
    o.push(poly(sh, "rm-plinth", [[p.x0, p.y], [p.x1, p.y], [p.x1, p.y + p.h], [p.x0, p.y + p.h]]));
  }
  for (const wt of room.worktops.filter((x) => x.wall === w.id)) {
    o.push(poly(sh, "rm-top", [[wt.x0, wt.y], [wt.x1, wt.y], [wt.x1, wt.y + wt.t], [wt.x0, wt.y + wt.t]]));
  }
  // Chains: floor units below, wall units above, heights on the left.
  const floor = here.filter((q) => q.kind !== "wall");
  const wallU = here.filter((q) => q.kind === "wall");
  o.push(...chain(sh, [0, 0], [1, 0], [0, -1], 180, [0, w.length, ...floor.flatMap((q) => [q.x, q.x + q.W])], num));
  o.push(...chain(sh, [0, 0], [1, 0], [0, -1], 380, [0, w.length], num));
  if (wallU.length) o.push(...chain(sh, [0, w.height], [1, 0], [0, 1], 180, [0, w.length, ...wallU.flatMap((q) => [q.x, q.x + q.W])], num));
  const heights = [0, w.height, ...here.flatMap((q) => [q.baseY, q.baseY + q.H]), ...room.worktops.filter((x) => x.wall === w.id).map((x) => x.y + x.t)];
  o.push(...chain(sh, [0, 0], [0, 1], [-1, 0], 220, heights, num));
  o.push(`</svg>\n`);
  return o.join("");
}
