import { inflate } from "./deflate.ts";

/**
 * TrueType fonts for the PDF writer: reads a font file (sfnt, or WOFF 1 with
 * TrueType outlines, as @fontsource ships them), answers which glyph draws a
 * character and how wide it is, and writes a subset with only the glyphs a
 * document uses. Glyph numbers stay as they are, so the PDF addresses glyphs
 * directly (Identity-H) and needs no encoding table in the font.
 */
export interface FontFile {
  /** PostScript name from the font's name table, e.g. "Inter-Regular". */
  name: string;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight: number;
  bbox: [number, number, number, number];
  numGlyphs: number;
  /** Glyph of a code point; undefined when the font has none. */
  glyph(codePoint: number): number | undefined;
  /** Advance width in font units. */
  advance(glyph: number): number;
  /** The font with only these glyphs (and the parts of composite glyphs), as an sfnt file. */
  subset(glyphs: Iterable<number>): Uint8Array;
}

const u16 = (d: Uint8Array, o: number): number => (d[o]! << 8) | d[o + 1]!;
const i16 = (d: Uint8Array, o: number): number => (u16(d, o) << 16) >> 16;
const u32 = (d: Uint8Array, o: number): number => ((d[o]! << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!) >>> 0;
const tagAt = (d: Uint8Array, o: number): string => String.fromCharCode(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!);

function tablesOf(data: Uint8Array): Map<string, Uint8Array> {
  const tables = new Map<string, Uint8Array>();
  if (tagAt(data, 0) === "wOFF") {
    const n = u16(data, 12);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20;
      const offset = u32(data, o + 4);
      const comp = u32(data, o + 8);
      const orig = u32(data, o + 12);
      const raw = data.subarray(offset, offset + comp);
      tables.set(tagAt(data, o), comp < orig ? inflate(raw) : raw);
    }
    return tables;
  }
  const n = u16(data, 4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables.set(tagAt(data, o), data.subarray(u32(data, o + 8), u32(data, o + 8) + u32(data, o + 12)));
  }
  return tables;
}

function readCmap(cmap: Uint8Array): Map<number, number> {
  const map = new Map<number, number>();
  const n = u16(cmap, 2);
  let best = -1;
  let rank = 0;
  for (let i = 0; i < n; i++) {
    const platform = u16(cmap, 4 + i * 8);
    const encoding = u16(cmap, 6 + i * 8);
    const offset = u32(cmap, 8 + i * 8);
    const format = u16(cmap, offset);
    const r = format === 12 && platform === 3 && encoding === 10 ? 4 : format === 12 ? 3 : format === 4 && platform === 3 && encoding === 1 ? 2 : format === 4 ? 1 : 0;
    if (r > rank) {
      rank = r;
      best = offset;
    }
  }
  if (best < 0) throw new Error("font: no Unicode cmap (format 4 or 12)");
  if (u16(cmap, best) === 12) {
    const groups = u32(cmap, best + 12);
    for (let g = 0; g < groups; g++) {
      const o = best + 16 + g * 12;
      const start = u32(cmap, o);
      const end = u32(cmap, o + 4);
      const gid = u32(cmap, o + 8);
      for (let c = start; c <= end; c++) map.set(c, gid + c - start);
    }
    return map;
  }
  const seg = u16(cmap, best + 6) / 2;
  const endAt = best + 14;
  const startAt = endAt + seg * 2 + 2;
  const deltaAt = startAt + seg * 2;
  const rangeAt = deltaAt + seg * 2;
  for (let s = 0; s < seg; s++) {
    const end = u16(cmap, endAt + s * 2);
    const start = u16(cmap, startAt + s * 2);
    const delta = u16(cmap, deltaAt + s * 2);
    const range = u16(cmap, rangeAt + s * 2);
    for (let c = start; c <= end && c < 0xffff; c++) {
      let gid: number;
      if (range === 0) gid = (c + delta) & 0xffff;
      else {
        gid = u16(cmap, rangeAt + s * 2 + range + (c - start) * 2);
        if (gid) gid = (gid + delta) & 0xffff;
      }
      if (gid) map.set(c, gid);
    }
  }
  return map;
}

function postScriptName(name: Uint8Array | undefined): string {
  if (!name) return "";
  const n = u16(name, 2);
  const strings = u16(name, 4);
  for (const wantPlatform of [3, 1]) {
    for (let i = 0; i < n; i++) {
      const o = 6 + i * 12;
      if (u16(name, o + 6) !== 6 || u16(name, o) !== wantPlatform) continue;
      const len = u16(name, o + 8);
      const at = strings + u16(name, o + 10);
      let s = "";
      if (wantPlatform === 3) for (let k = 0; k < len; k += 2) s += String.fromCharCode(u16(name, at + k));
      else for (let k = 0; k < len; k++) s += String.fromCharCode(name[at + k]!);
      return s.replace(/[^A-Za-z0-9-]/g, "");
    }
  }
  return "";
}

const pad4 = (n: number): number => (n + 3) & ~3;

