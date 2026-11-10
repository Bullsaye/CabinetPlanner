import type { HardwareUse } from "../cabinet/machining.ts";
import type { Library } from "../library.ts";
import { cutlistRows, type CutlistRow } from "../output/cutlist.ts";
import { formatNumber } from "../output/format.ts";
import type { Part, PartRole } from "../part.ts";
import type { DrawingText } from "./render.ts";
import { spread } from "./render.ts";
import { cross, dot, type Vec } from "./view.ts";

/**
 * Assembly drawing (DECISIONS.md D21): exploded axonometric view of one
 * cabinet with numbered balloons, the part list (positions match the
 * balloons) and the hardware list, on one A3 sheet, to scale.
 */
export interface AssemblyInput {
  cabinet: { id: string; name?: string; W: number; H: number; D: number };
  parts: readonly Part[];
  hardware: readonly HardwareUse[];
  library: Library;
  text: DrawingText;
  /** Project name and revision for the title. */
  project?: { name: string; revision: number };
  /** 0 = assembled, 1 = default spacing. */
  explode?: number;
  css?: boolean;
}

export interface AssemblyDrawing {
  svg: string;
  scale: number;
  /** Part list rows; `pos` is the balloon number. */
  rows: (CutlistRow & { pos: number })[];
}

/** Viewing direction (towards the viewer): front-right-above, front a little stronger. */
const V: Vec = norm([0.62, 0.55, 1]);
const R: Vec = norm(cross([0, 1, 0], V));
const P: Vec = cross(V, R);

