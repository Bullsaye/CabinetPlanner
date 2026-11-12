import { describe, expect, it } from "vitest";
import { drawPartSheets, resolveStyle, sceneOf, type Bore, type DrawingText, type Part } from "../src/index.ts";
import { buildOne, partsByCode } from "./helpers.ts";

const bores = (p: Part, ref?: string): Bore[] =>
  p.operations.filter((o): o is Bore => o.kind === "bore" && (!ref || o.sources.some((s) => s.ref === ref)));
const codes = (r: { diagnostics: { code: string }[] }): string[] => r.diagnostics.map((d) => d.code);
const fixed = (r: { parts: Part[] }): Part[] => r.parts.filter((p) => p.role === "fixed_shelf");

describe("fixed shelf between fronts (D71)", () => {
  it("a door over three drawers: one shelf under the door, none between the drawers", () => {
    const r = buildOne({ fronts: [{ type: "door", h: 250 }, { type: "drawer" }, { type: "drawer" }, { type: "drawer" }] });
    expect(r.diagnostics).toEqual([]);
    const fs = fixed(r);
    expect(fs).toHaveLength(1);
    // Door 467…717, gap 3: the shelf is centred on the gap at 465.5.
    expect(fs[0]!.box).toMatchObject({ y: 456, dy: 19 });
    // The top drawer keeps under the shelf.
    const dl = partsByCode(r).DL1!;
    expect(dl.box.y + dl.box.dy).toBeLessThanOrEqual(456);
  });

  it("applies to base and wall units and to every pair of fronts but two drawers", () => {
    for (const [a, b] of [["drawer", "door"], ["door", "drawer"], ["door", "flap"], ["flap", "door"], ["panel", "door"], ["drawer", "flap"]] as const) {
      const r = buildOne({ fronts: [{ type: a, h: 200 }, { type: b }] });
      expect(fixed(r), `${a} over ${b}`).toHaveLength(1);
    }
    expect(fixed(buildOne({ fronts: [{ type: "drawer", h: 200 }, { type: "drawer" }] }))).toHaveLength(0);
    expect(fixed(buildOne({ kind: "wall", presets: ["wall-unit"], fronts: [{ type: "flap", h: 300 }, { type: "door" }] }))).toHaveLength(1);
  });

  it("leaves a shelf out, or adds one between two drawers, per boundary", () => {
    const fronts = [{ type: "door", h: 300 }, { type: "drawer" }, { type: "drawer" }];
    const off = buildOne({ fronts, construction: { fixed: { "1": { panel: false } } } });
    expect(fixed(off)).toHaveLength(0);
    expect(off.diagnostics).toEqual([]);
    const forced = buildOne({ fronts, construction: { fixed: { "2": { panel: true } } } });
    expect(forced.diagnostics).toEqual([]);
    expect(fixed(forced)).toHaveLength(2);
    // The upper drawer stands on the added shelf, the lower one ends under it.
    const p = partsByCode(forced);
    const shelf = fixed(forced)[1]!;
    expect(p.DL1!.box.y).toBeGreaterThanOrEqual(shelf.box.y + 19);
    expect(p.DL2!.box.y + p.DL2!.box.dy).toBeLessThanOrEqual(shelf.box.y);
    // `panel: false` between drawers is simply no shelf; a boundary that does not exist warns.
    expect(buildOne({ fronts, construction: { fixed: { "2": { panel: false } } } }).diagnostics).toEqual([]);
    expect(codes(buildOne({ fronts, construction: { fixed: { "3": {} } } }))).toContain("construction_fixed_unknown");
  });

  it("a flap under a door hangs under the shelf between them", () => {
    const r = buildOne({ kind: "wall", presets: ["wall-unit"], vars: { W: 800, H: 900 }, fronts: [{ type: "door" }, { type: "flap", h: 400 }] });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const fs = fixed(r)[0]!;
    // Flap 0…400, door from 403: shelf centred on the gap, 392…411.
    expect(fs.box).toMatchObject({ y: 392, dy: 19 });
    // AVENTOS HK: holes 36 below the top face of the panel above the flap, not below the cabinet top.
    expect(new Set(bores(p.SL!, "blum-aventos-hk-top").map((b) => b.u))).toEqual(new Set([411 - 36]));
    // Power factor from the flap's compartment (411 high), not the 900 cabinet: 797 × 400 × 19 MDF ≈ 4.5 kg + 0.4 → LF ≈ 2030.
    expect(r.cabinets[0]!.hardware.find((h) => h.item === "blum-aventos-hk-top")).toMatchObject({ article: "22K2510" });
  });

  it("flap on cup hinges under another front: the plates go into the shelf above it", () => {
    const r = buildOne({
      kind: "wall",
      presets: ["wall-unit"],
      vars: { W: 800, H: 900 },
      options: { "hardware.flap": "hettich-lift-advanced-hk" },
      fronts: [{ type: "door" }, { type: "flap", h: 500 }],
    });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const fs = fixed(r)[0]!;
    const plate = bores(fs, "generic-hinge-110");
    expect(plate.length).toBeGreaterThan(0);
    expect(plate.every((b) => b.face === "t0")).toBe(true); // underside of the shelf
    expect(bores(partsByCode(r).TO!, "generic-hinge-110")).toEqual([]);
  });

  it("reports a flap whose shelf above or below was left out", () => {
    const above = buildOne({ kind: "wall", presets: ["wall-unit"], vars: { H: 900 }, fronts: [{ type: "door" }, { type: "flap", h: 400 }], construction: { fixed: { "1": { panel: false } } } });
    expect(codes(above)).toContain("flap_no_panel_above");
    expect(above.ok).toBe(false);
    expect(bores(partsByCode(above).SL!, "blum-aventos-hk-top")).toEqual([]);
    const below = buildOne({ kind: "wall", presets: ["wall-unit"], vars: { H: 900 }, fronts: [{ type: "flap", h: 400 }, { type: "door" }], construction: { fixed: { "1": { panel: false } } } });
    expect(codes(below)).toContain("flap_no_panel_below");
  });
});

