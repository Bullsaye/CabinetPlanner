import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, type Io } from "../src/app.ts";

const root = join(import.meta.dirname, "../../..");

function fakeIo(files: Record<string, string> = {}): Io & { out: string; err: string; written: Record<string, string> } {
  const io = {
    out: "",
    err: "",
    written: {} as Record<string, string>,
    readFile(p: string): string {
      if (Object.hasOwn(files, p)) return files[p]!;
      return readFileSync(join(root, p), "utf8");
    },
    writeFile(p: string, c: string) {
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
    expect(lines[0]).toBe("Part,Cabinet,Name,Material,L,W,T,Cut L,Cut W,Qty,Grain,Edge L1,Edge L2,Edge W1,Edge W2,Note");
    expect(lines[1]).toBe("B01-SL,B01,Side L,Melamine white 19,720,560,19,720,559,1,,,W1,,,");
    expect(io.err).toBe("");
  });

  it("localizes headers and role names", () => {
    const io = fakeIo();
    run(["cutlist", "examples/kitchen-basic.project.json", "--lang", "de", "--group", "--delimiter", ";"], io);
    expect(io.out.split("\n")[0]).toContain("Teil;Schrank;Bezeichnung");
    expect(io.out).toContain("B01-SL B01-SR;B01;Seite L/R;Melamin weiß 19;720;560;19;720;559;2");
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

describe("cli drawing", () => {
  it("writes an SVG for a part and rejects unknown parts", () => {
    const io = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "B01-SL", "--lang", "de"], io)).toBe(0);
    expect(io.out).toMatch(/^<svg /);
    expect(io.out).toContain("Seite links");
    const bad = fakeIo();
    expect(run(["drawing", "examples/kitchen-basic.project.json", "--part", "X99-SL"], bad)).toBe(1);
    expect(bad.err).toContain("not found");
  });
});
