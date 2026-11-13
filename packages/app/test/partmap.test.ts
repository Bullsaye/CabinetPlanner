import { buildProject, loadProject, loadShop, OPTION_BY_KEY, ROLE_ORDER, VARIABLE_BY_NAME } from "@cabinet-planner/engine";
import { describe, expect, it } from "vitest";
import { frontFittings, HARDWARE_SETTINGS, partSources, ROLE_SETTINGS, settingDrives, sourceSettings } from "../src/lib/partmap.ts";
import example from "../../../examples/kitchen-basic.project.json" with { type: "json" };
import shop from "../../../examples/shop.json" with { type: "json" };

type Doc = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const build = (doc: Doc) => buildProject(loadProject(clone(doc)), loadShop(shop));
const known = (k: string): boolean => VARIABLE_BY_NAME.has(k) || OPTION_BY_KEY.has(k);

describe("part ↔ settings mapping", () => {
  it("names only catalogue variables and options", () => {
    const groups = [
      ...Object.values(ROLE_SETTINGS).flat(),
      ...Object.values(HARDWARE_SETTINGS),
      ...(["system", "back"] as const).map((kind) => sourceSettings({ kind, ref: "x" }, undefined).settings),
      sourceSettings({ kind: "joint", ref: "SL-BO" }, undefined).settings,
      sourceSettings({ kind: "joint", ref: "DI1-DF1" }, undefined).settings,
      sourceSettings({ kind: "joint", ref: "DT1" }, undefined).settings,
    ];
    const unknown = [...new Set(groups.flatMap((g) => g.keys))].filter((k) => !known(k));
    expect(unknown).toEqual([]);
  });

  it("covers every part role", () => {
    for (const role of ROLE_ORDER) expect(ROLE_SETTINGS[role], role).toBeDefined();
  });

  it("finds the settings behind a part's machining, and reads backwards for the highlight", () => {
    const r = build(example);
    const b01 = r.cabinets.find((c) => c.resolved.cabinet.id === "B01")!;
    const side = b01.parts.find((p) => p.role === "side_left")!;
    const kinds = new Set(partSources(side, b01.resolved, r.library).map((s) => s.kind));
    expect(kinds.has("joint")).toBe(true);
    expect(kinds.has("system")).toBe(true);
    // Hinge plates on the side: found through the option that chose the hinge.
    const hinge = partSources(side, b01.resolved, r.library).find((s) => s.item === "grass-tiomos-110-screw");
    expect(hinge?.settings.keys).toContain("hardware.hinge");
    expect(settingDrives("sys_pitch", side, b01.resolved)).toBe(true);
    expect(settingDrives("hardware.hinge", side, b01.resolved)).toBe(true);
    expect(settingDrives("t_carcase", side, b01.resolved)).toBe(true);
    const door = b01.parts.find((p) => p.role === "door")!;
    expect(settingDrives("front_gap", door, b01.resolved)).toBe(true);
    expect(settingDrives("sys_pitch", door, b01.resolved)).toBe(false);
  });

  it("knows the fittings a cabinet's fronts bring", () => {
    const r = build(example);
    const of = (id: string) => [...frontFittings(r.cabinets.find((c) => c.resolved.cabinet.id === id)!.layout)].sort();
    expect(of("B01")).toEqual(["door"]);
    expect(of("B03")).toEqual(["drawer"]);
    expect([...frontFittings(undefined)]).toEqual([]);
    const flap = clone(example);
    flap.cabinets.find((c: Doc) => c.id === "W01").fronts = [{ type: "flap" }];
    const rf = build(flap);
    expect([...frontFittings(rf.cabinets.find((c) => c.resolved.cabinet.id === "W01")!.layout)]).toEqual(["flap"]);
  });
});