describe("shelves per compartment (D71)", () => {
  const shelvesIn = (r: { parts: Part[] }, lo: number, hi: number): number => r.parts.filter((p) => p.role === "shelf" && p.box.y > lo && p.box.y < hi).length;

  it("a zone's own count wins; other zones keep the shelf_count rule", () => {
    const r = buildOne({ presets: ["tall-unit"], vars: { shelf_count: 4 }, fronts: [{ type: "door", h: 700, shelves: 3 }, { type: "door" }] });
    expect(r.diagnostics).toEqual([]);
    const split = fixed(r)[0]!.box.y;
    expect(shelvesIn(r, split, 2100)).toBe(3); // upper zone: its own count (the rule would give 2)
    expect(shelvesIn(r, 0, split)).toBe(4); // tallest zone: shelf_count
    const none = buildOne({ presets: ["tall-unit"], vars: { shelf_count: 4 }, fronts: [{ type: "door", h: 700, shelves: 0 }, { type: "door", shelves: "shelf_count + 1" }] });
    expect(shelvesIn(none, split, 2100)).toBe(0);
    expect(shelvesIn(none, 0, split)).toBe(5);
  });

  it("flap zones take shelves only when asked; drawer zones ignore the value", () => {
    const wall = { kind: "wall", presets: ["wall-unit"], vars: { W: 800, H: 500 } };
    expect(buildOne({ ...wall, fronts: [{ type: "flap" }] }).parts.filter((p) => p.role === "shelf")).toHaveLength(0);
    const r = buildOne({ ...wall, fronts: [{ type: "flap", shelves: 1 }] });
    expect(r.parts.filter((p) => p.role === "shelf")).toHaveLength(1);
    const d = buildOne({ fronts: [{ type: "drawer", shelves: 2 }] });
    expect(d.diagnostics).toEqual([]);
    expect(d.parts.filter((p) => p.role === "shelf")).toHaveLength(0);
  });

  it("reports a count that is not a whole number from 0", () => {
    for (const shelves of [-1, 1.5, "nope"]) {
      expect(codes(buildOne({ fronts: [{ type: "door", shelves }] })), String(shelves)).toContain("zone_shelves_invalid");
    }
  });

  it("an extra fixed panel splits the compartment: no shelf lands on it", () => {
    // One door, one shelf: the shelf would sit in the middle, where the panel is.
    const r = buildOne({ vars: { shelf_count: 1 }, construction: { panels: [{ y: 350.5 }] } });
    expect(r.diagnostics).toEqual([]);
    const sh = r.parts.filter((p) => p.role === "shelf");
    expect(sh).toHaveLength(1);
    expect(sh[0]!.box.y + sh[0]!.box.dy).toBeLessThan(350); // equal halves: the lower one gets it
    const three = buildOne({ vars: { shelf_count: 3 }, construction: { panels: [{ y: 250 }] } });
    const ys = three.parts.filter((p) => p.role === "shelf").map((p) => p.box.y);
    expect(ys.filter((y) => y < 250)).toHaveLength(1);
    expect(ys.filter((y) => y > 269)).toHaveLength(2);
  });
});

