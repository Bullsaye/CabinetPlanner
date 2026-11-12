import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProject, crc32, DxfProfileSchema, zip, loadProject, loadShop, partDxf, type Part, type ProjectResult } from "@cabinet-planner/engine";

/**
 * Reads the DXF files back with a small parser and checks them against the
 * model: valid group structure, every entity on a declared layer, all
 * geometry inside the part, one circle per face bore, one line per edge
 * bore, one polyline per pocket (D27).
 */
const root = join(import.meta.dirname, "../../..");

interface Entity {
  type: string;
  layer: string;
  codes: Map<number, string[]>;
}
interface Parsed {
  comment: string;
  layers: string[];
  layerCount: number;
  ext: { min: number[]; max: number[] };
  entities: Entity[];
}

function parseDxf(content: string): Parsed {
  expect(content.endsWith("\r\n")).toBe(true);
  const lines = content.slice(0, -2).split("\r\n");
  expect(lines.length % 2).toBe(0);
  const pairs: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i]).toMatch(/^\d+$/);
    expect(lines[i + 1]).not.toMatch(/[\r\n]/);
    pairs.push([Number(lines[i]), lines[i + 1]!]);
  }
  expect(pairs[0]![0]).toBe(999);
  expect(pairs[pairs.length - 1]).toEqual([0, "EOF"]);
  const out: Parsed = { comment: pairs[0]![1], layers: [], layerCount: -1, ext: { min: [], max: [] }, entities: [] };
  let section = "";
  let header = "";
  for (let i = 1; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0 && value === "SECTION") {
      section = pairs[++i]![1];
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      section = "";
      continue;
    }
    if (section === "HEADER") {
      if (code === 9) header = value;
      else if (header === "$EXTMIN") out.ext.min.push(Number(value));
      else if (header === "$EXTMAX") out.ext.max.push(Number(value));
    } else if (section === "TABLES") {
      if (code === 0 && value === "LAYER") out.layers.push(pairs[i + 1]![1]);
      if (code === 70 && pairs[i - 1]![1] === "LAYER" && pairs[i - 1]![0] === 2 && pairs[i - 2]![1] === "TABLE") out.layerCount = Number(value);
    } else if (section === "ENTITIES") {
      if (code === 0) out.entities.push({ type: value, layer: "", codes: new Map() });
      else {
        const e = out.entities[out.entities.length - 1]!;
        if (code === 8) e.layer = value;
        e.codes.set(code, [...(e.codes.get(code) ?? []), value]);
      }
    } else if (!(code === 0 && value === "EOF")) {
      throw new Error(`group ${code} outside a section`);
    }
  }
  return out;
}

const n = (e: Entity, code: number): number => {
  const v = e.codes.get(code)?.[0];
  expect(v).toMatch(/^-?\d+(\.\d+)?$/);
  return Number(v);
};

/** Closed polylines as vertex lists (the POLYLINE entity followed by its VERTEX entities). */
function polylines(p: Parsed): { layer: string; pts: [number, number][]; bulges: number }[] {
  const out: { layer: string; pts: [number, number][]; bulges: number }[] = [];
  for (const e of p.entities) {
    if (e.type === "POLYLINE") out.push({ layer: e.layer, pts: [], bulges: 0 });
    if (e.type === "VERTEX") {
      const cur = out[out.length - 1]!;
      cur.pts.push([n(e, 10), n(e, 20)]);
      if (e.codes.has(42)) cur.bulges++;
    }
  }
  return out;
}

const signedArea = (pts: [number, number][]): number =>
  pts.reduce((a, [x, y], i) => a + x * pts[(i + 1) % pts.length]![1] - pts[(i + 1) % pts.length]![0] * y, 0) / 2;

