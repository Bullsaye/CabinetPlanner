import { describe, expect, it } from "vitest";
import { buildProject, loadProject, sceneOf, toCabinet, viewFittingsOf, type Bore, type CabinetResult, type Part, type ViewFitting } from "../src/index.ts";
import { buildOne } from "./helpers.ts";
import wardrobe5 from "../../../examples/wardrobe-5-sections-clamex.project.json" with { type: "json" };

const build = (cabinet: Record<string, unknown>): CabinetResult => {
  const r = buildOne(cabinet);
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return r.cabinets[0]!;
};
const of = <K extends ViewFitting["kind"]>(c: CabinetResult, kind: K): Extract<ViewFitting, { kind: K }>[] =>
  viewFittingsOf(c).filter((f): f is Extract<ViewFitting, { kind: K }> => f.kind === kind);
const part = (c: CabinetResult, id: string): Part => c.parts.find((p) => p.id === id)!;
/** Bores of a part as cabinet points. */
const boresOf = (p: Part, ref?: string): { x: number; y: number; z: number; d: number; o: Bore }[] =>
  p.operations.flatMap((o) => (o.kind === "bore" && (!ref || o.sources.some((s) => s.ref === ref)) ? [{ ...toCabinet(p, o), d: o.d, o }] : []));
const near = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.01;