describe("drawer box height (D71)", () => {
  const three = [{ type: "drawer", h: 237.33 }, { type: "drawer", h: 237.33 }, { type: "drawer" }];

  it("0 builds the box as high as fits; a value sets the side height", () => {
    const auto = partsByCode(buildOne({ fronts: three }));
    expect(auto.DL2!.width).toBeGreaterThan(150);
    const r = buildOne({ fronts: three, vars: { drawer_box_h: 120 } });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    for (const c of ["DL1", "DR1", "DI1", "DB1", "DL2", "DL3"]) expect(p[c]!.width, c).toBe(120);
    // The underside stays where the slide puts it.
    expect(p.DL2!.box.y).toBe(auto.DL2!.box.y);
  });

  it("a zone's own height wins over the variable", () => {
    const fronts = [{ type: "drawer", h: 237.33, boxH: 90 }, { type: "drawer", h: 237.33 }, { type: "drawer", boxH: "drawer_box_h + 10" }];
    const p = partsByCode(buildOne({ fronts, vars: { drawer_box_h: 120 } }));
    expect([p.DL1!.width, p.DL2!.width, p.DL3!.width]).toEqual([90, 120, 130]);
  });

  it("reports a height that does not fit or is below the minimum", () => {
    const high = buildOne({ fronts: three, vars: { drawer_box_h: 300 } });
    expect(high.diagnostics.filter((d) => d.code === "drawer_box_too_high")).toHaveLength(3);
    expect(high.ok).toBe(false);
    expect(codes(buildOne({ fronts: three, vars: { drawer_box_h: 30 } }))).toContain("drawer_box_too_small");
    expect(codes(buildOne({ fronts: [{ type: "drawer", boxH: "x +" }] }))).toContain("zone_box_h_invalid");
  });

  it("metal sides: the largest height of the system up to the wanted one", () => {
    const base = { vars: { W: 800 }, options: { "hardware.slide": "grass-nova-pro-scala-40" }, fronts: [{ type: "drawer", h: 237.33 }, { type: "drawer", h: 237.33 }, { type: "drawer" }] };
    const auto = partsByCode(buildOne(base)).DB2!.width;
    const low = buildOne({ ...base, vars: { W: 800, drawer_box_h: 100 } });
    expect(low.diagnostics).toEqual([]);
    expect(partsByCode(low).DB2!.width).toBeLessThan(auto);
  });
});

describe("fixed blind panel fixing (D71)", () => {
  const corner = { vars: { W: 1000, door_count: 1 }, options: { corner: "blind_right", top: "full" } };

  it("dowels a blind corner panel to the side, bottom and top it lies on", () => {
    const r = buildOne(corner);
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    const bp = p.BP1!;
    const inPanel = bores(bp);
    expect(inPanel.length).toBeGreaterThan(0);
    expect(inPanel.every((b) => b.face === "t0" && b.d === 8 && b.depth === 12)).toBe(true);
    for (const c of ["SR", "BO", "TO"]) {
      const edge = bores(p[c]!, `${c}-BP1`);
      expect(edge.length, c).toBeGreaterThanOrEqual(2);
      expect(edge.every((b) => b.face === "l2" && b.depth === 25), c).toBe(true); // the front edge
      expect(bores(bp, `${c}-BP1`), c).toHaveLength(edge.length);
    }
    // The side away from the corner is behind the door, not the panel.
    expect(bores(p.SL!, "SL-BP1")).toEqual([]);
    // First and last dowel blind_dowel_offset from the ends of the edge under the panel.
    const side = bores(p.SR!, "SR-BP1").map((b) => b.u);
    expect(Math.min(...side)).toBe(50);
    expect(Math.max(...side)).toBe(717 - 50);
    // The dowels are in the hardware list.
    const plain = buildOne({ ...corner, options: { ...corner.options, "blind_panel.fixing": "none" } });
    expect(bores(partsByCode(plain).BP1!)).toEqual([]);
    const qty = (x: typeof r): number => x.cabinets[0]!.hardware.find((h) => h.item === "dowel-8x35")!.qty;
    expect(qty(r) - qty(plain)).toBe(inPanel.length);
  });

  it("follows the variables", () => {
    const r = buildOne({ ...corner, vars: { ...corner.vars, blind_dowel_offset: 100, blind_dowel_max_spacing: 1000 } });
    expect(bores(partsByCode(r).SR!, "SR-BP1").map((b) => b.u)).toEqual([100, 617]);
  });

  it("screws through an upright part behind the panel, like a drawer's inner front", () => {
    const r = buildOne({
      ...corner,
      construction: { parts: [{ id: "PO", plane: "frontal", x: "W - blind_w + 20", y: "t_carcase", z: "D - t_carcase", dx: 80, dy: "H - 2 * t_carcase", joint: "none" }] },
    });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const post = bores(partsByCode(r).PO!, "PO-BP1");
    expect(post).toHaveLength(2); // 80 wide: one column, front_screw_edge from each end
    expect(post.every((b) => b.through && b.d === 4)).toBe(true);
  });

  it("a panel zone is fixed the same way; a panel on nothing is reported", () => {
    const r = buildOne({ vars: { shelf_count: 0 }, fronts: [{ type: "appliance", h: "oven_h" }, { type: "panel" }] });
    expect(r.diagnostics).toEqual([]);
    const p = partsByCode(r);
    expect(bores(p.SL!, "SL-BP2").length).toBeGreaterThan(0);
    expect(bores(p.SR!, "SR-BP2").length).toBeGreaterThan(0);
    expect(bores(p.BO!, "BO-BP2").length).toBeGreaterThan(0);
    const loose = buildOne({ ...corner, construction: { omit: ["SR", "BO", "TO", "BK"] }, options: { ...corner.options, joint_method: "none" } });
    expect(codes(loose)).toContain("blind_panel_not_fixed");
  });
});

