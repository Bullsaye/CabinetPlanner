import { deflate } from "./deflate.ts";
import { readFont, type FontFile } from "./font.ts";
import { fitToPaper, paperNote, type PaperFit, type PdfPaper } from "./paper.ts";
import { crc32 } from "./zip.ts";

/**
 * Drawing sheets as one multi-page vector PDF (D75), written here without a
 * library: the sheets are SVG from our own drawing code, a small fixed
 * vocabulary (rect, line, circle, polygon, polyline, path, text; classes
 * styled by the embedded stylesheet), so a direct converter is shorter than
 * a general SVG renderer and its output is exact and deterministic.
 *
 * - Geometry stays vector, in mm at the sheet's scale; one sheet per page.
 * - Text stays text (selectable, searchable) in the fonts the host passes
 *   in; only the glyphs used are embedded.
 * - Same input, same bytes: no clock, no random ids. The creation date is
 *   the timestamp passed in, or absent.
 */

/**
 * Font files per face, each a fallback chain (first file that has the
 * character wins, e.g. latin then latin-ext): sfnt or WOFF 1 with TrueType
 * outlines. `sans` is required; a missing face falls back to it.
 */
export interface PdfFonts {
  sans: readonly Uint8Array[];
  sansBold?: readonly Uint8Array[];
  mono?: readonly Uint8Array[];
  monoBold?: readonly Uint8Array[];
}

export interface PdfSheet {
  /** Shown in the PDF's outline (bookmarks). */
  name: string;
  svg: string;
  /** Sheet size in mm. */
  page: { w: number; h: number };
}

export interface PdfOptions {
  fonts: PdfFonts;
  paper?: PdfPaper;
  /**
   * The note on a sheet that had to be reduced to fit its paper (D77), from
   * the host's translator: e.g. (71) => "Reduced to 71 % – the stated scales
   * do not apply". Without it a reduced page carries no note.
   */
  reducedNote?: (percent: number) => string;
  title?: string;
  /** ISO timestamp (e.g. "2026-03-01T09:30:00") for the creation date; omitted: no date in the file. */
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// SVG reading (our own output only)

interface El {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

const unescape = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e === "amp" ? "&" : e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );

function elements(svg: string): El[] {
  const out: El[] = [];
  const re = /<([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]!] = unescape(a[2]!);
    let text = "";
    if (!m[3] && (m[1] === "text" || m[1] === "style")) {
      const close = svg.indexOf(`</${m[1]}>`, re.lastIndex);
      if (close >= 0) {
        text = svg.slice(re.lastIndex, close);
        re.lastIndex = close;
      }
      if (m[1] === "text") text = unescape(text.replace(/<[^>]*>/g, ""));
    }
    out.push({ tag: m[1]!, attrs, text });
  }
  return out;
}

type Style = Record<string, string>;
interface Rule {
  classes: string[];
  decl: Style;
}

function cssRules(css: string): Rule[] {
  const rules: Rule[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl: Style = {};
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    for (const sel of m[1]!.split(",")) {
      const s = sel.trim();
      // Class selectors only (".a" or ".a.b"): all our drawing styles are.
      if (/^(\.[\w-]+)+$/.test(s)) rules.push({ classes: s.slice(1).split("."), decl });
    }
  }
  // Stable sort: more classes win, later rules win among equals.
  return rules.map((r, i) => ({ r, i })).sort((a, b) => a.r.classes.length - b.r.classes.length || a.i - b.i).map((x) => x.r);
}

const INHERITED = ["font-family", "font-weight", "letter-spacing", "text-transform"];
const PRESENTATION = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linejoin", "stroke-linecap", "opacity", "font-family", "font-weight", "letter-spacing"];

function styleOf(el: El, rules: Rule[], root: Style): Style {
  const style: Style = {};
  for (const k of INHERITED) if (root[k] !== undefined) style[k] = root[k]!;
  for (const k of PRESENTATION) if (el.attrs[k] !== undefined) style[k] = el.attrs[k]!;
  const classes = new Set((el.attrs["class"] ?? "").split(/\s+/));
  for (const r of rules) if (r.classes.every((c) => classes.has(c))) Object.assign(style, r.decl);
  return style;
}