describe("view fittings sit where the holes are (D74)", () => {
  it("cup hinges: cup in the door's cup bore, plate between its holes on the hinge side", () => {
    const c = build({ presets: ["base-unit"], vars: { W: 600 }, fronts: [{ type: "door", doors: 1, hinge: "left" }] });
    const item = c.resolved.options.get("hardware.hinge")!.value as string;
    const hinges = of(c, "hinge");
    expect(hinges.length).toBe(c.hardware.find((h) => h.item === item)!.qty);
    const door = c.parts.find((p) => p.role === "door")!;
    const side = c.parts.find((p) => p.role === "side_left")!;
    const cups = boresOf(door, item).filter((b) => b.d === 35);
    for (const h of hinges) {
      expect(h.part).toBe(door.id);
      expect(h.d).toBe(35);
      expect(cups.some((b) => near(b, h.at))).toBe(true);
      // On the door's inner face, opening towards the carcase; hinge edge on the left.
      expect(h.at.z).toBe(door.box.z);
      expect(h.normal).toBe("-z");
      expect(h.edge).toBe("-x");
      expect(h.at.x - door.box.x).toBeLessThan(40);
      // The plate: on the side's inner face, level with the cup, between its two holes.
      expect(h.plate?.part).toBe(side.id);
      expect(h.plate!.normal).toBe("+x");
      expect(h.plate!.at.x).toBe(side.box.x + side.box.dx);
      expect(h.plate!.at.y).toBeCloseTo(h.at.y, 6);
      expect(h.plate!.span).toBe(32);
      const holes = boresOf(side, item).filter((b) => Math.abs(b.y - h.at.y) <= 16.01);
      expect(holes).toHaveLength(2);
      expect(holes.every((b) => Math.abs(b.z - h.plate!.at.z) < 0.01 && Math.abs(Math.abs(b.y - h.plate!.at.y) - 16) < 0.01)).toBe(true);
    }
  });

  it("two doors: each hinge takes the plate on its own side", () => {
    const c = build({ kind: "wall", presets: ["wall-unit"], vars: { W: 800, door_count: 2 } });
    const hinges = of(c, "hinge");
    expect(hinges.length).toBeGreaterThanOrEqual(4);
    for (const h of hinges) {
      const left = h.edge === "-x";
      expect(part(c, h.plate!.part).role).toBe(left ? "side_left" : "side_right");
      expect(h.plate!.normal).toBe(left ? "+x" : "-x");
    }
    expect(hinges.filter((h) => h.edge === "-x").length).toBe(hinges.length / 2);
  });

  it("shelf pins: four per loose shelf, in system holes just under it", () => {
    const c = build({ kind: "wall", presets: ["wall-unit"], vars: { W: 600, shelf_count: 2 } });
    const shelves = c.parts.filter((p) => p.role === "shelf");
    expect(shelves).toHaveLength(2);
    const pins = of(c, "shelf_pin");
    expect(pins).toHaveLength(8);
    const rest = c.resolved.values.get("shelf_pin_rest")!;
    for (const shelf of shelves) {
      const own = pins.filter((p) => p.part === shelf.id);
      expect(own).toHaveLength(4);
      for (const p of own) {
        expect(p.at.y).toBeCloseTo(shelf.box.y - rest, 6);
        expect(p.at.z).toBeGreaterThan(shelf.box.z);
        expect(p.at.z).toBeLessThan(shelf.box.z + shelf.box.dz);
        const host = part(c, p.host);
        const hole = boresOf(host).find((b) => near(b, p.at));
        expect(hole?.o.sources.some((s) => s.kind === "system")).toBe(true);
        expect(p.d).toBe(hole!.d);
        // Out of the hole, towards the shelf.
        expect(p.normal).toBe(p.at.x < shelf.box.x ? "+x" : "-x");
      }
      expect(new Set(own.map((p) => p.host)).size).toBe(2);
    }
  });

  it("no shelf pins without system holes or without a support item", () => {
    expect(of(build({ presets: ["base-unit"], vars: { shelf_count: 1 }, options: { system_holes: "none" } }), "shelf_pin")).toEqual([]);
    expect(of(build({ presets: ["base-unit"], vars: { shelf_count: 1 }, options: { "hardware.shelf_support": null } }), "shelf_pin")).toEqual([]);
  });

  it("drawer slides: one per side and drawer, on the screw axis, nominal length from the front", () => {
    const c = build({ presets: ["base-unit"], vars: { W: 600 }, fronts: [{ type: "drawer", h: 150 }, { type: "drawer" }] });
    const slides = of(c, "slide");
    const drawers = c.layout!.drawers;
    expect(drawers).toHaveLength(2);
    expect(slides).toHaveLength(4);
    const D = c.resolved.values.get("D")!;
    const t = c.resolved.values.get("t_carcase")!;
    const W = c.resolved.values.get("W")!;
    for (const d of drawers) {
      for (const side of ["left", "right"] as const) {
        const s = slides.find((x) => x.drawer === d.index && x.side === side)!;
        expect(s.item).toBe(d.slide);
        expect(s.length).toBe(d.nl);
        expect(s.at).toEqual({ x: side === "left" ? t : W - t, y: d.axisY, z: D });
        expect(s.normal).toBe(side === "left" ? "+x" : "-x");
        expect(part(c, s.part).role).toBe(side === "left" ? "side_left" : "side_right");
        // Its screws are the slide item's bores in that side, all within the rail's length.
        const holes = boresOf(part(c, s.part), d.slide).filter((b) => Math.abs(b.y - d.axisY) < 0.01);
        expect(s.fixings).toEqual(holes.map((b) => b.z).sort((a, b) => b - a));
        expect(s.fixings.every((z) => z <= D && z >= D - d.nl)).toBe(true);
        // The rail fits between the side and the drawer box.
        expect(s.gap).toBeGreaterThan(0);
      }
    }
  });

  it("legs keep their place and name their bores in the bottom", () => {
    const c = build({ presets: ["base-unit"], vars: { W: 600 }, options: { "hardware.leg": "generic-leg-100" } });
    const legs = of(c, "leg");
    expect(legs).toHaveLength(c.fittings.filter((f) => f.kind === "leg").length);
    expect(legs.length).toBeGreaterThanOrEqual(4);
    const bottom = c.parts.find((p) => p.role === "bottom")!;
    for (const l of legs) {
      expect(l.part).toBe(bottom.id);
      expect(l.h).toBe(c.resolved.values.get("plinth_h"));
      expect(l.fixings).toHaveLength(1);
      expect(boresOf(bottom, "generic-leg-100").some((b) => Math.abs(b.x - l.fixings[0]!.x) < 0.01 && Math.abs(b.z - l.fixings[0]!.z) < 0.01 && b.y === bottom.box.y)).toBe(true);
    }
    // A screwed leg has no bores.
    const screwed = of(build({ presets: ["base-unit"], options: { "hardware.leg": "generic-leg-100-screwed" } }), "leg");
    expect(screwed.length).toBeGreaterThanOrEqual(4);
    expect(screwed.every((l) => l.fixings.length === 0)).toBe(true);
  });

  it("cam connectors: one housing per connector, in its bore", () => {
    const c = build({ presets: ["base-unit"], vars: { W: 600 }, options: { joint_method: "connector", "hardware.connector": "hafele-minifix-15" } });
    const cams = of(c, "connector");
    expect(cams.length).toBeGreaterThan(0);
    expect(cams.length).toBe(c.hardware.find((h) => h.item === "hafele-minifix-15")!.qty);
    for (const k of cams) {
      expect(k.d).toBe(15);
      const hole = boresOf(part(c, k.part), "hafele-minifix-15").find((b) => near(b, k.at));
      expect(hole?.d).toBe(15);
    }
  });

  it("the scene carries the fittings; every fitting names an existing part", () => {
    const c = build({ presets: ["base-unit"], vars: { W: 600, shelf_count: 1 } });
    const sc = sceneOf(c);
    expect(sc.fittings).toEqual(viewFittingsOf(c));
    expect(sc.fittings.length).toBeGreaterThan(0);
    const ids = new Set(c.parts.map((p) => p.id));
    for (const f of sc.fittings) if (f.part) expect(ids.has(f.part)).toBe(true);
  });
});

