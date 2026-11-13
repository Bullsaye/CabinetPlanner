import {
  BUNDLED,
  BUNDLED_PACKS,
  buildProject,
  checkPacks,
  CORE_PACK_ID,
  LIBRARY_KINDS,
  loadProject,
  loadShop,
  OPTIONS,
  PackSchema,
  selectPacks,
  shopPacks,
} from "@cabinet-planner/engine";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateIndex, KINDS, packDirs, readPack } from "../../../tools/packs/gen.ts";
import { run } from "../src/app.ts";

/**
 * The pack folders (D76). Lives in the CLI package because it reads the
 * folders from disk; the engine only sees the generated JSON imports.
 */
const root = join(import.meta.dirname, "../../../packs");
const dirs = packDirs(root);

describe("pack folders", () => {
  it("packs/index.ts is up to date (run `pnpm packs`)", () => {
    expect(readFileSync(join(root, "index.ts"), "utf8")).toBe(generateIndex(root));
  });

  it("the generator knows every library kind", () => {
    expect([...KINDS].sort()).toEqual([...LIBRARY_KINDS].sort());
  });

  it.each(dirs)("%s validates against the pack schema and is bundled as written", (dir) => {
    const raw = readPack(join(root, dir));
    const pack = PackSchema.parse(raw);
    expect(pack.id, "folder name = pack id").toBe(dir);
    expect(pack.author).toBe("Cabinet Planner");
    for (const lang of ["en", "de"]) {
      expect((pack.name as Record<string, string>)[lang], `name.${lang}`).toBeTruthy();
      expect((pack.description as Record<string, string>)[lang], `description.${lang}`).toBeTruthy();
    }
    expect(BUNDLED_PACKS.find((p) => p.id === dir)).toEqual(pack);
    expect(LIBRARY_KINDS.some((k) => pack.content[k].length > 0), "a pack has content").toBe(true);
  });

  it.each(dirs)("%s: one file per hardware item, named after its id", (dir) => {
    const hw = join(root, dir, "hardware");
    if (!existsSync(hw)) return;
    for (const f of readdirSync(hw).filter((x) => x.endsWith(".json"))) {
      expect(f, "file name = id").toBe(JSON.parse(readFileSync(join(hw, f), "utf8")).id + ".json");
    }
  });

  it("every hardware file is in exactly one pack", () => {
    const files = dirs.flatMap((d) => (existsSync(join(root, d, "hardware")) ? readdirSync(join(root, d, "hardware")).filter((f) => f.endsWith(".json")) : []));
    const ids = files.map((f) => f.replace(/\.json$/, "")).sort();
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUNDLED.hardware.map((h) => h.id).sort()).toEqual(ids);
  });

  it("no id is in two packs", () => {
    for (const kind of LIBRARY_KINDS) {
      const ids = BUNDLED_PACKS.flatMap((p) => (p.content[kind] as { id: string }[]).map((x) => x.id));
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
  });

  it("every id named by factory option defaults, presets and templates exists", () => {
    expect(checkPacks(BUNDLED_PACKS)).toEqual([]);
  });

  it("the README table lists every hardware item", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    for (const h of BUNDLED.hardware) expect(readme.includes(`| ${h.id} |`), h.id).toBe(true);
    for (const d of dirs) expect(readme.includes(`\`${d}\``), d).toBe(true);
  });
});