/** "#rgb", "#rrggbb", black/white; undefined for none. Anything else is drawn black. */
function colour(v: string | undefined, fallback: string | undefined): [number, number, number] | undefined {
  const s = (v ?? fallback ?? "none").trim().toLowerCase();
  if (s === "none" || s === "transparent") return undefined;
  if (s === "white") return [1, 1, 1];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return [0, 0, 0];
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const num = (v: string | undefined, fallback = 0): number => {
  const x = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(x) ? x : fallback;
};

/** PDF number: up to 4 decimals, never exponent notation. */
const f = (x: number): string => {
  const v = Math.round(x * 10000) / 10000;
  return v === 0 ? "0" : String(v);
};

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function transformOf(v: string | undefined): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  for (const t of (v ?? "").matchAll(/(translate|rotate|scale|matrix)\(([^)]*)\)/g)) {
    const a = t[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
    if (t[1] === "translate") m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
    else if (t[1] === "scale") m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    else if (t[1] === "matrix" && a.length === 6) m = mul(m, a as Matrix);
    else if (t[1] === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      m = mul(mul(mul(m, [1, 0, 0, 1, cx, cy]), [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return m;
}

const K = 0.5522847498; // Bézier handle for a quarter circle

/** An SVG elliptical arc as cubic Béziers (endpoint to centre form, SVG 1.1 F.6.5). */
function arc(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number): string {
  if (rx === 0 || ry === 0) return `${f(x2)} ${f(y2)} l\n`;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = c * dx + s * dy;
  const yp = -s * dx + c * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const d = rx * rx * yp * yp + ry * ry * xp * xp;
  const q = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - d) / d));
  const cxp = (q * rx * yp) / ry;
  const cyp = (-q * ry * xp) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2;
  const cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number): number => Math.atan2(uy, ux);
  const a1 = ang((xp - cxp) / rx, (yp - cyp) / ry);
  let da = ang((-xp - cxp) / rx, (-yp - cyp) / ry) - a1;
  if (sweep && da < 0) da += 2 * Math.PI;
  if (!sweep && da > 0) da -= 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2) - 1e-9));
  const step = da / n;
  const t = (4 / 3) * Math.tan(step / 4);
  const pt = (a: number): [number, number, number, number] => {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Point and derivative on the ellipse.
    return [cx + c * rx * ca - s * ry * sa, cy + s * rx * ca + c * ry * sa, -c * rx * sa - s * ry * ca, -s * rx * sa + c * ry * ca];
  };
  let out = "";
  for (let i = 0; i < n; i++) {
    const [px, py, pdx, pdy] = pt(a1 + i * step);
    const [qx, qy, qdx, qdy] = pt(a1 + (i + 1) * step);
    out += `${f(px + t * pdx)} ${f(py + t * pdy)} ${f(qx - t * qdx)} ${f(qy - t * qdy)} ${f(qx)} ${f(qy)} c\n`;
  }
  return out;
}

function pathOps(d: string): string {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let out = "";
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  const n = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case "M":
        x = ox + n();
        y = oy + n();
        sx = x;
        sy = y;
        out += `${f(x)} ${f(y)} m\n`;
        cmd = rel ? "l" : "L";
        break;
      case "L":
        x = ox + n();
        y = oy + n();
        out += `${f(x)} ${f(y)} l\n`;
        break;
      case "H":
        x = ox + n();
        out += `${f(x)} ${f(y)} l\n`;
        break;
      case "V":
        y = oy + n();
        out += `${f(x)} ${f(y)} l\n`;
        break;
      case "C": {
        const p = [n(), n(), n(), n(), n(), n()];
        out += `${f(ox + p[0]!)} ${f(oy + p[1]!)} ${f(ox + p[2]!)} ${f(oy + p[3]!)} ${f(ox + p[4]!)} ${f(oy + p[5]!)} c\n`;
        x = ox + p[4]!;
        y = oy + p[5]!;
        break;
      }
      case "Q": {
        const [qx, qy, ex, ey] = [ox + n(), oy + n(), ox + n(), oy + n()];
        out += `${f(x + (2 / 3) * (qx - x))} ${f(y + (2 / 3) * (qy - y))} ${f(ex + (2 / 3) * (qx - ex))} ${f(ey + (2 / 3) * (qy - ey))} ${f(ex)} ${f(ey)} c\n`;
        x = ex;
        y = ey;
        break;
      }
      case "A": {
        const [rx, ry, rot, large, sweep] = [n(), n(), n(), n(), n()];
        const ex = ox + n();
        const ey = oy + n();
        out += arc(x, y, rx, ry, (rot * Math.PI) / 180, large !== 0, sweep !== 0, ex, ey);
        x = ex;
        y = ey;
        break;
      }
      case "Z":
        out += "h\n";
        x = sx;
        y = sy;
        break;
      default:
        // A command our drawings never write: stop instead of drawing something wrong.
        throw new Error(`pdf: path command ${cmd} is not supported`);
    }
  }
  return out;
}

