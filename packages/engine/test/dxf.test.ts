import { describe, expect, it } from "vitest";
import { crc32, DxfProfileSchema, partDxf, utf8, zip } from "../src/index.ts";
import { buildOne, partsByCode } from "./helpers.ts";

const cab = { W: 600, H: 720, D: 560 };
const entities = (dxf: string): { type: string; layer: string; codes: Map<string, string[]> }[] => {
  const lines = dxf.split("\r\n");
  const start = lines.indexOf("ENTITIES");
  const out: { type: string; layer: string; codes: Map<string, string[]> }[] = [];
  for (let i = start + 1; i < lines.length - 1; i += 2) {
    const code = lines[i]!;
    const val = lines[i + 1]!;
    if (code === "0") {
      if (val === "ENDSEC") break;
      out.push({ type: val, layer: "", codes: new Map() });
    } else {
      const e = out[out.length - 1]!;
      if (code === "8") e.layer = val;
      e.codes.set(code, [...(e.codes.get(code) ?? []), val]);
    }
  }
  return out;
};

describe("DXF export (D27)", () => {
  const r = buildOne();
  const p = partsByCode(r);

  it("writes the right side in the machine frame: outline, bores and groove on named layers", () => {
    const [f] = partDxf(p.SR!, cab, undefined, { project: "T", revision: 1 });
    expect(f!.name).toBe("C1-SR.dxf");
    const ents = entities(f!.content);
    const circles = ents.filter((e) => e.type === "CIRCLE");
    expect(circles.filter((c) => c.layer === "DRILL_V_D5_Z13")).toHaveLength(38);
    expect(circles.filter((c) => c.layer === "DRILL_V_D8_Z12")).toHaveLength(8);
    // Front row 37 from the front edge (Y 0), first system hole 73.5 from the lower end (X 0).
    expect(circles.some((c) => c.codes.get("10")![0] === "73.5" && c.codes.get("20")![0] === "37")).toBe(true);
    expect(ents.filter((e) => e.type === "POLYLINE").map((e) => e.layer)).toEqual(["CONTOUR", "POCKET_Z8"]);
    expect(f!.content.startsWith("999\r\nCabinet Planner")).toBe(true);
    expect(f!.content.endsWith("0\r\nEOF\r\n")).toBe(true);
  });

  it("writes edge bores as lines from the edge inwards with their height below the face", () => {
    const [f] = partDxf(p.BO!, cab);
    const lines = entities(f!.content).filter((e) => e.type === "LINE");
    expect(lines).toHaveLength(8);
    expect(new Set(lines.map((l) => l.layer))).toEqual(new Set(["DRILL_H_D8_Z25_XM", "DRILL_H_D8_Z25_XP"]));
  });

  it("splits parts machined on both faces into one file per side", () => {
    const d = partsByCode(buildOne({ options: { "hardware.handle": "generic-bar-128" } })).DO1!;
    const files = partDxf(d, cab);
    expect(files.map((x) => x.name)).toEqual(["C1-DO1-side1.dxf", "C1-DO1-side2.dxf"]);
    const layers = files.map((x) => new Set(entities(x.content).map((e) => e.layer)));
    expect(layers[0]).toContain("DRILL_V_D35_Z13"); // cups on the inner face
    expect(layers[1]).toContain("DRILL_V_D5_THROUGH"); // handle from the outside
  });

  it("cuts a through notch from the machined face instead of asking for a second side", () => {
    // Hidden sides of a wall unit with hangers get a notch through the whole thickness (D39).
    const w = partsByCode(buildOne({ kind: "wall", presets: ["wall-unit"], options: { "hardware.hanger": "hettich-sah-130" } }));
    for (const side of [w.SL!, w.SR!]) {
      expect(side.operations.some((o) => o.kind === "pocket" && o.w0 === 0 && o.w1 === side.thickness)).toBe(true);
      const files = partDxf(side, { W: 600, H: 720, D: 320 });
      expect(files.map((f) => f.name)).toEqual([`${side.id}.dxf`]);
      expect(entities(files[0]!.content).filter((e) => e.type === "POLYLINE").map((e) => e.layer).sort()).toEqual(["CONTOUR", "POCKET_Z19", "POCKET_Z8"]);
    }
  });

  it("uses a shop's layer names", () => {
    const profile = DxfProfileSchema.parse({
      id: "maestro",
      name: "My Maestro",
      layers: { outline: "PANEL", bore: "V{d}x{depth}", through: "V{d}T", edgeBore: "H{d}x{depth}@{z}_{edge}", pocket: "GROOVE_{depth}" },
      thickness: false,
    });
    const [f] = partDxf(p.BO!, cab, profile);
    const layers = new Set(entities(f!.content).map((e) => e.layer));
    expect(layers).toEqual(new Set(["PANEL", "GROOVE_8", "H8X25_9P5_XM", "H8X25_9P5_XP"]));
    expect(f!.content).not.toContain("\r\n39\r\n");
  });

  it("is deterministic", () => {
    expect(partDxf(p.SL!, cab)[0]!.content).toBe(partDxf(p.SL!, cab)[0]!.content);
  });
});

describe("zip", () => {
  it("computes CRC-32 and writes a stored archive", () => {
    expect(crc32(utf8("abc")).toString(16)).toBe("352441c2");
    const z = zip([{ name: "a.txt", data: "hello" }]);
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(z.length).toBe(30 + 5 + 5 + 46 + 5 + 22);
  });
});
