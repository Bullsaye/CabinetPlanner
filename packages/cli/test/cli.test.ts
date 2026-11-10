import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, type Io } from "../src/app.ts";

const root = join(import.meta.dirname, "../../..");

function fakeIo(files: Record<string, string> = {}): Io & { out: string; err: string; written: Record<string, string | Uint8Array> } {
  const io = {
    out: "",
    err: "",
    written: {} as Record<string, string | Uint8Array>,
    readFile(p: string): string {
      if (Object.hasOwn(files, p)) return files[p]!;
      return readFileSync(join(root, p), "utf8");
    },
    writeFile(p: string, c: string | Uint8Array) {
      io.written[p] = c;
    },
    stdout(t: string) {
      io.out += t;
    },
    stderr(t: string) {
      io.err += t;
    },
    env: {},
  };
  return io;
}

describe("cli", () => {
  it("prints usage on no arguments", () => {
    const io = fakeIo();
    expect(run([], io)).toBe(2);
    expect(io.err).toContain("Usage:");
  });

  it("writes a cutlist CSV for the example kitchen", () => {
    const io = fakeIo();
    expect(run(["cutlist", "examples/kitchen-basic.project.json"], io)).toBe(0);
    const lines = io.out.trimEnd().split("\n");
    expect(lines[0]).toBe("Part,Cabinet,Name,Qty,L,W,T,Material,Surface,Cut L,Cut W,Grain,Edge L1,Edge L2,Edge W1,Edge W2,Note");
    expect(lines[1]).toBe("B01-SL,B01,Side L,1,720,560,19,Melamine white 19,,720,559,,,W1,,,");
    expect(io.err).toBe("");
  });

  it("localizes headers and role names", () => {
    const io = fakeIo();
    run(["cutlist", "examples/kitchen-basic.project.json", "--lang", "de", "--group", "--delimiter", ";"], io);
    expect(io.out.split("\n")[0]).toContain("Teil;Schrank;Bezeichnung");
    expect(io.out).toContain("B01-SL B01-SR;B01;Seite L/R;2;720;560;19;Melamin weiß 19;;720;559");
  });

  it("refuses to write a cutlist when there are errors", () => {
    const io = fakeIo({
      "bad.json": JSON.stringify({
        schemaVersion: 1,
        name: "bad",
        cabinets: [{ id: "X1", type: "box", vars: { W: "H +" } }],
      }),
    });
    expect(run(["cutlist", "bad.json"], io)).toBe(1);
    expect(io.out).toBe("");
    expect(io.err).toContain("Error [X1 W]: W: the expression ends too early.");
    expect(io.err).toContain("no output written");
  });

  it("reports unreadable and invalid files without a stack trace", () => {
    const io = fakeIo({ "broken.json": "{ nope" });
    expect(run(["check", "broken.json"], io)).toBe(1);
    expect(io.err).toContain("broken.json");
    const io2 = fakeIo({ "wrong.json": JSON.stringify({ schemaVersion: 1 }) });
    expect(run(["check", "wrong.json"], io2)).toBe(1);
    expect(io2.err).toContain("invalid project file");
  });

  it("resolve shows sources including presets", () => {
    const io = fakeIo();
    expect(
      run(["resolve", "examples/kitchen-basic.project.json", "--shop", "examples/shop.json", "--cabinet", "W01"], io),
    ).toBe(0);
    expect(io.out).toMatch(/^W\s+Width\s+800\s+1600 \/ 2\s+Override$/m);
    expect(io.out).toMatch(/^back_groove_offset\s+Groove offset\s+10\s+Shop · dowel-32-sides-over$/m);
  });

  it("writes to --out", () => {
    const io = fakeIo();
    expect(run(["cutlist", "examples/kitchen-basic.project.json", "--out", "x.csv"], io)).toBe(0);
    expect(io.written["x.csv"]).toContain("B01-SL");
    expect(io.err).toContain("Written: x.csv");
  });
});