function shapeOps(el: El): string {
  const a = el.attrs;
  switch (el.tag) {
    case "rect": {
      const [x, y, w, h] = [num(a["x"]), num(a["y"]), num(a["width"]), num(a["height"])];
      const r = Math.min(num(a["rx"], num(a["ry"])), w / 2, h / 2);
      if (r <= 0) return `${f(x)} ${f(y)} ${f(w)} ${f(h)} re\n`;
      const k = r * K;
      return (
        `${f(x + r)} ${f(y)} m\n${f(x + w - r)} ${f(y)} l\n${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c\n` +
        `${f(x + w)} ${f(y + h - r)} l\n${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c\n` +
        `${f(x + r)} ${f(y + h)} l\n${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c\n` +
        `${f(x)} ${f(y + r)} l\n${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c\nh\n`
      );
    }
    case "circle": {
      const [cx, cy, r] = [num(a["cx"]), num(a["cy"]), num(a["r"])];
      const k = r * K;
      return (
        `${f(cx + r)} ${f(cy)} m\n${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c\n` +
        `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c\n` +
        `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c\n` +
        `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c\nh\n`
      );
    }
    case "line":
      return `${f(num(a["x1"]))} ${f(num(a["y1"]))} m\n${f(num(a["x2"]))} ${f(num(a["y2"]))} l\n`;
    case "polygon":
    case "polyline": {
      const p = (a["points"] ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
      let out = "";
      for (let i = 0; i + 1 < p.length; i += 2) out += `${f(p[i]!)} ${f(p[i + 1]!)} ${i ? "l" : "m"}\n`;
      return out && el.tag === "polygon" ? out + "h\n" : out;
    }
    case "path":
      return pathOps(a["d"] ?? "");
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Fonts in the document

interface DocFont {
  file: FontFile;
  /** Resource name, e.g. "F1". */
  res: string;
  /** Glyph → the first character it was used for (for copy and search). */
  used: Map<number, string>;
}

class FontBook {
  private readonly faces = new Map<string, FontFile[]>();
  private readonly byFile = new Map<FontFile, DocFont>();
  readonly fonts: DocFont[] = [];
  constructor(private readonly input: PdfFonts) {
    if (!input.sans?.length) throw new Error("pdf: the sans font is required");
  }
  private chain(face: keyof PdfFonts): FontFile[] {
    let c = this.faces.get(face);
    if (!c) {
      const files = this.input[face]?.length ? this.input[face]! : this.input.sans;
      c = face !== "sans" && files === this.input.sans ? this.chain("sans") : files.map(readFont);
      this.faces.set(face, c);
    }
    return c;
  }
  /** Splits text into runs of one font each; a character no file has is drawn with the first file's "missing" glyph. */
  runs(face: keyof PdfFonts, text: string): { font: DocFont; glyphs: number[]; width: number }[] {
    const chain = this.chain(face);
    const out: { font: DocFont; glyphs: number[]; width: number }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const file = chain.find((x) => x.glyph(cp) !== undefined) ?? chain[0]!;
      let font = this.byFile.get(file);
      if (!font) {
        font = { file, res: `F${this.fonts.length + 1}`, used: new Map() };
        this.byFile.set(file, font);
        this.fonts.push(font);
      }
      const g = file.glyph(cp) ?? 0;
      if (!font.used.has(g)) font.used.set(g, ch);
      const last = out[out.length - 1];
      const run = last && last.font === font ? last : (out.push({ font, glyphs: [], width: 0 }), out[out.length - 1]!);
      run.glyphs.push(g);
      run.width += file.advance(g) / file.unitsPerEm;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Page content

interface Gs {
  /** Opacity values in use → resource names. */
  names: Map<string, string>;
}

function pageContent(sheet: PdfSheet, fit: PaperFit, book: FontBook, gs: Gs): string {
  const els = elements(sheet.svg);
  const root = els.find((e) => e.tag === "svg");
  const rules = cssRules(els.filter((e) => e.tag === "style").map((e) => e.text).join("\n"));
  const rootStyle = root ? styleOf(root, rules, {}) : {};
  // The drawing's own coordinates (viewBox) on the sheet: one scale for both
  // directions, centred — a sheet can never come out stretched.
  const vb = (root?.attrs["viewBox"] ?? "").split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb[2]! > 0 && vb[3]! > 0 ? (vb as [number, number, number, number]) : [0, 0, sheet.page.w, sheet.page.h];
  const inner = Math.min(sheet.page.w / vw, sheet.page.h / vh);
  const s = fit.scale * inner;
  const pt = 72 / 25.4;
  const tx = fit.x + ((sheet.page.w - vw * inner) / 2) * fit.scale - vx * s;
  const ty = fit.y + ((sheet.page.h - vh * inner) / 2) * fit.scale - vy * s;

  let out = `q\n${f(s * pt)} 0 0 ${f(-s * pt)} ${f(tx * pt)} ${f((fit.h - ty) * pt)} cm\n`;
  // Graphics state as last written, so unchanged values are not repeated.
  const state: Record<string, string> = {};
  const set = (key: string, op: string): void => {
    if (state[key] !== op) {
      state[key] = op;
      out += op + "\n";
    }
  };
  const opacity = (v: string | undefined): void => {
    const o = Math.min(1, Math.max(0, num(v, 1)));
    const key = f(o);
    if (key === "1" && !gs.names.size) return;
    if (!gs.names.has(key)) gs.names.set(key, `G${gs.names.size + 1}`);
    set("gs", `/${gs.names.get(key)} gs`);
  };
  const dash = (v: string | undefined): string => {
    const d = !v || v === "none" ? [] : v.split(/[\s,]+/).filter(Boolean).map(Number);
    return `[${(d.length % 2 ? [...d, ...d] : d).map(f).join(" ")}] 0 d`;
  };

  for (const el of els) {
    if (el === root || el.tag === "style" || el.tag === "svg") continue;
    const st = styleOf(el, rules, rootStyle);
    if (el.tag === "text") {
      const fill = colour(st["fill"], "#000");
      const size = num(el.attrs["font-size"], 4);
      let text = el.text;
      if (!fill || !text || size <= 0) continue;
      if (st["text-transform"] === "uppercase") text = text.toUpperCase();
      const mono = /mono|courier/i.test(st["font-family"] ?? "");
      const bold = st["font-weight"] === "bold" || num(st["font-weight"], 400) >= 600;
      const runs = book.runs(mono ? (bold ? "monoBold" : "mono") : bold ? "sansBold" : "sans", text);
      const ls = /em$/.test(st["letter-spacing"] ?? "") ? num(st["letter-spacing"]) * size : num(st["letter-spacing"]);
      const width = runs.reduce((a, r) => a + r.width * size + r.glyphs.length * ls, 0);
      const anchor = el.attrs["text-anchor"];
      const dx = anchor === "middle" ? -width / 2 : anchor === "end" ? -width : 0;
      // Glyphs are y-up; the page matrix flips y, so flip back at the text origin.
      const m = mul(transformOf(el.attrs["transform"]), [1, 0, 0, -1, num(el.attrs["x"]) + dx, num(el.attrs["y"])]);
      opacity(st["opacity"]);
      set("fill", `${fill.map(f).join(" ")} rg`);
      out += `BT\n${f(ls)} Tc\n${m.map(f).join(" ")} Tm\n`;
      for (const r of runs) {
        out += `/${r.font.res} ${f(size)} Tf\n<${r.glyphs.map((g) => g.toString(16).padStart(4, "0")).join("")}> Tj\n`;
      }
      out += "ET\n";
      continue;
    }
    const ops = shapeOps(el);
    if (!ops) continue;
    // SVG defaults: black fill, no stroke; a line has no area to fill.
    const fill = el.tag === "line" ? undefined : colour(st["fill"], "#000");
    const stroke = colour(st["stroke"], "none");
    if (!fill && !stroke) continue;
    const t = el.attrs["transform"];
    opacity(st["opacity"]);
    if (fill) set("fill", `${fill.map(f).join(" ")} rg`);
    if (stroke) {
      set("stroke", `${stroke.map(f).join(" ")} RG`);
      set("width", `${f(num(st["stroke-width"], 1))} w`);
      set("dash", dash(st["stroke-dasharray"]));
      set("join", `${st["stroke-linejoin"] === "round" ? 1 : st["stroke-linejoin"] === "bevel" ? 2 : 0} j`);
      set("cap", `${st["stroke-linecap"] === "round" ? 1 : st["stroke-linecap"] === "square" ? 2 : 0} J`);
    }
    if (t) out += `q\n${transformOf(t).map(f).join(" ")} cm\n`;
    out += ops + (fill && stroke ? "B" : fill ? "f" : "S") + "\n";
    if (t) out += "Q\n";
  }
  return out + "Q\n";
}

// ---------------------------------------------------------------------------
// File

const latin1 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

/** PDF text string: UTF-16BE with a byte order mark, as hex (any character, no escaping). */
const textString = (s: string): string => {
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
};

function toUnicode(font: DocFont): string {
  const pairs = [...font.used.entries()].filter(([g]) => g !== 0).sort((a, b) => a[0] - b[0]);
  let body = "";
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100);
    body += `${part.length} beginbfchar\n`;
    for (const [g, ch] of part) {
      let hex = "";
      for (let k = 0; k < ch.length; k++) hex += ch.charCodeAt(k).toString(16).padStart(4, "0");
      body += `<${g.toString(16).padStart(4, "0")}> <${hex}>\n`;
    }
    body += "endbfchar\n";
  }
  return (
    "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
    "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
    body +
    "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
  );
}

/** Six capital letters in front of a subset font's name (PDF 32000, 9.6.4), fixed per font. */
const subsetTag = (i: number): string => {
  let s = "";
  for (let k = 0, v = i + 1; k < 6; k++, v = Math.floor(v / 26)) s = String.fromCharCode(65 + (v % 26)) + s;
  return s;
};

/**
 * The sheets as one PDF, one sheet per page, in the given order. Throws when
 * the fonts cannot be read (a host bug); never on drawing content.
 */
export function sheetsPdf(sheets: readonly PdfSheet[], opts: PdfOptions): Uint8Array {
  const book = new FontBook(opts.fonts);
  const gs: Gs = { names: new Map() };
  const objects: (Uint8Array | undefined)[] = [];
  const reserve = (): number => objects.push(undefined);
  const put = (id: number, dict: string, stream?: Uint8Array): void => {
    if (!stream) {
      objects[id - 1] = latin1(`${id} 0 obj\n${dict}\nendobj\n`);
      return;
    }
    const head = latin1(`${id} 0 obj\n${dict.replace(/>>$/, `/Length ${stream.length} >>`)}\nstream\n`);
    const tail = latin1("\nendstream\nendobj\n");
    const o = new Uint8Array(head.length + stream.length + tail.length);
    o.set(head);
    o.set(stream, head.length);
    o.set(tail, head.length + stream.length);
    objects[id - 1] = o;
  };
  const add = (dict: string, stream?: Uint8Array): number => {
    const id = reserve();
    put(id, dict, stream);
    return id;
  };
  const flate = (dict: string, data: Uint8Array): number => add(dict.replace(/>>$/, "/Filter /FlateDecode >>"), deflate(data));

  const catalog = reserve();
  const pages = reserve();
  const resources = reserve();
  const pt = 72 / 25.4;
  const pageIds: number[] = [];
  for (const sheet of sheets) {
    const fit = fitToPaper(sheet.page, opts.paper);
    const note = opts.reducedNote ? paperNote(fit, opts.reducedNote) : "";
    // The note sits on the paper, outside the sheet: its own small SVG at the paper's size.
    const paperSvg = note && `<svg viewBox="0 0 ${fit.w} ${fit.h}" width="${fit.w}mm" height="${fit.h}mm">${note}</svg>`;
    const onPaper = paperSvg ? pageContent({ name: "", svg: paperSvg, page: { w: fit.w, h: fit.h } }, { w: fit.w, h: fit.h, scale: 1, x: 0, y: 0 }, book, gs) : "";
    const content = flate("<< >>", latin1(pageContent(sheet, fit, book, gs) + onPaper));
    pageIds.push(
      add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${f(fit.w * pt)} ${f(fit.h * pt)}] /Resources ${resources} 0 R /Contents ${content} 0 R >>`),
    );
  }

  const fontRefs: string[] = [];
  book.fonts.forEach((font, i) => {
    const file = font.file;
    const k = 1000 / file.unitsPerEm;
    const name = `${subsetTag(i)}+${file.name || `Font${i + 1}`}`;
    const data = file.subset(font.used.keys());
    const fontFile = flate(`<< /Length1 ${data.length} >>`, data);
    const descriptor = add(
      `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${file.bbox.map((v) => f(Math.round(v * k))).join(" ")}] /ItalicAngle 0 ` +
        `/Ascent ${Math.round(file.ascent * k)} /Descent ${Math.round(file.descent * k)} /CapHeight ${Math.round(file.capHeight * k)} /StemV 80 /FontFile2 ${fontFile} 0 R >>`,
    );
    const widths = [...font.used.keys()].sort((a, b) => a - b).map((g) => `${g} [${Math.round(file.advance(g) * k)}]`).join(" ");
    const cid = add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${descriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`,
    );
    const uni = flate("<< >>", latin1(toUnicode(font)));
    const type0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${uni} 0 R >>`);
    fontRefs.push(`/${font.res} ${type0} 0 R`);
  });
  const gsRefs = [...gs.names.entries()].map(([o, n]) => `/${n} << /Type /ExtGState /ca ${o} /CA ${o} >>`);
  put(resources, `<< /Font << ${fontRefs.join(" ")} >>${gsRefs.length ? ` /ExtGState << ${gsRefs.join(" ")} >>` : ""} >>`);
  put(pages, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] >>`);

  // Outline: one bookmark per sheet.
  let outlineRef = "";
  if (sheets.length > 1) {
    const outline = reserve();
    const items = sheets.map(() => reserve());
    sheets.forEach((sheet, i) => {
      put(
        items[i]!,
        `<< /Title ${textString(sheet.name.replace(/\.svg$/, ""))} /Parent ${outline} 0 R /Dest [${pageIds[i]} 0 R /Fit]` +
          `${i > 0 ? ` /Prev ${items[i - 1]} 0 R` : ""}${i + 1 < items.length ? ` /Next ${items[i + 1]} 0 R` : ""} >>`,
      );
    });
    put(outline, `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`);
    outlineRef = ` /Outlines ${outline} 0 R`;
  }
  put(catalog, `<< /Type /Catalog /Pages ${pages} 0 R${outlineRef} >>`);

  const date = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?/.exec(opts.timestamp ?? "");
  const info = add(
    `<< ${opts.title ? `/Title ${textString(opts.title)} ` : ""}/Creator (Cabinet Planner) /Producer (Cabinet Planner)` +
      `${date ? ` /CreationDate (D:${date[1]}${date[2]}${date[3]}${date[4] ?? "00"}${date[5] ?? "00"}${date[6] ?? "00"})` : ""} >>`,
  );

  const header = latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  const bodies = objects.map((o) => o ?? new Uint8Array(0));
  const offsets: number[] = [];
  let size = header.length;
  for (const b of bodies) {
    offsets.push(size);
    size += b.length;
  }
  // File identifier from the content, so identical input gives an identical file.
  let seed = 0;
  for (const b of bodies) seed = crc32(b) ^ ((seed << 1) | (seed >>> 31));
  const id = [seed, seed ^ 0x5bd1e995, size, bodies.length].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  const xref =
    `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${bodies.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${size}\n%%EOF\n`;
  const tail = latin1(xref);
  const out = new Uint8Array(size + tail.length);
  out.set(header);
  bodies.forEach((b, i) => out.set(b, offsets[i]!));
  out.set(tail, size);
  return out;
}
