import {
  buildProject,
  cutlistColumns,
  cutlistCsv,
  cutlistRows,
  DEFAULT_COLUMNS,
  deflate,
  drawPartSheets,
  drawingText,
  fitToPaper,
  inflate,
  loadProject,
  loadShop,
  projectSheets,
  readFont,
  resolveStyle,
  sheetIndex,
  sheetsPdf,
  type ProjectResult,
} from "@cabinet-planner/engine";
import { createTranslator } from "@cabinet-planner/i18n";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { run, type Io } from "../src/app.ts";
import { pdfFonts } from "../src/fonts.ts";

const root = join(import.meta.dirname, "../../..");
const json = (p: string): any => JSON.parse(readFileSync(join(root, p), "utf8"));
const tr = createTranslator("de");
const style = resolveStyle("machine");
const meta = { project: "Küche Müller", revision: 3, timestamp: "2026-03-01T09:30:00" };

function build(file: string, change?: (doc: any) => void): ProjectResult {
  const doc = json(file);
  change?.(doc);
  return buildProject(loadProject(doc), loadShop(json("examples/shop.json")));
}
const kitchen = build("examples/kitchen-basic.project.json");
const attic = build("examples/attic-row.project.json");

/** The streams of a PDF, inflated, by object number. */
function streams(pdf: Uint8Array): Map<number, string> {
  const text = Buffer.from(pdf).toString("latin1");
  const out = new Map<number, string>();
  for (const m of text.matchAll(/(\d+) 0 obj\n<<[^\n]*\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const at = m.index! + m[0].length;
    out.set(Number(m[1]), inflateSync(Buffer.from(pdf.subarray(at, at + Number(m[2])))).toString("latin1"));
  }
  return out;
}
/** Page objects in order: media box (pt) and content stream. */
function pages(pdf: Uint8Array): { w: number; h: number; content: string }[] {
  const text = Buffer.from(pdf).toString("latin1");
  const s = streams(pdf);
  return [...text.matchAll(/\/Type \/Page \/Parent \d+ 0 R \/MediaBox \[0 0 ([\d.]+) ([\d.]+)\] \/Resources \d+ 0 R \/Contents (\d+) 0 R/g)].map((m) => ({
    w: Number(m[1]),
    h: Number(m[2]),
    content: s.get(Number(m[3]))!,
  }));
}
const MM = 72 / 25.4;

describe("drawing sheets", () => {
  it.each([
    ["kitchen", kitchen],
    ["attic", attic],
  ])("every sheet of the %s keeps one scale in both directions", (_name, result) => {
    const sheets = projectSheets(result, { tr, style, meta });
    expect(sheets.length).toBeGreaterThan(20);
    for (const s of sheets) {
      const root = /^<svg [^>]*>/.exec(s.svg)![0];
      const [, w, h] = /\bwidth="([\d.]+)mm" height="([\d.]+)mm"/.exec(root)!;
      const vb = /\bviewBox="([^"]*)"/.exec(root)![1]!.split(" ").map(Number);
      // Size in mm and viewBox are the same numbers: 1 unit = 1 mm, horizontally and vertically.
      expect([Number(w), Number(h)], s.name).toEqual([s.page.w, s.page.h]);
      expect(vb, s.name).toEqual([0, 0, s.page.w, s.page.h]);
      expect(root, s.name).not.toContain("preserveAspectRatio");
    }
  });

  it("lists the sheets without drawing them, and draws only the chosen ones", () => {
    const index = sheetIndex(kitchen, { tr, style });
    const all = projectSheets(kitchen, { tr, style });
    expect(index.map((s) => s.name)).toEqual(all.map((s) => s.name));
    expect(index.find((s) => s.name === "room/floor-plan.svg")).toMatchObject({ kind: "plan" });
    expect(index.find((s) => s.name === "B02/B02-assembly.svg")).toMatchObject({ kind: "assembly", cabinet: "B02" });
    expect(index.find((s) => s.name === "B02/B02-BO.svg")).toMatchObject({ kind: "part", cabinet: "B02", part: "B02-BO", machined: true });
    expect(index.find((s) => s.name === "B02/B02-DO1-2.svg")).toMatchObject({ part: "B02-DO1", side: { index: 2, of: 2 } });
    expect(index.find((s) => s.name === "B01/B01-BK.svg")).toMatchObject({ machined: false });
    expect(index.some((s) => s.kind === "room_part" && s.cabinet === undefined)).toBe(true);

    const only = new Set(["B02/B02-BO.svg", "room/floor-plan.svg", "B02/B02-DO1-2.svg"]);
    const some = projectSheets(kitchen, { tr, style, only });
    // Project order, whatever the order of the selection.
    expect(some.map((s) => s.name)).toEqual(["room/floor-plan.svg", "B02/B02-BO.svg", "B02/B02-DO1-2.svg"]);
    expect(some[1]!.svg).toBe(all.find((s) => s.name === "B02/B02-BO.svg")!.svg);
  });

  it("prints project, revision and time on every sheet when asked", () => {
    const sheets = projectSheets(kitchen, { tr, style, meta });
    for (const s of sheets) {
      expect(s.svg, s.name).toContain(`>Küche Müller, Rev. 3 · 2026-03-01 09:30 · ${s.name.replace(".svg", "")}</text></svg>`);
    }
    // Same input, same sheets; without meta no footer (and no clock anywhere).
    expect(projectSheets(kitchen, { tr, style, meta })).toEqual(sheets);
    for (const s of projectSheets(kitchen, { tr, style })) expect(s.svg).not.toContain("sheet-foot");
    const noTime = projectSheets(kitchen, { tr, style, meta: { project: "A <b>", revision: 1 }, only: new Set(["B02/B02-BO.svg"]) })[0]!;
    expect(noTime.svg).toContain(">A &lt;b&gt;, Rev. 1 · B02/B02-BO</text>");
  });
});