function checksum(d: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum = (sum + (((d[i]! << 24) | ((d[i + 1] ?? 0) << 16) | ((d[i + 2] ?? 0) << 8) | (d[i + 3] ?? 0)) >>> 0)) >>> 0;
  return sum;
}

function writeSfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  let size = 12 + n * 16;
  const offsets = tags.map((t) => {
    const o = size;
    size += pad4(tables.get(t)!.length);
    return o;
  });
  const out = new Uint8Array(size);
  const w16 = (o: number, v: number): void => {
    out[o] = (v >> 8) & 0xff;
    out[o + 1] = v & 0xff;
  };
  const w32 = (o: number, v: number): void => {
    w16(o, (v >>> 16) & 0xffff);
    w16(o + 2, v & 0xffff);
  };
  const pow = 2 ** Math.floor(Math.log2(n));
  w32(0, 0x00010000);
  w16(4, n);
  w16(6, pow * 16);
  w16(8, Math.log2(pow));
  w16(10, n * 16 - pow * 16);
  let headAt = -1;
  tags.forEach((t, i) => {
    const d = tables.get(t)!;
    const o = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[o + k] = t.charCodeAt(k);
    w32(o + 4, checksum(d));
    w32(o + 8, offsets[i]!);
    w32(o + 12, d.length);
    out.set(d, offsets[i]!);
    if (t === "head") headAt = offsets[i]!;
  });
  if (headAt >= 0) w32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** Reads a font file: sfnt (TrueType outlines) or WOFF 1. Throws when it is neither. */
export function readFont(data: Uint8Array): FontFile {
  const tables = tablesOf(data);
  const need = (t: string): Uint8Array => {
    const d = tables.get(t);
    if (!d) throw new Error(`font: table ${t} missing (TrueType outlines needed)`);
    return d;
  };
  const head = need("head");
  const hhea = need("hhea");
  const hmtx = need("hmtx");
  const loca = need("loca");
  const glyf = need("glyf");
  const numGlyphs = u16(need("maxp"), 4);
  const cmap = readCmap(need("cmap"));
  const os2 = tables.get("OS/2");
  const unitsPerEm = u16(head, 18);
  const longLoca = i16(head, 50) === 1;
  const metrics = u16(hhea, 34);
  const glyphAt = (g: number): [number, number] =>
    longLoca ? [u32(loca, g * 4), u32(loca, g * 4 + 4)] : [u16(loca, g * 2) * 2, u16(loca, g * 2 + 2) * 2];

  return {
    name: postScriptName(tables.get("name")),
    unitsPerEm,
    ascent: i16(hhea, 4),
    descent: i16(hhea, 6),
    capHeight: os2 && u16(os2, 0) >= 2 && os2.length >= 90 ? i16(os2, 88) : Math.round(i16(hhea, 4) * 0.75),
    bbox: [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)],
    numGlyphs,
    glyph: (cp) => cmap.get(cp),
    advance: (g) => u16(hmtx, Math.min(g, metrics - 1) * 4),
    subset(glyphs) {
      const keep = new Set<number>([0]);
      const todo = [...glyphs];
      while (todo.length) {
        const g = todo.pop()!;
        if (g >= numGlyphs || keep.has(g)) continue;
        keep.add(g);
        const [a, b] = glyphAt(g);
        if (b - a < 10 || i16(glyf, a) >= 0) continue;
        // Composite glyph: its components come along.
        for (let o = a + 10; ; ) {
          const flags = u16(glyf, o);
          todo.push(u16(glyf, o + 2));
          o += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
          if (!(flags & 0x20)) break;
        }
      }
      const newLoca = new Uint8Array((numGlyphs + 1) * 4);
      const chunks: Uint8Array[] = [];
      let at = 0;
      const w32 = (o: number, v: number): void => {
        newLoca[o] = v >>> 24;
        newLoca[o + 1] = (v >>> 16) & 0xff;
        newLoca[o + 2] = (v >>> 8) & 0xff;
        newLoca[o + 3] = v & 0xff;
      };
      for (let g = 0; g < numGlyphs; g++) {
        w32(g * 4, at);
        if (!keep.has(g)) continue;
        const [a, b] = glyphAt(g);
        if (b <= a) continue;
        const d = new Uint8Array(pad4(b - a));
        d.set(glyf.subarray(a, b));
        chunks.push(d);
        at += d.length;
      }
      w32(numGlyphs * 4, at);
      const newGlyf = new Uint8Array(at);
      let o = 0;
      for (const c of chunks) {
        newGlyf.set(c, o);
        o += c.length;
      }
      const newHead = head.slice();
      newHead[8] = newHead[9] = newHead[10] = newHead[11] = 0; // checkSumAdjustment, set by writeSfnt
      newHead[50] = 0;
      newHead[51] = 1; // long loca
      const out = new Map<string, Uint8Array>([
        ["glyf", newGlyf],
        ["head", newHead],
        ["hhea", hhea],
        ["hmtx", hmtx],
        ["loca", newLoca],
        ["maxp", tables.get("maxp")!],
      ]);
      for (const t of ["cvt ", "fpgm", "prep"]) if (tables.has(t)) out.set(t, tables.get(t)!);
      return writeSfnt(out);
    },
  };
}