describe("building on packs", () => {
  const project = (cabinet: Record<string, unknown> = {}) => loadProject({ schemaVersion: 1, name: "t", cabinets: [{ id: "B01", type: "box", vars: { W: 600 }, ...cabinet }] });

  it("the core pack alone builds a cabinet with the factory option defaults", () => {
    const core = BUNDLED_PACKS.filter((p) => p.id === CORE_PACK_ID);
    for (const kind of ["base", "wall", "tall"] as const) {
      const r = buildProject(project({ kind, presets: [`${kind}-unit`] }), undefined, { packs: core });
      expect(r.diagnostics, kind).toEqual([]);
      expect(r.parts.length).toBeGreaterThan(4);
    }
    // Every default that names an item, also the ones a plain cabinet does not use.
    const lib = buildProject(project(), undefined, { packs: core }).library;
    for (const o of OPTIONS) {
      if (typeof o.factory !== "string") continue;
      if (o.kind.type === "hardware") expect(lib.hardware.has(o.factory), o.key).toBe(true);
      if (o.kind.type === "material") expect(lib.materials.has(o.factory), o.key).toBe(true);
      if (o.kind.type === "edgeband") expect(lib.edgebands.has(o.factory), o.key).toBe(true);
    }
  });

  it("without packs the factory defaults do not resolve: the engine itself holds no items", () => {
    const r = buildProject(project(), undefined, { packs: [] });
    expect(r.ok).toBe(false);
    expect(r.library.hardware.size + r.library.materials.size).toBe(0);
  });

  it("an explicit pack list equal to the bundled one gives the same result as the default", () => {
    const p = project({ presets: ["base-unit"], fronts: [{ type: "drawer", h: 150 }, { type: "door" }] });
    expect(buildProject(p, undefined, { packs: BUNDLED_PACKS }).parts).toEqual(buildProject(p).parts);
  });

  it("a switched-off pack leaves the library, except for what is in use", () => {
    const p = project({ options: { "hardware.hinge": "hettich-sensys-8645i-screw" } });
    const off = selectPacks(BUNDLED_PACKS, ["hardware-hettich", "hardware-blum"], [p]);
    expect(off.off).toEqual(["hardware-blum", "hardware-hettich"]);
    expect(off.kept).toEqual([{ pack: "hardware-hettich", kind: "hardware", id: "hettich-sensys-8645i-screw" }]);
    const r = buildProject(p, undefined, { packs: off.packs });
    expect(r.diagnostics).toEqual([]);
    expect(r.library.hardware.has("hettich-sensys-8645i-screw")).toBe(true);
    expect(r.library.hardware.has("hettich-duplo-5")).toBe(false);
    expect(r.library.hardware.has("blum-cliptop-110-inserta")).toBe(false);
    expect(r.parts).toEqual(buildProject(p).parts);
  });

  it("what a kept item names is kept too, and the shop file counts as use", () => {
    const shop = loadShop({ schemaVersion: 1, kind: "shop", defaults: { presets: ["wardrobe"] } });
    const sel = selectPacks(BUNDLED_PACKS, ["wardrobe-templates"], [project(), shop]);
    expect(sel.kept).toEqual([{ pack: "wardrobe-templates", kind: "presets", id: "wardrobe" }]);
  });

  it("the core pack and packs required by a switched-on pack stay on", () => {
    const sel = selectPacks(BUNDLED_PACKS, [CORE_PACK_ID, "surfaces-basic"], []);
    expect(sel.off).toEqual(["surfaces-basic"]);
    expect(Object.keys(sel.needed)).toEqual([CORE_PACK_ID]);
    expect(sel.packs.find((p) => p.id === CORE_PACK_ID)!.content.hardware.length).toBeGreaterThan(5);
    expect(sel.packs.find((p) => p.id === "surfaces-basic")!.content.surfaces).toEqual([]);
  });
});