function norm(v: Vec): Vec {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

const PAGE = { W: 420, H: 297 };
const M = 10;
const SCALES = [2, 5, 10, 20, 25, 50];

export const ASSEMBLY_CSS = `
.asm{font-family:"Inter",system-ui,sans-serif}.asm-sheet{fill:#fff}
.asm-f{stroke:#1b1f24;stroke-width:.22;stroke-linejoin:round}
.asm-top{fill:#f4f5f7}.asm-front{fill:#e2e5e9}.asm-side{fill:#c9ced5}
.asm-door.asm-top{fill:#eef3fb}.asm-door.asm-front{fill:#dbe6f6}.asm-door.asm-side{fill:#c3d2ea}
.asm-back.asm-front{fill:#d6d9de}.asm-back.asm-side{fill:#bfc4cb}
.asm-leader{stroke:#1b1f24;stroke-width:.18;fill:none}.asm-dot{fill:#1b1f24}
.asm-balloon{fill:#fff;stroke:#1b1f24;stroke-width:.3}.asm-num{fill:#1b1f24;font-weight:600;font-family:"JetBrains Mono",ui-monospace,monospace}
.asm-title{fill:#1b1f24;font-weight:600}.asm-sub{fill:#4a525c}.asm-head{fill:#1b1f24;font-weight:600}
.asm-cell{fill:#1b1f24}.asm-mono{fill:#1b1f24;font-family:"JetBrains Mono",ui-monospace,monospace}
.asm-rule{stroke:#c9ced6;stroke-width:.2}.asm-rule-strong{stroke:#1b1f24;stroke-width:.3}`;

/** Explode offset per role, in cabinet mm. Forward moves scale with the larger of depth and height. */
function offset(role: PartRole, c: { W: number; H: number; D: number }, e: number): Vec {
  const k = e;
  const fwd = Math.max(c.D, 0.6 * c.H);
  switch (role) {
    case "side_left":
      return [-0.42 * c.W * k, 0, 0];
    case "side_right":
      return [0.42 * c.W * k, 0, 0];
    case "top":
    case "top_slope":
    case "rail_front":
    case "rail_rear":
      return [0, 0.32 * c.H * k, 0];
    case "rail_bottom":
    case "bottom":
      return [0, -0.22 * c.H * k, 0];
    case "back":
      return [0, 0, -0.5 * fwd * k];
    case "shelf":
      return [0, 0, 0.5 * fwd * k];
    case "worktop":
      return [0, 0.4 * c.H * k, 0];
    case "plinth":
      return [0, -0.3 * c.H * k, 0.6 * fwd * k];
    case "fixed_shelf":
      return [0, 0.06 * c.H * k, 0.35 * fwd * k];
    case "partition":
      return [0, 0.12 * c.H * k, 0.2 * fwd * k];
    case "door":
    case "blind_panel":
    case "appliance_front":
    case "flap":
    case "ceiling_filler":
    case "drawer_front":
      return [0, -0.08 * c.H * k, 1.25 * fwd * k];
    case "drawer_side_left":
    case "drawer_side_right":
    case "drawer_inner":
    case "drawer_back":
    case "drawer_bottom":
      return [0, 0, 0.8 * fwd * k];
  }
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r3 = (x: number): number => {
  const v = Math.round(x * 1000) / 1000;
  return v === 0 ? 0 : v;
};

export function drawAssembly(input: AssemblyInput): AssemblyDrawing {
  const { cabinet: c, text } = input;
  const t = text.t;
  const e = input.explode ?? 1;
  const h = 2.5;

  // Part list: identical parts share a position number.
  const grouped = cutlistRows(input.parts, input.library, { group: true });
  const rows = grouped.map((r, i) => ({ ...r, pos: i + 1 }));
  const posOf = new Map<string, number>();
  for (const r of rows) for (const id of r.parts) posOf.set(id, r.pos);

  // Faces of each exploded part box, projected to the view plane (mm, Y up).
  interface Face {
    pts: [number, number][];
    cls: string;
    area: number;
  }
  interface Shape {
    part: Part;
    depth: number;
    faces: Face[];
    anchor: [number, number];
  }
  const shapes: Shape[] = input.parts.map((part) => {
    const o = offset(part.role, c, e);
    const b = part.box;
    const x0 = b.x + o[0], y0 = b.y + o[1], z0 = b.z + o[2];
    const x1 = x0 + b.dx, y1 = y0 + b.dy, z1 = z0 + b.dz;
    const pr = (x: number, y: number, z: number): [number, number] => [dot([x, y, z], R), dot([x, y, z], P)];
    const roleCls = part.role === "door" || part.role === "drawer_front" ? " asm-door" : part.role === "back" ? " asm-back" : "";
    const quad = (pts: [number, number][], cls: string): Face => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]!;
        const [bx, by] = pts[(i + 1) % pts.length]!;
        a += ax * by - bx * ay;
      }
      return { pts, cls: cls + roleCls, area: Math.abs(a / 2) };
    };
    // Visible faces for a viewer at +x, +y, +z. A part cut by a slope (D47):
    // its cross-section at the front and the side faces seen from above/right.
    const prof = part.profile?.points.map(([px, py]) => [px + o[0], py + o[1]] as [number, number]);
    const faces = prof
      ? [
          quad(prof.map(([px, py]) => pr(px, py, z1)), "asm-front"),
          ...prof.flatMap(([ax, ay], i) => {
            const [bx, by] = prof[(i + 1) % prof.length]!;
            // Outward normal of a counter-clockwise edge: (dy, −dx).
            const nx = by - ay;
            const ny = -(bx - ax);
            if (nx <= 1e-9 && ny <= 1e-9) return [];
            return [quad([pr(ax, ay, z0), pr(bx, by, z0), pr(bx, by, z1), pr(ax, ay, z1)], ny > Math.abs(nx) ? "asm-top" : "asm-side")];
          }),
        ]
      : [
      quad([pr(x0, y1, z0), pr(x1, y1, z0), pr(x1, y1, z1), pr(x0, y1, z1)], "asm-top"),
      quad([pr(x0, y0, z1), pr(x1, y0, z1), pr(x1, y1, z1), pr(x0, y1, z1)], "asm-front"),
      quad([pr(x1, y0, z0), pr(x1, y0, z1), pr(x1, y1, z1), pr(x1, y1, z0)], "asm-side"),
        ];
    const big = faces.reduce((a, f) => (f.area > a.area ? f : a));
    const cx = big.pts.reduce((s, q) => s + q[0], 0) / big.pts.length;
    const cy = big.pts.reduce((s, q) => s + q[1], 0) / big.pts.length;
    const centre: Vec = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    return { part, depth: dot(centre, V), faces, anchor: [cx, cy] };
  });
  // Painter's algorithm: far parts first.
  shapes.sort((a, b) => a.depth - b.depth || a.part.id.localeCompare(b.part.id));

  // Balloon anchors must sit on a visible spot: try points on each face
  // (largest first) until one is not covered by a part drawn later.
  const inside = (pt: [number, number], poly: [number, number][]): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!;
      const [xj, yj] = poly[j]!;
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const SAMPLES: [number, number][] = [
    [0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7],
    [0.5, 0.15], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5], [0.15, 0.15], [0.85, 0.85], [0.15, 0.85], [0.85, 0.15],
  ];
  shapes.forEach((sh, i) => {
    const later = shapes.slice(i + 1).flatMap((o) => o.faces.filter((f) => f.area > 1e-6).map((f) => f.pts));
    const faces = [...sh.faces].filter((f) => f.area > 1e-6).sort((a, b) => b.area - a.area);
    for (const f of faces) {
      const [a, b, c2, d] = f.pts as [[number, number], [number, number], [number, number], [number, number]];
      for (const [u, v] of SAMPLES) {
        // Bilinear point on the quad.
        const pt: [number, number] = [
          (1 - u) * (1 - v) * a[0] + u * (1 - v) * b[0] + u * v * c2[0] + (1 - u) * v * d[0],
          (1 - u) * (1 - v) * a[1] + u * (1 - v) * b[1] + u * v * c2[1] + (1 - u) * v * d[1],
        ];
        if (!later.some((poly) => inside(pt, poly))) {
          sh.anchor = pt;
          return;
        }
      }
    }
  });

  // Scale to fit the drawing area (left of the part list).
  const all = shapes.flatMap((s) => s.faces.flatMap((f) => f.pts));
  const minX = Math.min(...all.map((q) => q[0]));
  const maxX = Math.max(...all.map((q) => q[0]));
  const minY = Math.min(...all.map((q) => q[1]));
  const maxY = Math.max(...all.map((q) => q[1]));
  const tableW = 168;
  const areaW = PAGE.W - 2 * M - tableW - 10 - 2 * 16; // balloon columns
  const headerH = 22;
  const areaH = PAGE.H - 2 * M - headerH - 8;
  const den = SCALES.find((d) => (maxX - minX) / d <= areaW && (maxY - minY) / d <= areaH) ?? 50;
  const s = 1 / den;
  const dw = (maxX - minX) * s;
  const dh = (maxY - minY) * s;
  const ox = M + 16 + (areaW - dw) / 2;
  const oy = M + headerH + 4 + (areaH - dh) / 2; // top of the drawing on the page
  const X = (x: number): number => r3(ox + (x - minX) * s);
  const Y = (y: number): number => r3(oy + (maxY - y) * s);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.W} ${PAGE.H}" width="${PAGE.W}mm" height="${PAGE.H}mm" class="asm">`);
  if (input.css !== false) out.push(`<style>${ASSEMBLY_CSS}</style>`);
  out.push(`<rect class="asm-sheet" x="0" y="0" width="${PAGE.W}" height="${PAGE.H}"/>`);

  // Title.
  const num = (x: number): string => formatNumber(x);
  const title = `${c.id}${c.name ? ` · ${c.name}` : ""}`;
  const sub = [
    t("assembly.title"),
    `${num(c.W)} × ${num(c.H)} × ${num(c.D)} mm`,
    t("drawing.scale", { n: den }),
    ...(input.project ? [t("assembly.project", { name: input.project.name, rev: input.project.revision })] : []),
  ].join(" · ");
  out.push(`<text class="asm-title" x="${M}" y="${M + 5}" font-size="${h * 1.6}">${esc(title)}</text>`);
  out.push(`<text class="asm-sub" x="${M}" y="${M + 11}" font-size="${h}">${esc(sub)}</text>`);
  out.push(`<line class="asm-rule" x1="${M}" y1="${M + headerH - 4}" x2="${PAGE.W - M}" y2="${M + headerH - 4}"/>`);

  // Parts.
  for (const sh of shapes) {
    for (const f of sh.faces) {
      if (f.area < 1e-6) continue;
      out.push(`<polygon class="asm-f ${f.cls}" points="${f.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}"/>`);
    }
  }

  // Balloons in two columns, sorted by height, spread so they never touch.
  const midX = (minX + maxX) / 2;
  const br = 3.2;
  const columns: { x: number; items: { y: number; ax: number; ay: number; pos: number }[] }[] = [
    { x: ox - 10, items: [] },
    { x: ox + dw + 10, items: [] },
  ];
  for (const sh of [...shapes].sort((a, b) => a.part.id.localeCompare(b.part.id))) {
    const [ax, ay] = sh.anchor;
    const col = columns[ax < midX ? 0 : 1]!;
    col.items.push({ y: Y(ay), ax: X(ax), ay: Y(ay), pos: posOf.get(sh.part.id)! });
  }
  for (const col of columns) {
    col.items.sort((a, b) => a.y - b.y);
    const ys = spread(col.items.map((i) => i.y), br * 2 + 1.6);
    col.items.forEach((it, i) => {
      const by = r3(ys[i]!);
      const left = col === columns[0];
      const ex = left ? col.x + br : col.x - br;
      out.push(`<polyline class="asm-leader" points="${r3(ex)},${by} ${it.ax},${it.ay}"/>`);
      out.push(`<circle class="asm-dot" cx="${it.ax}" cy="${it.ay}" r="0.55"/>`);
      out.push(`<circle class="asm-balloon" cx="${r3(col.x)}" cy="${by}" r="${br}"/>`);
      out.push(`<text class="asm-num" x="${r3(col.x)}" y="${r3(by + h * 0.38)}" font-size="${h * 1.05}" text-anchor="middle">${it.pos}</text>`);
    });
  }

  // Part list.
  const tx = PAGE.W - M - tableW;
  let ty = M + headerH + 4;
  const cols = [
    { k: "pos", x: 0, w: 8, end: true },
    { k: "qty", x: 8, w: 9, end: true },
    { k: "name", x: 20, w: 34, end: false },
    { k: "size", x: 56, w: 36, end: false },
    { k: "material", x: 94, w: 44, end: false },
    { k: "edges", x: 140, w: 28, end: false },
  ];
  out.push(`<text class="asm-head" x="${tx}" y="${ty}" font-size="${h * 1.15}">${esc(t("assembly.parts"))}</text>`);
  ty += 6;
  for (const col of cols) {
    const x = col.end ? tx + col.x + col.w : tx + col.x;
    out.push(`<text class="asm-head" x="${r3(x)}" y="${ty}" font-size="${h}"${col.end ? ' text-anchor="end"' : ""}>${esc(t(`assembly.col.${col.k}`))}</text>`);
  }
  out.push(`<line class="asm-rule-strong" x1="${tx}" y1="${ty + 1.5}" x2="${tx + tableW}" y2="${ty + 1.5}"/>`);
  const edgeCode = (id: string | null): string => (id === null ? "–" : (text.edgeCode?.(id) ?? id));
  for (const r of rows) {
    ty += h * 2;
    const part = input.parts.find((p) => p.id === r.part)!;
    const cells: Record<string, string> = {
      pos: String(r.pos),
      qty: String(r.qty),
      name: roleLabel(r, text),
      // Mitred parts (D47): the bevel angles after the size, e.g. "∠22.5°".
      size: `${num(r.length)} × ${num(r.width)} × ${num(r.thickness)}${Object.keys(r.bevels).length ? ` ∠${[...new Set(Object.values(r.bevels))].map((x) => `${num(x!)}°`).join("/")}` : ""}`,
      material: text.materialName?.(r.material) ?? r.material,
      edges: [part.edges.l1, part.edges.l2, part.edges.w1, part.edges.w2].map(edgeCode).join(" "),
    };
    for (const col of cols) {
      const x = col.end ? tx + col.x + col.w : tx + col.x;
      const mono = col.k === "size" || col.k === "edges" || col.k === "pos" || col.k === "qty";
      out.push(
        `<text class="${mono ? "asm-mono" : "asm-cell"}" x="${r3(x)}" y="${r3(ty)}" font-size="${h}"${col.end ? ' text-anchor="end"' : ""}>${esc(cells[col.k]!)}</text>`,
      );
    }
    out.push(`<line class="asm-rule" x1="${tx}" y1="${r3(ty + h * 0.7)}" x2="${tx + tableW}" y2="${r3(ty + h * 0.7)}"/>`);
  }
  out.push(`<text class="asm-sub" x="${tx}" y="${r3(ty + h * 2.2)}" font-size="${h * 0.85}">${esc(t("assembly.edges_note"))}</text>`);

  // Hardware list.
  if (input.hardware.length) {
    ty += h * 5.5;
    out.push(`<text class="asm-head" x="${tx}" y="${r3(ty)}" font-size="${h * 1.15}">${esc(t("assembly.hardware"))}</text>`);
    ty += 6;
    out.push(`<text class="asm-head" x="${r3(tx + 17)}" y="${r3(ty)}" font-size="${h}" text-anchor="end">${esc(t("assembly.col.qty"))}</text>`);
    out.push(`<text class="asm-head" x="${r3(tx + 20)}" y="${r3(ty)}" font-size="${h}">${esc(t("assembly.col.item"))}</text>`);
    out.push(`<line class="asm-rule-strong" x1="${tx}" y1="${r3(ty + 1.5)}" x2="${tx + tableW}" y2="${r3(ty + 1.5)}"/>`);
    for (const hw of input.hardware) {
      ty += h * 2;
      const name = text.hardwareName?.(hw.item) ?? hw.item;
      out.push(`<text class="asm-mono" x="${r3(tx + 17)}" y="${r3(ty)}" font-size="${h}" text-anchor="end">${hw.qty}</text>`);
      out.push(`<text class="asm-cell" x="${r3(tx + 20)}" y="${r3(ty)}" font-size="${h}">${esc(fit(name, tableW - 20, h))}</text>`);
      out.push(`<line class="asm-rule" x1="${tx}" y1="${r3(ty + h * 0.7)}" x2="${tx + tableW}" y2="${r3(ty + h * 0.7)}"/>`);
    }
  }

  out.push(`</svg>\n`);
  return { svg: out.join(""), scale: den, rows };
}

/** Shortens text to fit a width (approximate glyph width 0.55 × size). */
function fit(s: string, width: number, size: number): string {
  const max = Math.floor(width / (size * 0.55));
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function roleLabel(r: CutlistRow, text: DrawingText): string {
  const codes = new Set(r.parts.map((p) => p.slice(p.lastIndexOf("-") + 1)));
  if (codes.has("SL") && codes.has("SR")) return text.t("role.side_pair");
  if (codes.has("RF") && codes.has("RR")) return text.t("role.rail_pair");
  return text.roleName?.(r.role) ?? text.t(`role.${r.role}`);
}