function checkPart(part: Part, cabinet: { W: number; H: number; D: number }): void {
  const files = partDxf(part, cabinet, undefined, { project: "P", revision: 1 });
  let circles = 0;
  let lines = 0;
  let pockets = 0;
  for (const f of files) {
    expect(f.content, f.name).not.toMatch(/NaN|undefined|Infinity/);
    const dxf = parseDxf(f.content);
    expect(dxf.layerCount).toBe(dxf.layers.length);
    expect(new Set(dxf.layers).size).toBe(dxf.layers.length);
    const [w, h] = [dxf.ext.max[0]!, dxf.ext.max[1]!];
    expect([...dxf.ext.min, dxf.ext.max[2]]).toEqual([0, 0, -part.thickness, 0]);
    expect([w, h].sort((a, b) => a - b)).toEqual([part.length, part.width].sort((a, b) => a - b));
    for (const e of dxf.entities) {
      expect(dxf.layers, `${f.name} ${e.type}`).toContain(e.layer);
      expect(e.layer).toMatch(/^[A-Z0-9_$-]+$/);
      for (const [cx, cy] of [[10, 20], [11, 21]] as const) {
        if (!e.codes.has(cx)) continue;
        expect(n(e, cx), `${f.name} ${e.type} ${e.layer}`).toBeGreaterThanOrEqual(0);
        expect(n(e, cx), `${f.name} ${e.type} ${e.layer}`).toBeLessThanOrEqual(w);
        expect(n(e, cy), `${f.name} ${e.type} ${e.layer}`).toBeGreaterThanOrEqual(0);
        expect(n(e, cy), `${f.name} ${e.type} ${e.layer}`).toBeLessThanOrEqual(h);
      }
      if (e.type === "CIRCLE") {
        circles++;
        // The whole hole lies on the panel and is not deeper than the panel.
        expect(n(e, 10) - n(e, 40)).toBeGreaterThanOrEqual(0);
        expect(n(e, 10) + n(e, 40)).toBeLessThanOrEqual(w);
        expect(n(e, 20) - n(e, 40)).toBeGreaterThanOrEqual(0);
        expect(n(e, 20) + n(e, 40)).toBeLessThanOrEqual(h);
        expect(-n(e, 39)).toBeGreaterThan(0);
        expect(-n(e, 39)).toBeLessThanOrEqual(part.thickness);
      }
      if (e.type === "LINE") lines++;
    }
    const polys = polylines(dxf);
    expect(polys[0]!.layer).toBe("CONTOUR");
    for (const q of polys) {
      expect(q.pts.length).toBeGreaterThanOrEqual(3);
      // Outline and pockets run counter-clockwise on every side.
      expect(signedArea(q.pts), `${f.name} ${q.layer}`).toBeGreaterThan(0);
    }
    pockets += polys.length - 1;
  }
  const bores = part.operations.filter((o) => o.kind === "bore");
  const face = bores.filter((o) => o.face === "t0" || o.face === "t1").length;
  expect(circles, `${part.id} circles`).toBe(face);
  expect(lines, `${part.id} lines`).toBe(bores.length - face);
  expect(pockets, `${part.id} pockets`).toBe(part.operations.length - bores.length);
}

function checkProject(r: ProjectResult): void {
  expect(r.ok).toBe(true);
  for (const c of r.cabinets) {
    const v = (name: string): number => c.resolved.values.get(name)!;
    for (const p of c.parts) checkPart(p, { W: v("W"), H: v("H"), D: v("D") });
  }
  for (const p of r.room?.parts ?? []) checkPart(p, { W: p.box.dx, H: p.box.dy, D: p.box.dz });
}

const load = (file: string, shop?: string): ProjectResult =>
  buildProject(
    loadProject(JSON.parse(readFileSync(join(root, file), "utf8"))),
    shop ? loadShop(JSON.parse(readFileSync(join(root, shop), "utf8"))) : undefined,
  );

describe("DXF files read back (D27)", () => {
  it("example kitchen: every part side is a valid file that matches its operations", () => {
    checkProject(load("examples/kitchen-basic.project.json", "examples/shop.json"));
  });

  it("attic row with outlined fillers (D43)", () => {
    checkProject(load("examples/attic-row.project.json"));
  });
});

