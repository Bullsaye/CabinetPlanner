import { OPTIONS, ROLE_ORDER, VARIABLES } from "@cabinet-planner/engine";
import { en } from "@cabinet-planner/i18n";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every key the engine can produce must have an English text (German is
 * checked for completeness by the compiler). Lives in the CLI package
 * because it reads the engine sources from disk.
 */
const engineSrc = join(import.meta.dirname, "../../engine/src");

function sources(dir: string, ext: RegExp = /\.ts$/): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name), ext) : ext.test(e.name) ? [readFileSync(join(dir, e.name), "utf8")] : [],
  );
}

describe("message catalogue coverage", () => {
  const has = (key: string): boolean => Object.hasOwn(en, key);

  it("has labels and hints for every variable", () => {
    for (const v of VARIABLES) {
      expect(has(`var.${v.name}`), v.name).toBe(true);
      expect(has(`var.${v.name}.hint`), v.name).toBe(true);
      expect(has(`group.${v.group}`), v.group).toBe(true);
    }
  });

  it("has labels for every option and enum value", () => {
    for (const o of OPTIONS) {
      expect(has(`option.${o.key}`), o.key).toBe(true);
      expect(has(`group.${o.group}`), o.group).toBe(true);
      if (o.kind.type === "enum") for (const v of o.kind.values) expect(has(`option.${o.key}.${v}`), v).toBe(true);
    }
  });

  it("has names for every part role", () => {
    for (const r of ROLE_ORDER) expect(has(`role.${r}`), r).toBe(true);
  });

  it("has a message for every diagnostic code in the engine", () => {
    const all = sources(engineSrc).join("\n");
    const diagCodes = [...all.matchAll(/code: "([a-z_]+)"/g)].map((m) => m[1]!).filter((c) => c !== "custom"); // zod issue code
    const exprCodes = [...all.matchAll(/new ExprError\("([a-z_]+)"/g)].map((m) => `expr_${m[1]!}`);
    const codes = new Set([...diagCodes, ...exprCodes]);
    expect(codes.size).toBeGreaterThan(20);
    for (const c of codes) expect(has(`diag.${c}`), c).toBe(true);
  });
});

describe("factory hardware library", () => {
  it("registers every JSON file in library/hardware", async () => {
    const { FACTORY_HARDWARE } = await import("@cabinet-planner/engine");
    const dir = join(import.meta.dirname, "../../engine/library/hardware");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const ids = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).id as string).sort();
    expect(FACTORY_HARDWARE.map((h) => h.id).sort()).toEqual(ids);
    for (const f of files) expect(f, "file name = id").toBe(JSON.parse(readFileSync(join(dir, f), "utf8")).id + ".json");
  });

  it("names every brand item's source", async () => {
    const { FACTORY_HARDWARE } = await import("@cabinet-planner/engine");
    for (const h of FACTORY_HARDWARE.filter((x) => x.manufacturer && x.manufacturer !== "Generic")) {
      expect(h.source, h.id).toBeTruthy();
      expect(h.articles.length, h.id).toBeGreaterThan(0);
    }
  });

  it("has a text for every literal key the app uses", () => {
    const app = sources(join(import.meta.dirname, "../../app/src"), /\.(ts|svelte)$/).join("\n");
    const keys = new Set([...app.matchAll(/\bt\("([a-z_]+\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]!));
    const missing = [...keys].filter((k) => !Object.hasOwn(en, k)).sort();
    expect(missing).toEqual([]);
  });
});