describe("switching packs in the shop file (D76)", () => {
  const read = (f: string): Record<string, unknown> => JSON.parse(readFileSync(join(import.meta.dirname, "../../..", f), "utf8"));
  const empty = () => loadProject({ schemaVersion: 1, name: "t", cabinets: [] });

  it("buildProject applies the shop's disabledPacks by itself; an example project builds the same", () => {
    const project = loadProject(read("examples/kitchen-basic.project.json"));
    const shopDoc = read("examples/shop.json");
    const all = BUNDLED_PACKS.filter((p) => p.id !== CORE_PACK_ID).map((p) => p.id);
    const off = buildProject(project, loadShop({ ...shopDoc, disabledPacks: all }));
    const on = buildProject(project, loadShop(shopDoc));
    expect(off.parts).toEqual(on.parts);
    expect(off.diagnostics).toEqual(on.diagnostics);
    expect(off.packs.find((p) => p.id === "kitchen-templates")!.content.templates).toEqual([]);
    expect(off.library.hardware.has("blum-legrabox-40")).toBe(false);
    expect(on.library.hardware.has("blum-legrabox-40")).toBe(true);
  });

  it("a shop without disabledPacks, or with unknown ids, builds on every bundled pack", () => {
    expect(buildProject(empty(), loadShop({ schemaVersion: 1, kind: "shop" })).packs).toEqual(BUNDLED_PACKS);
    expect(buildProject(empty(), loadShop({ schemaVersion: 1, kind: "shop", disabledPacks: ["no-such-pack"] })).packs).toEqual(BUNDLED_PACKS);
    expect(buildProject(empty()).packs).toEqual(BUNDLED_PACKS);
  });

  it("keeps a switched-off drawer system that a project cabinet uses", () => {
    const project = loadProject({ schemaVersion: 1, name: "t", cabinets: [{ id: "B1", type: "box", presets: ["base-unit"], vars: { W: 600 }, options: { "hardware.slide": "grass-vionaro-v8-40" }, fronts: [{ type: "drawer" }] }] });
    const shop = loadShop({ schemaVersion: 1, kind: "shop", disabledPacks: ["hardware-grass"] });
    const sel = shopPacks(shop, [project]);
    expect(sel.off).toEqual(["hardware-grass"]);
    expect(sel.kept).toEqual([{ pack: "hardware-grass", kind: "hardware", id: "grass-vionaro-v8-40" }]);
    const r = buildProject(project, shop);
    expect(r.diagnostics).toEqual([]);
    expect(r.library.hardware.has("grass-nova-pro-scala-40")).toBe(false);
    expect(r.parts).toEqual(buildProject(project).parts);
  });
});

describe("cabinet-planner packs", () => {
  const io = (files: Record<string, string> = {}) => {
    const o = { out: "", err: "", written: {} as Record<string, string | Uint8Array> };
    return Object.assign(o, {
      readFile: (p: string) => files[p] ?? readFileSync(join(import.meta.dirname, "../../..", p), "utf8"),
      writeFile: (p: string, c: string | Uint8Array) => void (o.written[p] = c),
      stdout: (t: string) => void (o.out += t),
      stderr: (t: string) => void (o.err += t),
      env: {},
    });
  };

  it("lists the bundled packs and what a shop file switches off", () => {
    const x = io({ "shop.json": JSON.stringify({ schemaVersion: 1, kind: "shop", disabledPacks: ["hardware-blum", "core"] }) });
    expect(run(["packs", "--shop", "shop.json"], x)).toBe(0);
    for (const p of BUNDLED_PACKS) expect(x.out).toContain(p.id);
    expect(x.out).toMatch(/hardware-blum .* off/);
    expect(x.out).toMatch(/core .* on \(core\)/);
    expect(x.out).toMatch(/hardware-grass .* on\n/);
  });

  it("writes a pack as the body of a community pack publish request", () => {
    const x = io();
    expect(run(["packs", "--publish", "hardware-grass", "--lang", "de"], x)).toBe(0);
    const body = JSON.parse(x.out);
    expect(body).toMatchObject({ name: "Beschläge Grass", language: "de", licence: "CC-BY-4.0", version: "1.0.0" });
    expect(body.content.hardware.map((h: { id: string }) => h.id)).toContain("grass-vionaro-v8-40");
    const bad = io();
    expect(run(["packs", "--publish", "nope"], bad)).toBe(1);
    expect(bad.err).toContain("nope");
  });
});
