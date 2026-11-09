import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, type Io } from "../src/app.ts";
import { readFileSync } from "node:fs";

/**
 * Golden-file tests: every project in reference/cabinets must produce exactly
 * the cutlist and the machining listing in reference/expected (byte for byte). After an intended
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
    it(`${name} (machining)`, async () => {
      const r = cli(["ops", join(dir, file), "--lang", "en"]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      await expect(r.out).toMatchFileSnapshot(join(root, "reference/expected", `${name}.ops.txt`));
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
    const t0 = performance.now();
    const r = buildProject(project);
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    // Target is < 50 ms on a mid-range tablet (docs/PLAN.md). CI machines
    // vary, so this only catches gross regressions.
    expect(ms).toBeLessThan(250);
  });
});