describe("view fittings in wardrobe sections and with other hardware (D74)", () => {
  // Two sections: a door hinged on the middle panel over two drawers, and a hanging section with a door.
  const wardrobe = {
    kind: "tall",
    presets: ["tall-unit", "wardrobe"],
    vars: { W: 1200, H: 2000, D: 580, plinth_h: 100 },
    options: { partition_joint: "through" },
    sections: [
      { fronts: [{ type: "door", hinge: "right" }, { type: "drawer", h: 200 }, { type: "drawer", h: 200 }], interior: "shelves", shelves: 2 },
      { interior: "hanging", fronts: [{ type: "door", hinge: "right" }] },
    ],
  };

  it("hinges on a middle panel: the half-overlay item, its plate on the panel's face towards the door", () => {
    const c = build(wardrobe);
    const middle = c.resolved.options.get("hardware.hinge_middle")!.value as string;
    const main = c.resolved.options.get("hardware.hinge")!.value as string;
    const hinges = of(c, "hinge");
    const qty = (id: string): number => c.hardware.find((h) => h.item === id)?.qty ?? 0;
    expect(qty(middle)).toBeGreaterThan(0);
    expect(hinges.filter((h) => h.item === middle)).toHaveLength(qty(middle));
    expect(hinges.filter((h) => h.item === main)).toHaveLength(qty(main));
    for (const h of hinges) {
      expect(h.plate).toBeDefined();
      const host = part(c, h.plate!.part);
      expect(host.role).toBe(h.item === middle ? "partition" : h.edge === "-x" ? "side_left" : "side_right");
      // The plate faces the door's hinge edge: a door hinged right meets the panel's left face.
      expect(h.plate!.normal).toBe(h.edge === "+x" ? "-x" : "+x");
      expect(h.plate!.at.x).toBeCloseTo(h.edge === "+x" ? host.box.x : host.box.x + host.box.dx, 6);
      expect(h.plate!.at.y).toBeCloseTo(h.at.y, 6);
      expect(h.plate!.span).toBeGreaterThan(0);
    }
  });

  it("drawer slides in a section run on the side and the middle panel", () => {
    const c = build(wardrobe);
    const slides = of(c, "slide");
    expect(c.layout!.drawers.length).toBe(2);
    expect(slides).toHaveLength(2 * c.layout!.drawers.length);
    for (const d of c.layout!.drawers) {
      const l = slides.find((s) => s.drawer === d.index && s.side === "left")!;
      const r = slides.find((s) => s.drawer === d.index && s.side === "right")!;
      expect(l.at.x).toBe(d.x0);
      expect(r.at.x).toBe(d.x1);
      expect(l.normal).toBe("+x");
      expect(r.normal).toBe("-x");
      expect(part(c, l.part).role).toBe("side_left");
      expect(part(c, r.part).role).toBe("partition");
      for (const s of [l, r]) {
        expect(s.fixings.length).toBeGreaterThan(0);
        expect(s.gap).toBeGreaterThan(0);
      }
    }
  });

  it("legs name the bottom piece above them; pins sit beside the shelves of their section", () => {
    const c = build(wardrobe);
    const legs = of(c, "leg");
    expect(legs).toHaveLength(c.fittings.filter((f) => f.kind === "leg").length);
    for (const l of legs) {
      const b = part(c, l.part!);
      expect(b.role).toBe("bottom");
      expect(l.at.x).toBeGreaterThanOrEqual(b.box.x - 0.01);
      expect(l.at.x).toBeLessThanOrEqual(b.box.x + b.box.dx + 0.01);
      expect(l.fixings).toHaveLength(1);
    }
    const pins = of(c, "shelf_pin");
    const shelves = c.parts.filter((p) => p.role === "shelf");
    expect(shelves.length).toBeGreaterThan(0);
    expect(pins).toHaveLength(4 * shelves.length);
    expect(pins.some((p) => part(c, p.host).role === "partition")).toBe(true);
  });

  it("the wardrobe example: one fitting per counted hinge, pin, slide and leg", () => {
    const c = buildProject(loadProject(wardrobe5)).cabinets[0]!;
    const fits = viewFittingsOf(c);
    const qty = (cat: (id: string) => boolean): number => c.hardware.filter((h) => cat(h.item)).reduce((a, h) => a + h.qty, 0);
    const opt = (k: string): unknown => c.resolved.options.get(k)!.value;
    const hinges = fits.filter((f) => f.kind === "hinge");
    expect(hinges).toHaveLength(qty((id) => id === opt("hardware.hinge") || id === opt("hardware.hinge_middle")));
    expect(hinges.every((f) => f.kind === "hinge" && f.plate)).toBe(true);
    expect(fits.filter((f) => f.kind === "shelf_pin")).toHaveLength(qty((id) => id === opt("hardware.shelf_support")));
    expect(fits.filter((f) => f.kind === "slide")).toHaveLength(2 * c.layout!.drawers.length);
    expect(fits.filter((f) => f.kind === "leg")).toHaveLength(qty((id) => id === opt("hardware.leg")));
    expect(fits.filter((f) => f.kind === "rail")).toHaveLength(c.layout!.rails.length);
  });

  it("other cup hinges: the cup is the largest bore, not the dowels of a press-in hinge", () => {
    const c = build({ presets: ["base-unit"], fronts: [{ type: "door" }], options: { "hardware.hinge": "blum-cliptop-110-inserta" } });
    const hinges = of(c, "hinge");
    expect(hinges.length).toBe(c.hardware.find((h) => h.item === "blum-cliptop-110-inserta")!.qty);
    expect(hinges.every((h) => h.d === 35 && h.plate)).toBe(true);
  });

  it("lift-up flaps: the fitting on both sides around its holes, and the flap's cup hinges with plates in the top", () => {
    const c = build({ kind: "wall", presets: ["wall-unit"], vars: { W: 800, H: 500 }, options: { "hardware.flap": "hettich-lift-advanced-hk" }, fronts: [{ type: "flap" }] });
    const lifts = of(c, "lift");
    expect(lifts).toHaveLength(2);
    const flap = c.parts.find((p) => p.role === "flap")!;
    for (const l of lifts) {
      expect(l.flap).toBe(flap.id);
      const side = part(c, l.part);
      expect(l.normal).toBe(side.role === "side_left" ? "+x" : "-x");
      const holes = boresOf(side, "hettich-lift-advanced-hk");
      expect(holes.length).toBeGreaterThan(0);
      expect(holes.every((b) => b.y >= l.y0 - 0.01 && b.y <= l.y1 + 0.01 && b.z >= l.z0 - 0.01 && b.z <= l.z1 + 0.01)).toBe(true);
    }
    const hinges = of(c, "hinge");
    expect(hinges.length).toBeGreaterThanOrEqual(2);
    for (const h of hinges) {
      expect(h.part).toBe(flap.id);
      expect(h.edge).toBe("+y");
      expect(h.plate?.normal).toBe("-y");
    }
  });

  it("is deterministic", () => {
    expect(JSON.stringify(viewFittingsOf(build(wardrobe)))).toBe(JSON.stringify(viewFittingsOf(build(wardrobe))));
  });
});