describe("leg fixing types (D71)", () => {
  it("knock-in socket: one bore per leg; screw plate: four pilot holes per leg", () => {
    const knock = buildOne({ options: { "hardware.leg": "generic-leg-knock-in" } });
    expect(knock.diagnostics).toEqual([]);
    const legs = knock.cabinets[0]!.fittings.filter((f) => f.kind === "leg").length;
    expect(legs).toBe(4);
    const kb = bores(partsByCode(knock).BO!, "generic-leg-knock-in");
    expect(kb).toHaveLength(legs);
    expect(kb.every((b) => b.face === "t0" && b.d === 10 && b.depth === 13)).toBe(true);

    const plate = buildOne({ options: { "hardware.leg": "generic-leg-screw-plate" } });
    expect(plate.diagnostics).toEqual([]);
    const pb = bores(partsByCode(plate).BO!, "generic-leg-screw-plate");
    expect(pb).toHaveLength(4 * legs);
    expect(pb.every((b) => b.face === "t0" && b.d === 3 && b.depth === 10)).toBe(true);
    // A square of plate_cc around each leg centre.
    const first = plate.cabinets[0]!.fittings.find((f) => f.kind === "leg")!;
    const near = pb.filter((b) => Math.abs(b.u + 19 - first.x) <= 20 && Math.abs(b.v + partsByCode(plate).BO!.box.z - first.z) <= 20);
    expect(near).toHaveLength(4);
    expect(plate.cabinets[0]!.hardware.find((h) => h.item === "generic-leg-screw-plate")).toMatchObject({ qty: legs });
  });
});

describe("through bores on both faces (D71)", () => {
  const text: DrawingText = { t: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k) };
  const r = buildOne({ options: { "hardware.handle": "generic-bar-128" } });

  it("scene: a through bore opens on the entry face and on the far face", () => {
    const door = sceneOf(r.cabinets[0]!).parts.find((p) => p.code === "DO1")!;
    const through = door.bores.filter((b) => b.through);
    expect(through).toHaveLength(4); // two handle holes, two openings each
    const front = through.filter((b) => !b.exit);
    const rear = through.filter((b) => b.exit);
    expect(front.map((b) => [b.at.z, b.dir.sign])).toEqual([[579, -1], [579, -1]]);
    expect(rear.map((b) => [b.at.z, b.dir.sign])).toEqual([[560, 1], [560, 1]]);
    expect(rear.map((b) => [b.at.x, b.at.y])).toEqual(front.map((b) => [b.at.x, b.at.y]));
    // Blind bores (hinge cups) stay single.
    expect(door.bores.filter((b) => !b.through).every((b) => !b.exit)).toBe(true);
  });

  it("part sheets: a through bore is drawn solid on the sheet of the other face too", () => {
    const door = partsByCode(r).DO1!;
    const sheets = drawPartSheets({ part: door, cabinet: { W: 600, H: 720, D: 560 }, style: resolveStyle("machine"), text });
    expect(sheets).toHaveLength(2); // cups inside, handle holes from outside
    const solid = (svg: string): number => (svg.match(/class="pd-hole"/g) ?? []).length;
    const dashed = (svg: string): number => (svg.match(/class="pd-hole-far"/g) ?? []).length;
    const handleSide = sheets.find((s) => s.view.face === "t1")!;
    const cupSide = sheets.find((s) => s.view.face === "t0")!;
    const cups = bores(door, "generic-hinge-110").length;
    expect(solid(cupSide.svg)).toBe(cups + 2); // its own bores and the two openings of the handle holes
    expect(dashed(cupSide.svg)).toBe(0);
    expect(solid(handleSide.svg)).toBe(2);
    expect(dashed(handleSide.svg)).toBe(cups);
  });
});