describe("cli bom", () => {
  it("writes the bill of materials as CSV with prices from the shop file", async () => {
    const io = fakeIo();
    expect(run(["bom", "examples/kitchen-basic.project.json", "--shop", "examples/shop.json", "--per-cabinet"], io)).toBe(0);
    expect(io.out.split("\n")[0]).toBe("Section,Item,Name,Article no.,Count,Net,Qty,Unit,Unit price,Cost,Note");
    // Golden file: the BOM is production data (order quantities), any change shows up as a diff.
    await expect(io.out).toMatchFileSnapshot(join(root, "reference/expected/example-kitchen.bom.csv"));
    // Every total is the sum of its rows (";" so that names with commas need no quotes).
    const semi = fakeIo();
    run(["bom", "examples/kitchen-basic.project.json", "--shop", "examples/shop.json", "--delimiter", ";"], semi);
    const rows = semi.out.trimEnd().split("\n").slice(1).map((l) => l.split(";"));
    const sum = (section: string): number => rows.filter((r) => r[0] === section).reduce((a, r) => a + Number(r[9]), 0);
    const total = (name: string): number => Number(rows.find((r) => r[0] === "Total" && r[2] === name)![9]);
    expect(total("Board material")).toBeCloseTo(sum("Board"), 6);
    expect(total("Edgebands")).toBeCloseTo(sum("Edgeband"), 6);
    expect(total("Total")).toBeCloseTo(sum("Board") + sum("Edgeband") + sum("Hardware"), 6);
  });

  it("writes an aligned, localized table", async () => {
    const io = fakeIo();
    expect(run(["bom", "examples/kitchen-basic.project.json", "--shop", "examples/shop.json", "--format", "table", "--lang", "de"], io)).toBe(0);
    expect(io.out).toMatch(/^Bereich\s+Artikel\s+Bezeichnung\s+Artikel-Nr\.\s+Anzahl\s+Netto\s+Menge\s+Einheit\s+Einzelpreis\s+Kosten\s+Bemerkung$/m);
    expect(io.out).toMatch(/^Platte\s+mel-white-19\s+Melamin weiß 19\s+\d+\s+[\d.]+\s+[\d.]+\s+m²\s+9\.5\s+[\d.]+$/m);
    expect(io.out).toMatch(/^Summe\s+Gesamt\s+[\d.]+\s+\d+ ohne Preis$/m);
    await expect(io.out).toMatchFileSnapshot(join(root, "reference/expected/example-kitchen.bom.de.txt"));
  });

  it("honours --delimiter and --out, and refuses when there are errors", () => {
    const io = fakeIo();
    expect(run(["bom", "examples/kitchen-basic.project.json", "--delimiter", ";", "--out", "bom.csv"], io)).toBe(0);
    expect(io.written["bom.csv"]).toContain("Board;mel-white-19;Melamine white 19;");
    expect(io.err).toContain("Written: bom.csv");
    const bad = fakeIo({ "bad.json": JSON.stringify({ schemaVersion: 1, name: "bad", cabinets: [{ id: "X1", type: "box", vars: { W: "H +" } }] }) });
    expect(run(["bom", "bad.json"], bad)).toBe(1);
    expect(bad.out).toBe("");
    expect(bad.err).toContain("no output written");
  });

  it("has a text for every key the BOM writer reads", async () => {
    const { BOM_COLUMNS } = await import("@cabinet-planner/engine");
    const { en } = await import("@cabinet-planner/i18n");
    const keys = [
      ...BOM_COLUMNS.map((c) => `bom.col.${c}`),
      ...["material", "edgeband", "hardware", "cabinet", "total"].map((s) => `bom.section.${s}`),
      ...["material", "edgeband", "hardware", "all"].map((s) => `bom.total.${s}`),
      "bom.unpriced",
      "unit.m",
      "unit.m2",
    ];
    for (const k of keys) expect(Object.hasOwn(en, k), k).toBe(true);
    // Units used by the factory hardware items.
    const { FACTORY_HARDWARE } = await import("@cabinet-planner/engine");
    for (const h of FACTORY_HARDWARE) expect(Object.hasOwn(en, `unit.${h.bom.unit}`), `${h.id}: unit.${h.bom.unit}`).toBe(true);
  });
});

describe("cli sheets", () => {
  it("writes every drawing sheet of the project as SVG, to a folder or a zip", () => {
    const io = fakeIo();
    expect(run(["sheets", "examples/kitchen-basic.project.json", "--out", "sheets", "--lang", "de"], io)).toBe(0);
    const names = Object.keys(io.written);
    expect(names).toContain("sheets/room/floor-plan.svg");
    expect(names).toContain("sheets/room/elevation-A.svg");
    expect(names).toContain("sheets/B01/B01-assembly.svg");
    expect(names).toContain("sheets/B01/B01-SL.svg");
    expect(names.some((n) => n.startsWith("sheets/room/ROOM-WT"))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(io.written[n] as string, n).toMatch(/^<svg [^>]*width="[\d.]+mm" height="[\d.]+mm"/);
    expect(io.written["sheets/B01/B01-SL.svg"]).toContain("Seite links");
    expect(io.err).toContain(`${names.length} Blätter`);

    const one = fakeIo();
    expect(run(["sheets", "examples/kitchen-basic.project.json", "--cabinet", "W01", "--zip", "w.zip"], one)).toBe(0);
    expect(one.written["w.zip"]).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(one.written["w.zip"] as Uint8Array)).toContain("W01/W01-assembly.svg");
    expect(new TextDecoder().decode(one.written["w.zip"] as Uint8Array)).not.toContain("B01/");

    expect(run(["sheets", "examples/kitchen-basic.project.json"], fakeIo())).toBe(2);
    expect(run(["sheets", "examples/kitchen-basic.project.json", "--cabinet", "X9", "--out", "x"], fakeIo())).toBe(1);
    expect(run(["sheets", "examples/kitchen-basic.project.json", "--style", "nope", "--out", "x"], fakeIo())).toBe(2);
  });
});