describe("zlib in the engine", () => {
  const samples = [
    new Uint8Array(0),
    new TextEncoder().encode("a"),
    new TextEncoder().encode("0 0 m 10 0 l 10 10 l 0 10 l h S\n".repeat(400)),
    Uint8Array.from({ length: 70000 }, (_, i) => (i * 2654435761) >>> 24),
    new Uint8Array(readFileSync(join(root, "examples/kitchen-basic.project.json"))),
  ];
  it("deflate output is read by zlib, and inflate reads zlib's output", () => {
    for (const s of samples) {
      const packed = deflate(s);
      expect(Buffer.from(inflateSync(Buffer.from(packed)))).toEqual(Buffer.from(s));
      expect(Buffer.from(inflate(packed))).toEqual(Buffer.from(s));
      // Dynamic Huffman blocks and stored blocks, as other writers make them.
      expect(Buffer.from(inflate(new Uint8Array(deflateSync(Buffer.from(s), { level: 9 }))))).toEqual(Buffer.from(s));
      expect(Buffer.from(inflate(new Uint8Array(deflateSync(Buffer.from(s), { level: 0 }))))).toEqual(Buffer.from(s));
    }
    expect(deflate(samples[2]!).length).toBeLessThan(samples[2]!.length / 20);
  });
});

describe("fonts for the PDF", () => {
  it("reads the bundled WOFF files and subsets them", () => {
    const fonts = pdfFonts();
    const inter = readFont(fonts.sans[0]!);
    expect(inter.name).toBe("Inter-Regular");
    expect(inter.unitsPerEm).toBeGreaterThan(0);
    const a = inter.glyph("A".codePointAt(0)!)!;
    expect(inter.advance(a)).toBeGreaterThan(0);
    // Characters drawings need: ×, Ø, ·, –, °, ², ä, ß.
    for (const ch of "×Ø·–°²äßÜ…") expect(inter.glyph(ch.codePointAt(0)!), ch).toBeGreaterThan(0);
    expect(inter.glyph("ą".codePointAt(0)!)).toBeUndefined();
    expect(readFont(fonts.sans[1]!).glyph("ą".codePointAt(0)!)).toBeGreaterThan(0);
    const mono = readFont(fonts.mono![0]!);
    expect(mono.advance(mono.glyph(0x30)!)).toBe(mono.advance(mono.glyph(0x31)!));

    const small = inter.subset([a]);
    const full = inter.subset(Array.from({ length: inter.numGlyphs }, (_, g) => g));
    expect(small.length).toBeLessThan(full.length / 3);
    expect(Buffer.from(small.subarray(0, 4)).toString("hex")).toBe("00010000");
    expect(inter.subset([a])).toEqual(small);
  });
});