describe("DXF numbers and header", () => {
  const one = buildProject(loadProject({ schemaVersion: 1, name: "test", cabinets: [{ id: "C1", type: "box" }] }));
  const p = Object.fromEntries(one.parts.map((q) => [q.code, q]));

  it("keeps whole numbers whole when a profile asks for 0 decimals", () => {
    const profile = DxfProfileSchema.parse({ id: "int", name: "Integer", decimals: 0 });
    const dxf = parseDxf(partDxf(p.SR!, { W: 600, H: 720, D: 560 }, profile)[0]!.content);
    expect(dxf.ext.max).toEqual([720, 560, 0]);
    expect(dxf.ext.min).toEqual([0, 0, -19]);
    expect(polylines(dxf)[0]!.pts).toEqual([[0, 0], [720, 0], [720, 560], [0, 560]]);
    expect(dxf.comment).toContain("720 x 560 x 19 mm");
  });

  it("keeps the header comment on one line whatever the project is called", () => {
    const [f] = partDxf(p.SR!, { W: 600, H: 720, D: 560 }, undefined, { project: "Küche\r\nMüller\n0\tEOF", revision: 2, timestamp: "now\nlater" });
    const dxf = parseDxf(f!.content);
    expect(dxf.comment).toContain("Küche Müller 0 EOF rev 2");
    expect(dxf.entities.filter((e) => e.type === "CIRCLE").length).toBeGreaterThan(0);
  });
});

describe("DXF zip of a whole project", () => {
  const exportZip = (): Uint8Array => {
    const r = load("examples/kitchen-basic.project.json", "examples/shop.json");
    const files = [
      ...r.cabinets.flatMap((c) => c.parts.flatMap((p) => partDxf(p, { W: c.resolved.values.get("W")!, H: c.resolved.values.get("H")!, D: c.resolved.values.get("D")! }))),
      ...r.room!.parts.flatMap((p) => partDxf(p, { W: p.box.dx, H: p.box.dy, D: p.box.dz })),
    ];
    return zip(files.map((f) => ({ name: f.name, data: f.content })));
  };

  it("is a valid stored archive with unique, Windows-safe names, byte-identical on repeat", () => {
    const z = exportZip();
    expect(Buffer.from(z).equals(Buffer.from(exportZip()))).toBe(true);
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    const count = v.getUint16(end + 10, true);
    expect(v.getUint32(end + 16, true) + v.getUint32(end + 12, true)).toBe(end);
    const names: string[] = [];
    let c = v.getUint32(end + 16, true);
    for (let i = 0; i < count; i++) {
      expect(v.getUint32(c, true)).toBe(0x02014b50);
      const [crc, size, nameLen, local] = [v.getUint32(c + 16, true), v.getUint32(c + 24, true), v.getUint16(c + 28, true), v.getUint32(c + 42, true)];
      const name = Buffer.from(z.subarray(c + 46, c + 46 + nameLen)).toString("utf8");
      names.push(name);
      // The local header agrees with the directory and the data has the recorded CRC.
      expect(v.getUint32(local, true)).toBe(0x04034b50);
      expect([v.getUint32(local + 14, true), v.getUint32(local + 18, true), v.getUint32(local + 22, true)]).toEqual([crc, size, size]);
      const data = z.subarray(local + 30 + nameLen, local + 30 + nameLen + size);
      expect(crc32(data)).toBe(crc);
      expect(Buffer.from(data).toString("utf8").endsWith("0\r\nEOF\r\n")).toBe(true);
      c += 46 + nameLen;
    }
    expect(c).toBe(end);
    expect(count).toBeGreaterThan(90);
    expect(new Set(names.map((x) => x.toLowerCase())).size).toBe(count);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*\.dxf$/);
    expect(names).toContain("ROOM-WT1.dxf");
  });
});
