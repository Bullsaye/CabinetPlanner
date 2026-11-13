import { loadShop } from "@cabinet-planner/engine";
import { describe, expect, it } from "vitest";
import {
  applyInstall,
  confirmCnc,
  fingerprint,
  listItems,
  nextVersion,
  pickContent,
  planInstall,
  prepareContent,
  renameItems,
  renamesFor,
  uninstall,
  untestedPackHardware,
} from "../src/lib/packs.ts";
import { normalizeServerUrl } from "../src/lib/cloud.ts";
import factoryHinge from "../../../packs/core/hardware/generic-hinge-110.json" with { type: "json" };

type Doc = Record<string, any>;
const shopDoc = (library: Doc = {}): Doc => ({ schemaVersion: 1, kind: "shop", name: "Test", library });
const preset = (id: string, gap = 3): Doc => ({ id, name: { en: `Gaps ${id}`, de: `Fugen ${id}` }, vars: { front_gap: gap } });
const template = (id: string, presets: string[]): Doc => ({ id, name: `Template ${id}`, cabinet: { kind: "base", presets, vars: { W: 600 }, options: { "hardware.hinge": "my-hinge" } } });
const hinge = (id: string): Doc => ({ ...factoryHinge, id, name: "My hinge" });
const info = { id: "pack1", version: "1.0.0", name: "Pack", trust: "community" as const };

describe("pack content", () => {
  it("lists items with names in the language", () => {
    const content = { presets: [preset("a")], templates: [template("t", ["a"])] };
    expect(listItems(content, "de")).toEqual([
      { kind: "presets", id: "a", name: "Fugen a" },
      { kind: "templates", id: "t", name: "Template t" },
    ]);
  });

  it("picks selected items of a library", () => {
    const lib = { presets: [preset("a"), preset("b")], hardware: [hinge("my-hinge")] };
    expect(pickContent(lib, ["presets/b", "hardware/my-hinge"])).toEqual({ presets: [preset("b")], hardware: [hinge("my-hinge")] });
  });

  it("fingerprints an item the way the engine reads it", () => {
    expect(fingerprint("presets", preset("a"))).toBe(fingerprint("presets", { ...preset("a"), options: {} }));
    expect(fingerprint("presets", preset("a"))).not.toBe(fingerprint("presets", preset("a", 4)));
  });

  it("gives hardware the trust level of its pack", () => {
    const content = { hardware: [{ ...hinge("h"), trust: "verified" }] };
    expect(prepareContent(content, "community").hardware[0].trust).toBe("untested");
    expect(prepareContent(content, "tested").hardware[0].trust).toBe("tested");
    expect(content.hardware[0].trust).toBe("verified");
  });

  it("suggests the next version", () => {
    expect(nextVersion("1.0.0")).toBe("1.0.1");
    expect(nextVersion("2.9")).toBe("2.10");
  });
});