describe("sheets as PDF", () => {
  const fonts = pdfFonts();
  const sheets = projectSheets(kitchen, { tr, style, meta });
  const pdf = sheetsPdf(sheets, { fonts, title: "Küche Müller", timestamp: meta.timestamp });
  const text = Buffer.from(pdf).toString("latin1");

  it("has one page per sheet at the sheet's size, with outline and embedded fonts", () => {
    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const p = pages(pdf);
    expect(p.length).toBe(sheets.length);
    p.forEach((page, i) => {
      expect(page.w).toBeCloseTo(sheets[i]!.page.w * MM, 2);
      expect(page.h).toBeCloseTo(sheets[i]!.page.h * MM, 2);
    });
    expect(text).toContain(`/Type /Pages /Count ${sheets.length} `);
    expect(text).toContain(`/Type /Outlines`);
    expect(text).toContain("/CreationDate (D:20260301093000)");
    // Four faces, each embedded as a subset TrueType font with a ToUnicode map (selectable text).
    const names = [...text.matchAll(/\/Subtype \/Type0 \/BaseFont \/[A-Z]{6}\+([\w-]+) \/Encoding \/Identity-H .*?\/ToUnicode/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(["Inter-Regular", "Inter-SemiBold", "JetBrainsMono-Regular", "JetBrainsMono-SemiBold"]);
    expect([...text.matchAll(/\/FontFile2 \d+ 0 R/g)].length).toBe(4);
    expect(pdf.length).toBeLessThan(700_000);
  });

  it("is the same bytes for the same input, and has no date unless one is given", () => {
    expect(sheetsPdf(projectSheets(kitchen, { tr, style, meta }), { fonts: pdfFonts(), title: "Küche Müller", timestamp: meta.timestamp })).toEqual(pdf);
    const plain = Buffer.from(sheetsPdf(sheets.slice(0, 2), { fonts })).toString("latin1");
    expect(plain).not.toContain("CreationDate");
    expect(plain).toContain("<< /Creator (Cabinet Planner)");
  });

  it("never stretches a sheet: one scale for both directions, on every paper", () => {
    const i = sheets.findIndex((s) => s.name === "B02/B02-BO.svg");
    const part = kitchen.parts.find((p) => p.id === "B02-BO")!;
    expect([part.length, part.width]).toEqual([412, 542]);
    for (const paper of ["sheet", "a4", "a3"] as const) {
      const p = pages(sheetsPdf(sheets, { fonts, paper }));
      p.forEach((page, k) => {
        const m = /^q\n([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\n/.exec(page.content)!;
        // Page matrix: x and y scale are equal (y flipped), whatever the paper.
        expect(Number(m[1]), `${paper} ${sheets[k]!.name}`).toBeCloseTo(-Number(m[2]), 6);
        const fit = fitToPaper(sheets[k]!.page, paper);
        expect(page.w).toBeCloseTo(fit.w * MM, 2);
        expect(Number(m[1])).toBeCloseTo(fit.scale * MM, 3);
        // The sheet lies inside the page.
        expect(fit.x).toBeGreaterThanOrEqual(-0.01);
        expect(fit.y).toBeGreaterThanOrEqual(-0.01);
        expect(fit.x + sheets[k]!.page.w * fit.scale).toBeLessThanOrEqual(fit.w + 0.02);
        expect(fit.y + sheets[k]!.page.h * fit.scale).toBeLessThanOrEqual(fit.h + 0.02);
      });
      // The bottom of B02: the outline is the second rectangle (after the sheet), 412 × 542 at 1:5.
      const rects = [...p[i]!.content.matchAll(/^([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re$/gm)];
      expect(Number(rects[1]![3]) / Number(rects[1]![4])).toBeCloseTo(412 / 542, 3);
      expect(Number(rects[1]![3])).toBeCloseTo(412 / 5, 2);
    }
    // A3 sheets on A4 are reduced, A4 sheets on A3 keep their scale.
    expect(fitToPaper({ w: 420, h: 297 }, "a4").scale).toBeLessThan(0.71);
    expect(fitToPaper({ w: 210, h: 297 }, "a3")).toMatchObject({ w: 297, h: 420, scale: 1 });
    expect(fitToPaper({ w: 297, h: 210 }, "a4")).toEqual({ w: 297, h: 210, scale: 1, x: 0, y: 0 });
  });

  it("keeps text as text, in the right face", () => {
    const i = sheets.findIndex((s) => s.name === "B02/B02-BO.svg");
    const content = pages(pdf)[i]!.content;
    expect(content).toMatch(/BT\n0 Tc\n1 0 0 -1 [\d.]+ [\d.]+ Tm\n\/F\d [\d.]+ Tf\n<[0-9a-f]+> Tj\nET/);
    // Rotated edge names: a quarter turn, not a skew.
    expect(content).toMatch(/\n0 -1 -1 0 [\d.]+ [\d.]+ Tm\n/);
    // ToUnicode maps bring the characters back, umlauts included.
    const maps = [...streams(pdf).values()].filter((s) => s.includes("beginbfchar")).join("\n");
    for (const ch of "BodenüßØ×·") expect(maps, ch).toContain(`<${ch.charCodeAt(0).toString(16).padStart(4, "0")}>\n`);
  });

  it("draws characters outside latin from the fallback file and survives unknown ones", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100mm" height="50mm"><style>.t{font-family:"Inter"}</style><text class="t" x="5" y="10" font-size="4">Łódź &amp; 木 &lt;ok&gt;</text><path d="M 1 1 L 9 1 A 4 4 0 0 1 9 9 Z" fill="none" stroke="#000"/></svg>`;
    const one = sheetsPdf([{ name: "x.svg", svg, page: { w: 100, h: 50 } }], { fonts });
    const t = Buffer.from(one).toString("latin1");
    expect([...t.matchAll(/\/Subtype \/Type0 /g)].length).toBe(2);
    expect(pages(one)[0]!.content).toMatch(/ c\nh\nS\n/);
  });
});

describe("cli sheets --pdf", () => {
  function fakeIo(fonts = true): Io & { err: string; written: Record<string, string | Uint8Array> } {
    const io = {
      err: "",
      written: {} as Record<string, string | Uint8Array>,
      readFile: (p: string) => readFileSync(join(root, p), "utf8"),
      writeFile(p: string, c: string | Uint8Array) {
        io.written[p] = c;
      },
      stdout() {},
      stderr(t: string) {
        io.err += t;
      },
      env: {},
      ...(fonts ? { fonts: pdfFonts } : {}),
    };
    return io;
  }
  const args = ["sheets", "examples/attic-row.project.json", "--shop", "examples/shop.json", "--lang", "de", "--timestamp", "2026-03-01T09:30:00"];

  it("writes one PDF, the same bytes every time", () => {
    const a = fakeIo();
    expect(run([...args, "--pdf", "out.pdf"], a)).toBe(0);
    const b = fakeIo();
    expect(run([...args, "--pdf", "out.pdf", "--zip", "out.zip"], b)).toBe(0);
    expect(a.written["out.pdf"]).toBeInstanceOf(Uint8Array);
    expect(b.written["out.pdf"]).toEqual(a.written["out.pdf"]);
    expect(Object.keys(b.written).sort()).toEqual(["out.pdf", "out.zip"]);
    const n = Number(/\((\d+) Blätter\)/.exec(a.err)![1]);
    expect(pages(a.written["out.pdf"] as Uint8Array).length).toBe(n);

    const a4 = fakeIo();
    expect(run([...args, "--pdf", "a4.pdf", "--paper", "a4", "--cabinet", "T01"], a4)).toBe(0);
    for (const p of pages(a4.written["a4.pdf"] as Uint8Array)) expect([Math.round(p.w), Math.round(p.h)].sort()).toEqual([595, 842]);
  });

  it("rejects an unknown paper and reports missing fonts", () => {
    expect(run([...args, "--pdf", "x.pdf", "--paper", "letter"], fakeIo())).toBe(2);
    const io = fakeIo(false);
    expect(run([...args, "--pdf", "x.pdf"], io)).toBe(2);
    expect(io.err).toContain("fonts");
  });
});

describe("edge remarks (D60)", () => {
  const withNotes = build("examples/kitchen-basic.project.json", (doc) => {
    const b02 = doc.cabinets.find((c: any) => c.id === "B02");
    b02.parts = { ...(b02.parts ?? {}), SL: { edgeNotes: { l2: " 45° ", w1: "" } }, BO: { edges: { w1: "abs-white-1" }, edgeNotes: { w2: "Gehrung 45°" } } };
  });
  const text = {
    locale: "de",
    header: (c: string) => tr.t(`col.${c}`),
    role: (r: { role: string }) => tr.t(`role.${r.role}`),
  };

  it("carries the remark on the part and keeps empty ones out", () => {
    expect(withNotes.ok).toBe(true);
    expect(withNotes.parts.find((p) => p.id === "B02-SL")!.edgeNotes).toEqual({ l2: "45°" });
    expect(withNotes.parts.find((p) => p.id === "B02-SR")!.edgeNotes).toBeUndefined();
    expect(withNotes.parts.find((p) => p.id === "B02-BO")!.edgeNotes).toEqual({ w2: "Gehrung 45°" });
  });

  it("adds four columns at the end of the cutlist only when a list has remarks", () => {
    const plain = cutlistRows(kitchen.parts, kitchen.library, { group: true });
    expect(cutlistColumns(plain)).toBe(DEFAULT_COLUMNS);
    const rows = cutlistRows(withNotes.parts, withNotes.library, { group: true });
    const csv = cutlistCsv(rows, withNotes.library, text).split("\n");
    const head = csv[0]!.split(",");
    expect(head.slice(0, DEFAULT_COLUMNS.length)).toEqual(cutlistCsv(plain, kitchen.library, text).split("\n")[0]!.split(","));
    expect(head.slice(-4)).toEqual(["Bemerkung L1", "Bemerkung L2", "Bemerkung B1", "Bemerkung B2"]);
    const cells = (id: string): string[] => csv.find((l) => l.startsWith(`${id},`))!.split(",");
    expect(cells("B02-BO").slice(12, 16)).toEqual(["", "W1", "W1", ""]);
    expect(cells("B02-BO").slice(-4)).toEqual(["", "", "", "Gehrung 45°"]);
    // Left and right side no longer share a row: one has a mitre remark.
    expect(cells("B02-SL").slice(-4)).toEqual(["", "45°", "", ""]);
    expect(cells("B02-SR").slice(-4)).toEqual(["", "", "", ""]);
    expect(rows.find((r) => r.part === "B02-SL")!.qty).toBe(1);
    expect(plain.find((r) => r.part === "B02-SL")!.qty).toBe(2);
  });

  it("writes the remark at the edge on the part sheet", () => {
    const part = withNotes.parts.find((p) => p.id === "B02-BO")!;
    const svg = drawPartSheets({ part, cabinet: { W: 450, H: 720, D: 560 }, style, text: drawingText(tr, withNotes.library) })[0]!.svg;
    expect(svg).toMatch(/>(links|rechts) · Gehrung 45°<\/text>/);
    expect(svg).toMatch(/>vorne · W1<\/text>/);
  });

  it("rejects remarks that are too long", () => {
    const doc = json("examples/kitchen-basic.project.json");
    doc.cabinets[0].parts = { SL: { edgeNotes: { l1: "x".repeat(41) } } };
    expect(() => loadProject(doc)).toThrow();
  });
});
