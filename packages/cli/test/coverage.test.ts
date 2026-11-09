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

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [readFileSync(join(dir, e.name), "utf8")] : [],
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