describe("cli assembly", () => {
  it("writes the assembly drawing of a cabinet", () => {
    const io = fakeIo();
    expect(run(["assembly", "examples/kitchen-basic.project.json", "--cabinet", "W01", "--lang", "de"], io)).toBe(0);
    expect(io.out).toContain("Stückliste");
    expect(io.out).toContain("Fachboden");
    const bad = fakeIo();
    expect(run(["assembly", "examples/kitchen-basic.project.json", "--cabinet", "X9"], bad)).toBe(1);
  });
});

describe("cli drawing", () => {
  it("writes an SVG for a part and rejects unknown parts", () => {
    const io = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "B01-SL", "--lang", "de"], io)).toBe(0);
    expect(io.out).toMatch(/^<svg /);
    expect(io.out).toContain("Seite links");
    expect(io.out).toContain("Maschinenblatt");
    const asm = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "B01-SL", "--style", "upright"], asm)).toBe(0);
    expect(asm.out).toContain("sides upright");
    const s1 = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "B01-SL", "--sheet", "1"], s1)).toBe(0);
    const s2 = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "B01-SL", "--sheet", "2"], s2)).toBe(2);
    const badStyle = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "B01-SL", "--style", "nope"], badStyle)).toBe(2);
    const bad = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "X99-SL"], bad)).toBe(1);
    expect(bad.err).toContain("not found");
  });

  it("draws worktops and plinth panels (parts of ROOM, D31)", () => {
    const io = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "ROOM-WT1"], io)).toBe(0);
    expect(io.out).toMatch(/^<svg /);
    expect(io.out).toContain("3600 × 600 × 38");
  });
});

describe("cli dxf", () => {
  it("writes one DXF per part side, or a zip", () => {
    const io = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--cabinet", "B01", "--out", "out"], io)).toBe(0);
    expect(Object.keys(io.written).sort()).toContain("out/B01-SL.dxf");
    const z = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--zip", "k.zip"], z)).toBe(0);
    expect(z.written["k.zip"]).toBeInstanceOf(Uint8Array);
    const bad = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--zip", "k.zip", "--profile", "nope"], bad)).toBe(2);
  });

  it("includes worktops and plinth panels in the project export (D31)", () => {
    const io = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--out", "out"], io)).toBe(0);
    expect(Object.keys(io.written)).toEqual(expect.arrayContaining(["out/ROOM-WT1.dxf", "out/ROOM-PL1.dxf"]));
    expect(io.written["out/ROOM-WT1.dxf"]).toContain("3600 x 600 x 38 mm");
    const one = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--part", "ROOM-WT1", "--out", "out"], one)).toBe(0);
    expect(Object.keys(one.written)).toEqual(["out/ROOM-WT1.dxf"]);
    const cab = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--cabinet", "B01", "--out", "out"], cab)).toBe(0);
    expect(Object.keys(cab.written).some((f) => f.includes("ROOM"))).toBe(false);
  });

  it("fails when --part or --cabinet matches nothing instead of writing an empty export", () => {
    const part = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--part", "B01-XX", "--zip", "k.zip"], part)).toBe(1);
    expect(part.written).toEqual({});
    expect(part.err).toContain("not found");
    const cab = fakeIo();
    expect(run(["dxf", "examples/kitchen-basic.project.json", "--cabinet", "X9", "--out", "out"], cab)).toBe(1);
    expect(cab.written).toEqual({});
  });
});

describe("cli room", () => {
  it("writes the floor plan and a wall elevation", () => {
    const io = fakeIo();
    expect(run(["room", "examples/kitchen-basic.project.json", "--lang", "de"], io)).toBe(0);
    expect(io.out).toContain("Grundriss");
    const el = fakeIo();
    expect(run(["room", "examples/kitchen-basic.project.json", "--wall", "A"], el)).toBe(0);
    expect(el.out).toContain("Elevation");
    const bad = fakeIo();
    expect(run(["room", "examples/kitchen-basic.project.json", "--wall", "Z"], bad)).toBe(1);
  });
});
