import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, type Io } from "../src/app.ts";
import { readFileSync } from "node:fs";

/**
 * Golden-file tests: every project in reference/cabinets must produce exactly
 * the cutlist, the bill of materials and the machining listing in reference/expected (byte for byte). After an intended
 * change, regenerate with `pnpm test -u` and review the diff before
 * committing — the diff is the change your machine will see.
 */
const root = join(import.meta.dirname, "../../..");
const dir = join(root, "reference/cabinets");
const projects = readdirSync(dir).filter((f) => f.endsWith(".project.json")).sort();

function cli(args: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const io: Io = {
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: () => {
      throw new Error("unexpected write");
    },
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    env: {},
  };
  const code = run(args, io);
  return { code, out, err };
}

describe("reference cabinets", () => {
  it("exist", () => expect(projects.length).toBeGreaterThan(0));

  for (const file of projects) {
    const name = file.replace(/\.project\.json$/, "");
    it(name, async () => {
      const r = cli(["cutlist", join(dir, file), "--lang", "en"]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      await expect(r.out).toMatchFileSnapshot(join(root, "reference/expected", `${name}.cutlist.csv`));
    });
    it(`${name} (bill of materials)`, async () => {
      const r = cli(["bom", join(dir, file), "--lang", "en"]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      await expect(r.out).toMatchFileSnapshot(join(root, "reference/expected", `${name}.bom.csv`));
    });
    it(`${name} (machining)`, async () => {
      const r = cli(["ops", join(dir, file), "--lang", "en"]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      await expect(r.out).toMatchFileSnapshot(join(root, "reference/expected", `${name}.ops.txt`));
    });
  }
});

describe("reference DXF", () => {
  // CNC files are production data too: any change shows up as a diff here.
  for (const [project, part] of [
    ["base-600-door", "B01-SL"],
    ["base-600-door", "B01-BO"],
    ["base-600-dynapro-drawer-door", "B01-SR"],
  ] as const) {
    it(`${project} ${part}`, async () => {
      const written: Record<string, string | Uint8Array> = {};
      const io: Io = {
        readFile: (p) => readFileSync(p, "utf8"),
        writeFile: (p, c) => void (written[p] = c),
        stdout: () => {},
        stderr: () => {},
        env: {},
      };
      expect(run(["dxf", join(dir, `${project}.project.json`), "--part", part, "--out", "x"], io)).toBe(0);
      for (const [path, content] of Object.entries(written)) {
        await expect(content as string).toMatchFileSnapshot(join(root, "reference/expected", `${project}.${path.slice(2)}`));
      }
    });
  }
});

describe("performance budget", () => {
  it("builds a 50-cabinet project quickly", async () => {
    const { buildProject, loadProject } = await import("@cabinet-planner/engine");
    const project = loadProject({
      schemaVersion: 1,
      name: "perf",
      cabinets: Array.from({ length: 50 }, (_, i) => ({
        id: `C${i}`,
        type: "box",
        vars: { W: 300 + (i % 10) * 50, shelf_count: i % 4, door_count: i % 3 },
      })),
    });
    buildProject(project); // warm up
    // Best of five: test files run in parallel, a single run measures the neighbours too.
    let ms = Infinity;
    let r = buildProject(project);
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      r = buildProject(project);
      ms = Math.min(ms, performance.now() - t0);
    }
    expect(r.ok).toBe(true);
    // Target is < 50 ms on a mid-range tablet (docs/PLAN.md). CI machines
    // vary, so this only catches gross regressions.
    expect(ms).toBeLessThan(250);
  });
});