describe("install", () => {
  it("adds new items, records the install and stays a valid shop file", () => {
    const shop = shopDoc({ presets: [preset("own")] });
    const content = prepareContent({ presets: [preset("a")], templates: [template("t", ["a"])], hardware: [hinge("my-hinge")] }, "community");
    const plan = planInstall(shop, content, "en");
    expect(plan.added.map((x) => x.id)).toEqual(["a", "t", "my-hinge"]);
    expect(plan.conflicts).toEqual([]);
    applyInstall(shop, info, content);
    expect(shop.library.presets.map((x: Doc) => x.id)).toEqual(["own", "a"]);
    expect(shop.installedPacks).toEqual([expect.objectContaining({ id: "pack1", version: "1.0.0", items: { presets: ["a"], templates: ["t"], hardware: ["my-hinge"] } })]);
    const loaded = loadShop(shop);
    expect(loaded.library.templates[0]!.cabinet.presets).toEqual(["a"]);
    expect(loaded.installedPacks?.[0]?.version).toBe("1.0.0");
    // Installing again changes nothing.
    expect(planInstall(shop, content, "en").unchanged).toHaveLength(3);
  });

  it("updates untouched items silently and asks for changed or own ones", () => {
    const shop = shopDoc({ presets: [preset("own")] });
    applyInstall(shop, info, { presets: [preset("a"), preset("b")] });
    shop.library.presets.find((x: Doc) => x.id === "b").vars.front_gap = 2.5; // the user changed b
    const v2 = { presets: [preset("a", 4), preset("b", 4), preset("own", 4)] };
    const plan = planInstall(shop, v2, "en");
    expect(plan.updated.map((x) => x.id)).toEqual(["a"]);
    expect(plan.conflicts.map((x) => x.id)).toEqual(["b", "own"]);

    const keep = structuredClone(shop);
    applyInstall(keep, { ...info, version: "2.0.0" }, v2, ["presets/b", "presets/own"]);
    expect(keep.library.presets.map((x: Doc) => [x.id, x.vars.front_gap])).toEqual([["own", 3], ["a", 4], ["b", 2.5]]);
    expect(keep.installedPacks[0].items).toEqual({ presets: ["a"] });

    applyInstall(shop, { ...info, version: "2.0.0" }, v2);
    expect(shop.library.presets.map((x: Doc) => [x.id, x.vars.front_gap])).toEqual([["own", 4], ["a", 4], ["b", 4]]);
    expect(shop.installedPacks).toHaveLength(1);
  });

  it("keeps both by renaming the pack's items and following references", () => {
    const shop = shopDoc({ presets: [preset("preset-1", 2)], hardware: [{ ...hinge("my-hinge"), name: "Mine" }] });
    const content = prepareContent({ presets: [preset("preset-1")], templates: [template("t", ["base-unit", "preset-1"])], hardware: [hinge("my-hinge")] }, "tested");
    const plan = planInstall(shop, content, "en");
    expect(plan.conflicts.map((x) => `${x.kind}/${x.id}`)).toEqual(["presets/preset-1", "hardware/my-hinge"]);
    const renames = renamesFor(shop, content, plan.conflicts, "pk");
    expect(renames).toEqual({ "presets/preset-1": "preset-1-pk", "hardware/my-hinge": "my-hinge-pk" });
    const renamed = renameItems(content, renames);
    expect(renamed.templates[0].cabinet).toMatchObject({ presets: ["base-unit", "preset-1-pk"], options: { "hardware.hinge": "my-hinge-pk" } });
    applyInstall(shop, info, renamed, [], renames);
    expect(shop.library.presets.map((x: Doc) => [x.id, x.vars.front_gap])).toEqual([["preset-1", 2], ["preset-1-pk", 3]]);
    expect(shop.library.hardware.map((x: Doc) => x.name)).toEqual(["Mine", "My hinge"]);
    loadShop(shop);
    // The next version goes to the renamed items without asking again.
    const v2 = prepareContent({ presets: [preset("preset-1", 5)], templates: [template("t", ["preset-1"])], hardware: [hinge("my-hinge")] }, "tested", shop.installedPacks[0].renames);
    const again = planInstall(shop, v2, "en");
    expect(again.conflicts).toEqual([]);
    expect(again.updated.map((x) => x.id)).toEqual(["preset-1-pk", "t"]);
  });

  it("uninstalls what was not changed", () => {
    const shop = shopDoc({ presets: [preset("own")] });
    applyInstall(shop, info, { presets: [preset("a"), preset("b")] });
    shop.library.presets.find((x: Doc) => x.id === "b").vars.front_gap = 9;
    expect(uninstall(shop, "pack1")).toEqual(["b"]);
    expect(shop.library.presets.map((x: Doc) => x.id)).toEqual(["own", "b"]);
    expect(shop.installedPacks).toEqual([]);
  });

  it("flags untested pack hardware until a CNC export was confirmed", () => {
    const shop = shopDoc();
    applyInstall(shop, info, prepareContent({ hardware: [hinge("pack-hinge")] }, "community"));
    applyInstall(shop, { ...info, id: "pack2", name: "Tested pack", trust: "tested" }, prepareContent({ hardware: [hinge("tested-hinge")] }, "tested"));
    expect(untestedPackHardware(shop, ["generic-hinge-110", "tested-hinge"])).toEqual([]);
    expect(untestedPackHardware(shop, ["pack-hinge", "tested-hinge"])).toEqual([{ id: "pack-hinge", pack: "Pack" }]);
    confirmCnc(shop, ["pack-hinge"]);
    expect(untestedPackHardware(shop, ["pack-hinge"])).toEqual([]);
    loadShop(shop);
  });
});

describe("server address", () => {
  it("normalises what people type", () => {
    expect(normalizeServerUrl(" 192.168.1.23:8787/ ")).toBe("http://192.168.1.23:8787");
    expect(normalizeServerUrl("localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeServerUrl("packs.example.com")).toBe("https://packs.example.com");
    expect(normalizeServerUrl("https://example.com/planner/")).toBe("https://example.com/planner");
    expect(normalizeServerUrl("")).toBe("");
    expect(normalizeServerUrl("http://")).toBe("");
  });
});
