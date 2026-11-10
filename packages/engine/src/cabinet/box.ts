import type { Diagnostic } from "../diagnostics.ts";
import type { Library } from "../library.ts";
import {
  ROLE_CODES,
  boxSize,
  roundMm,
  thicknessAxis,
  type Axis,
  type Box,
  type Part,
  type PartEdges,
  type PartRole,
} from "../part.ts";
import type { ResolvedCabinet } from "../resolve.ts";
import type { FrontZone } from "../schema.ts";
import { evaluateGraph } from "../graph.ts";
import type { LocalizedText } from "../text.ts";
import { buildCustomParts } from "./custom.ts";
import { assignSurfaces } from "./surface.ts";
import { buildDrawer } from "./drawer.ts";
import type { CabinetContext } from "./machining.ts";

/**
 * Rule for the parametric box cabinet: two sides, bottom, top (full panel or
 * two rails), back, adjustable shelves and 0–2 full-overlay doors.
 *
 * All geometry is derived from resolved variables; nothing here is a
 * hard-coded size. Coordinates: origin rear-left-bottom of the carcase,
 * X right, Y up, Z towards the front.
 */
/** Layout facts the machining stage needs besides the parts themselves. */
export interface BoxLayout {
  /** Z of the back panel's front face (first usable depth behind it). */
  backFrontZ: number;
  /** Z where carcase parts start (t_back for a surface back, else 0). */
  carcaseZ0: number;
  /** Interior between bottom and top/rails. */
  innerBottomY: number;
  innerTopY: number;
  /** Doors with the side their hinges are on. */
  doors: { code: string; hinge: "left" | "right" }[];
  /** Drawers: slide item, nominal length and rail screw axis height. */
  drawers: { index: number; slide: string; nl: number; axisY: number; box: "wood" | "metal" }[];
  /** Panels fixed to an appliance door: they get a handle like a door. */
  applianceFronts: { code: string; hinge: "left" | "right" }[];
  /**
   * Lift-up flaps (D39). `top` is the top face of the panel above the flap
   * (carcase top, or the fixed shelf over a flap under another front) and
   * `bottom` the underside of the panel below it (D57). `panelAbove` /
   * `panelBelow` are false where that shelf was left out.
   */
  flaps: { code: string; top: number; bottom: number; panelAbove: boolean; panelBelow: boolean }[];
  /** Front zones top to bottom, and the automatic fixed shelf under each (bottom face; null: none) before construction changes. */
  zones: { type: FrontZone["type"]; y0: number; y1: number; fixedBelow: number | null }[];
  /** Wardrobe rails: clear section between x0 and x1, axis at y, z. */
  rails: { x0: number; x1: number; y: number; z: number }[];
  /** Free parts (D45) and whether their ends are joined to the panels they meet. */
  custom: { code: string; joint: boolean }[];
}

export interface PlacedFront {
  type: FrontZone["type"];
  /** Appliance zones: a panel fixed to the appliance door. */
  front?: boolean;
  /** Door zones: hinge side of a single door. */
  hinge?: "left" | "right";
  doors: number;
  /** Door, open and flap zones: the zone's own number of adjustable shelves (D57). */
  shelves?: number;
  /** Drawer zones: the zone's own box side height, 0 = automatic (D57). */
  boxH?: number;
  /** Front bottom and top edge (cabinet Y). */
  y0: number;
  y1: number;
}

/**
 * Lays out the front stack top to bottom: fronts with a height keep it,
 * the others share what is left after the gaps.
 */
export function layoutFronts(
  zones: readonly FrontZone[],
  H: number,
  gaps: { top: number; bottom: number; between: number },
  doorCount: number,
  values: ReadonlyMap<string, number>,
  at: { cabinet: string },
): { fronts: PlacedFront[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (zones.length === 0) return { fronts: [], diagnostics };
  const available = H - gaps.top - gaps.bottom - gaps.between * (zones.length - 1);
  const heights: (number | undefined)[] = zones.map((z, i) => {
    if (z.h === undefined) return undefined;
    const r = evaluateGraph(new Map([["__h", z.h]]), values);
    const v = r.values.get("__h");
    if (v === undefined || r.diagnostics.length) {
      diagnostics.push({ severity: "error", code: "front_height_invalid", params: { index: i + 1, expr: String(z.h) }, ...at });
      return 0;
    }
    return v;
  });
  const fixed = heights.reduce<number>((a, h) => a + (h ?? 0), 0);
  const rest = heights.filter((h) => h === undefined).length;
  const restH = rest ? (available - fixed) / rest : 0;
  if (rest === 0 && Math.abs(fixed - available) > 0.01) {
    diagnostics.push({
      severity: "error",
      code: "fronts_sum_mismatch",
      params: { sum: roundMm(fixed), available: roundMm(available) },
      ...at,
    });
  }
  /** A zone's own value (shelf count, box height): a number or formula, never negative. */
  const own = (v: string | number | undefined, i: number, code: string, integer: boolean): number | undefined => {
    if (v === undefined) return undefined;
    const r = evaluateGraph(new Map([["__v", v]]), values);
    const x = r.values.get("__v");
    if (x === undefined || r.diagnostics.length || x < 0 || (integer && Math.abs(x - Math.round(x)) > 1e-9)) {
      diagnostics.push({ severity: "error", code, params: { index: i + 1, expr: String(v) }, ...at });
      return undefined;
    }
    return integer ? Math.round(x) : roundMm(x);
  };
  const fronts: PlacedFront[] = [];
  let top = H - gaps.top;
  zones.forEach((z, i) => {
    const h = heights[i] ?? restH;
    if (h <= 0) {
      diagnostics.push({ severity: "error", code: "fronts_too_high", params: { index: i + 1, available: roundMm(available) }, ...at });
    }
    // Values of another zone type stay in the file unused (a zone may change its type and back).
    const shelves = z.type === "door" || z.type === "open" || z.type === "flap" ? own(z.shelves, i, "zone_shelves_invalid", true) : undefined;
    const boxH = z.type === "drawer" ? own(z.boxH, i, "zone_box_h_invalid", false) : undefined;
    fronts.push({
      type: z.type,
      ...(z.type === "appliance" ? { front: z.front ?? false } : {}),
      ...(z.hinge ? { hinge: z.hinge } : {}),
      ...(shelves !== undefined ? { shelves } : {}),
      ...(boxH !== undefined ? { boxH } : {}),
      doors: z.doors ?? Math.max(1, doorCount),
      y0: roundMm(top - h),
      y1: roundMm(top),
    });
    top = top - h - gaps.between;
  });
  return { fronts, diagnostics };
}

/** System-hole Y positions on the grid inside [lo, hi]. */
export function gridPositions(y0: number, pitch: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  let k = Math.ceil((lo - y0) / pitch - 1e-9);
  for (let y = y0 + k * pitch; y <= hi + 1e-9; y = y0 + ++k * pitch) out.push(roundMm(y));
  return out;
}

export type AddPart = (
  role: PartRole,
  index: number | undefined,
  box: Box,
  lengthAxis: Axis,
  widthAxis: Axis,
  materialKey: string,
  edges: PartEdges,
  /** Free parts (D45): their own code, material id and name. */
  custom?: { code: string; material: string; label?: LocalizedText; note?: string },
) => void;

export function buildBox(
  rc: ResolvedCabinet,
  library: Library,
  context: CabinetContext = {},
): { parts: Part[]; diagnostics: Diagnostic[]; layout: BoxLayout } {
  const diagnostics: Diagnostic[] = [];
  const cab = rc.cabinet.id;
  const num = (name: string): number => {
    const v = rc.values.get(name);
    if (v === undefined) throw new Error(`variable ${name} unresolved`); // caller checks for errors first
    return v;
  };
  const opt = <T extends string | boolean | null>(key: string): T => rc.options.get(key)!.value as T;

  const W = num("W");
  const H = num("H");
  const D = num("D");
  const t = num("t_carcase");
  const tBack = num("t_back");
  const tShelf = num("t_shelf");
  const tFront = num("t_front");

  const joint = opt<"sides_over" | "sides_between">("carcase_joint");
  const topOpt = opt<"auto" | "full" | "rails">("top");
  const top: "full" | "rails" = topOpt !== "auto" ? topOpt : rc.cabinet.kind === "base" ? opt<"full" | "rails">("top.base_unit") : "full";
  const backMount = opt<"groove" | "rebate" | "surface" | "none">("back_mount");
  const deduct = opt<boolean>("edge.deduct");

  const edgeCarcase = opt<string | null>("edge.carcase");
  const edgeShelf = opt<string | null>("edge.shelf");
  const edgeFront = opt<string | null>("edge.front");

  // Back mount determines where the carcase starts and where the back's front face is.
  const play = num("back_play");
  const carcaseZ0 = backMount === "surface" ? tBack : 0; // carcase parts start in front of a surface back
  const Dc = D - carcaseZ0;
  let backFrontZ: number;
  if (backMount === "groove") {
    const gd = num("back_groove_depth");
    if (gd >= t) {
      diagnostics.push({ severity: "error", code: "back_groove_too_deep", params: { depth: gd, thickness: t }, cabinet: cab });
    }
    backFrontZ = num("back_groove_offset") + tBack;
  } else {
    if (backMount === "rebate") {
      const rd = num("back_rebate_depth");
      if (rd >= t) {
        diagnostics.push({ severity: "error", code: "back_rebate_too_deep", params: { depth: rd, thickness: t }, cabinet: cab });
      }
    }
    backFrontZ = backMount === "none" ? 0 : tBack;
  }

  const parts: Part[] = [];
  const doors: BoxLayout["doors"] = [];
  const add: AddPart = (
    role: PartRole,
    index: number | undefined,
    box: Box,
    lengthAxis: Axis,
    widthAxis: Axis,
    materialKey: string,
    edges: PartEdges,
    custom?: { code: string; material: string; label?: LocalizedText; note?: string },
  ): void => {
    const code = custom?.code ?? ROLE_CODES[role] + (index ?? "");
    const override = rc.cabinet.parts[code];
    const material = override?.material ?? custom?.material ?? (rc.options.get(materialKey)!.value as string);
    const finalEdges: PartEdges = { ...edges };
    if (override?.edges) {
      for (const k of ["l1", "l2", "w1", "w2"] as const) {
        const e = override.edges[k];
        if (e !== undefined) finalEdges[k] = e;
      }
    }
    // Faces are rounded where they lie, so parts that meet in a plane share it exactly
    // (x and dx rounded separately can end 0.01 apart); the thickness stays the board's.
    const tAxis = thicknessAxis(lengthAxis, widthAxis);
    const span = (a: Axis, lo: number, d: number): number => (a === tAxis ? roundMm(d) : roundMm(roundMm(lo + d) - roundMm(lo)));
    const rounded: Box = {
      x: roundMm(box.x),
      y: roundMm(box.y),
      z: roundMm(box.z),
      dx: span("x", box.x, box.dx),
      dy: span("y", box.y, box.dy),
      dz: span("z", box.z, box.dz),
    };
    const length = boxSize(rounded, lengthAxis);
    const width = boxSize(rounded, widthAxis);
    const thickness = boxSize(rounded, thicknessAxis(lengthAxis, widthAxis));
    const id = `${cab}-${code}`;

    const mat = library.materials.get(material);
    if (!mat) {
      diagnostics.push({ severity: "error", code: "material_unknown", params: { key: code, value: material }, cabinet: cab, part: id });
    } else if (mat.thickness !== thickness) {
      diagnostics.push({
        severity: "warning",
        code: "part_thickness_differs_from_material",
        params: { part: id, thickness, material: mat.thickness },
        cabinet: cab,
        part: id,
      });
    }

    const bandT = (e: string | null): number => {
      if (e === null) return 0;
      const band = library.edgebands.get(e);
      if (!band) {
        diagnostics.push({ severity: "error", code: "edgeband_unknown", params: { key: code, value: e }, cabinet: cab, part: id });
        return 0;
      }
      return band.thickness;
    };
    const tl1 = bandT(finalEdges.l1);
    const tl2 = bandT(finalEdges.l2);
    const tw1 = bandT(finalEdges.w1);
    const tw2 = bandT(finalEdges.w2);

    const part: Part = {
      id,
      code,
      cabinet: cab,
      role,
      ...(index !== undefined ? { index } : {}),
      material,
      length,
      width,
      thickness,
      cutLength: deduct ? roundMm(length - tw1 - tw2) : length,
      cutWidth: deduct ? roundMm(width - tl1 - tl2) : width,
      lengthAxis,
      widthAxis,
      grain: mat?.grain ?? false,
      edges: finalEdges,
      box: rounded,
      operations: [],
      ...(custom?.label !== undefined ? { label: custom.label } : {}),
      ...(override?.note ?? custom?.note ? { note: override?.note ?? custom?.note } : {}),
    };
    if (part.length <= 0 || part.width <= 0 || part.thickness <= 0 || part.cutLength <= 0 || part.cutWidth <= 0) {
      diagnostics.push({
        severity: "error",
        code: "part_nonpositive",
        params: { part: id, length: part.length, width: part.width, thickness: part.thickness },
        cabinet: cab,
        part: id,
      });
    }
    parts.push(part);
  };

  const front = (e: string | null): PartEdges => ({ l1: null, l2: e, w1: null, w2: null });
  const none: PartEdges = { l1: null, l2: null, w1: null, w2: null };

  // --- Sides, bottom and top --------------------------------------------
  // sides_over: sides run full height, bottom/top sit between them.
  // sides_between: bottom/top run full width, sides sit between them.
  const sideY = joint === "sides_over" ? 0 : t;
  const sideH = joint === "sides_over" ? H : H - 2 * t;
  const hzX = joint === "sides_over" ? t : 0; // horizontal panels
  const hzW = joint === "sides_over" ? W - 2 * t : W;

  add("side_left", undefined, { x: 0, y: sideY, z: carcaseZ0, dx: t, dy: sideH, dz: Dc }, "y", "z", "material.carcase", front(edgeCarcase));
  add("side_right", undefined, { x: W - t, y: sideY, z: carcaseZ0, dx: t, dy: sideH, dz: Dc }, "y", "z", "material.carcase", front(edgeCarcase));
  // Back behind the horizontals: bottom and top end at the back's front face (D35).
  const backBehind = opt<string>("back_extent") === "behind_horizontals" && backMount !== "surface";
  if (backBehind && joint === "sides_between") {
    diagnostics.push({ severity: "error", code: "back_behind_needs_sides_over", params: {}, cabinet: cab });
  }
  const hz0 = backBehind ? backFrontZ : carcaseZ0;
  // Bottom, shortened at the rear (room for pipes) and/or the front (D41).
  const bsRear = num("bottom_setback_rear");
  const bsFront = num("bottom_setback_front");
  add("bottom", undefined, { x: hzX, y: 0, z: hz0 + bsRear, dx: hzW, dy: t, dz: D - bsFront - hz0 - bsRear }, "x", "z", "material.carcase", front(edgeCarcase));
  const uprightOk = (code: string): boolean => {
    if (joint === "sides_over") return true;
    diagnostics.push({ severity: "error", code: "upright_rail_needs_sides_over", params: { rail: code }, cabinet: cab });
    return false;
  };

  if (top === "full") {
    add("top", undefined, { x: hzX, y: H - t, z: hz0, dx: hzW, dy: t, dz: D - hz0 }, "x", "z", "material.carcase", front(edgeCarcase));
  } else {
    // Rails: flat (in the top plane, rail_w deep) or upright (standing, rail_w high), or none.
    const railW = num("rail_w");
    const rf = opt<"flat" | "upright" | "none">("rail.front");
    const rr = opt<"flat" | "upright" | "none">("rail.rear");
    if (rf === "flat") add("rail_front", undefined, { x: hzX, y: H - t, z: D - railW, dx: hzW, dy: t, dz: railW }, "x", "z", "material.carcase", front(edgeCarcase));
    if (rf === "upright" && uprightOk("RF")) add("rail_front", undefined, { x: hzX, y: H - railW, z: D - t, dx: hzW, dy: railW, dz: t }, "x", "y", "material.carcase", front(edgeCarcase));
    if (rr === "flat") add("rail_rear", undefined, { x: hzX, y: H - t, z: backFrontZ, dx: hzW, dy: t, dz: railW }, "x", "z", "material.carcase", none);
    if (rr === "upright" && uprightOk("RR")) add("rail_rear", undefined, { x: hzX, y: H - railW, z: backFrontZ, dx: hzW, dy: railW, dz: t }, "x", "y", "material.carcase", none);
    const depthOf = (o: string): number => (o === "flat" ? railW : o === "upright" ? t : 0);
    if (backFrontZ + depthOf(rr) > D - depthOf(rf)) {
      diagnostics.push({ severity: "error", code: "rails_overlap", params: { rail_w: railW, depth: D }, cabinet: cab });
    }
  }
  // Rear rail at the bottom (sink units): flat behind the shortened bottom, or upright.
  const rb = opt<"none" | "flat" | "upright">("rail.bottom");
  if (rb !== "none") {
    const bw = num("rail_bottom_w");
    // An upright rail stands in front of the back, like the upright rear rail at the top.
    const railZ = rb === "flat" ? hz0 : backFrontZ;
    const depth = rb === "flat" ? bw : railZ - hz0 + t;
    if (depth > bsRear + 1e-6) {
      diagnostics.push({ severity: "error", code: "bottom_rail_overlap", params: { need: roundMm(depth), setback: roundMm(bsRear) }, cabinet: cab });
    }
    if (rb === "flat") add("rail_bottom", undefined, { x: hzX, y: 0, z: hz0, dx: hzW, dy: t, dz: bw }, "x", "z", "material.carcase", none);
    else if (uprightOk("RB")) add("rail_bottom", undefined, { x: hzX, y: 0, z: railZ, dx: hzW, dy: bw, dz: t }, "x", "y", "material.carcase", none);
  }
  // Clear interior height: upright rails take their height under the top and above the bottom (D50).
  const uprightTop = top === "rails" && (opt<string>("rail.front") === "upright" || opt<string>("rail.rear") === "upright");
  const interiorTop = H - (uprightTop ? Math.max(t, num("rail_w")) : t);
  const interiorBottom = rb === "upright" ? Math.max(t, num("rail_bottom_w")) : t;
  // Upright rails as high as the carcase (or higher) would run through the bottom or each other.
  if ((uprightTop || rb === "upright") && interiorTop < interiorBottom - 1e-6) {
    diagnostics.push({ severity: "error", code: "upright_rails_too_high", params: { height: H, over: roundMm(interiorBottom - interiorTop) }, cabinet: cab });
  }

  // --- Middle panels -----------------------------------------------------------
  // Vertical panels between bottom and top, in front of the back, dividing
  // the interior into equal sections (each gets its own shelves).
  let nPart = num("partition_count");
  if (nPart > 0 && rc.cabinet.fronts?.some((f) => f.type === "drawer")) {
    diagnostics.push({ severity: "warning", code: "partitions_with_drawers", params: { count: nPart }, cabinet: cab });
    nPart = 0;
  }
  const LW = W - 2 * t;
  const sw = (LW - nPart * t) / (nPart + 1);
  const sections: [number, number][] = [];
  // Sections end on the panels' faces as the parts are made (rounded), so shelves and joints meet them exactly.
  const partitionX = (i: number): number => roundMm(t + i * sw + (i - 1) * t);
  for (let k = 0; k <= nPart; k++) sections.push([k === 0 ? t : partitionX(k) + t, k === nPart ? W - t : partitionX(k + 1)]);
  if (nPart > 0) {
    const z0 = backFrontZ;
    for (let i = 1; i <= nPart; i++) {
      add(
        "partition",
        i,
        { x: partitionX(i), y: t, z: z0, dx: t, dy: H - 2 * t, dz: D - num("partition_setback") - z0 },
        "y",
        "z",
        "material.carcase",
        front(edgeCarcase),
      );
    }
  }

  // --- Front stack -----------------------------------------------------------
  const fz = layoutFronts(
    rc.cabinet.fronts ?? (num("door_count") > 0 ? [{ type: "door" as const }] : []),
    H,
    { top: num("front_gap_top"), bottom: num("front_gap_bottom"), between: num("front_gap") },
    num("door_count"),
    rc.values,
    { cabinet: cab },
  );
  diagnostics.push(...fz.diagnostics);
  const fronts = fz.fronts;

  // --- Fixed shelves ------------------------------------------------------------
  // Structural shelves (dowelled like the bottom) between any two front
  // zones, except between two drawers (D57). Under an appliance the shelf's
  // top is the front's lower edge, above it the shelf sits one gap above the
  // front, so the niche is front height + gap; otherwise the shelf is
  // centred on the gap.
  const between = num("front_gap");
  const fixedAt: (number | undefined)[] = []; // bottom face of the shelf under zone i
  const drawersOnly = (i: number): boolean => fronts[i]!.type === "drawer" && fronts[i + 1]!.type === "drawer";
  /** Where the shelf between zone i and the one below lies (bottom face); undefined when it does not fit. */
  const fixedY = (i: number): number | undefined => {
    const a = fronts[i]!;
    const b = fronts[i + 1]!;
    const y = a.type === "appliance" ? a.y0 - t : b.type === "appliance" ? b.y1 + between : (a.y0 + b.y1) / 2 - t / 2;
    if (y < interiorBottom - 1e-6 || y + t > interiorTop + 1e-6) {
      diagnostics.push({ severity: "error", code: "fixed_shelf_outside", params: { index: i + 1 }, cabinet: cab });
      return undefined;
    }
    return roundMm(y);
  };
  for (let i = 0; i + 1 < fronts.length; i++) {
    if (!drawersOnly(i)) fixedAt[i] = fixedY(i);
  }
  // --- Construction elements (D38) ------------------------------------------------
  const fixedAuto = fronts.map((_, i) => fixedAt[i] ?? null);
  const cons = rc.cabinet.construction;
  const zoneVars = new Map(rc.values);
  fronts.forEach((f, i) => {
    zoneVars.set(`zone${i + 1}_y0`, f.y0);
    zoneVars.set(`zone${i + 1}_y1`, f.y1);
  });
  // Layout facts for formulas (D45): they follow the back and joint rules.
  for (const [k, v] of [["back_front_z", backFrontZ], ["carcase_z0", carcaseZ0], ["inner_x0", t], ["inner_x1", W - t], ["inner_y0", t], ["inner_y1", H - t]] as const) {
    if (!zoneVars.has(k)) zoneVars.set(k, v);
  }
  const cval = (v: string | number, what: string): number => {
    const r = evaluateGraph(new Map([["__c", v]]), zoneVars);
    const x = r.values.get("__c");
    if (x === undefined || r.diagnostics.length) {
      diagnostics.push({ severity: "error", code: "construction_value_invalid", params: { what, expr: String(v) }, cabinet: cab });
      return 0;
    }
    return x;
  };
  /** Setbacks of each fixed shelf by its bottom y (rear setback keeps it off the back). */
  const fixedSetback = new Map<number, { front: number; rear: number }>();
  for (const [k, f] of Object.entries(cons?.fixed ?? {})) {
    const i = Number(k) - 1;
    if (!(Number.isInteger(i) && i >= 0 && i + 1 < fronts.length)) {
      diagnostics.push({ severity: "warning", code: "construction_fixed_unknown", params: { index: k }, cabinet: cab });
      continue;
    }
    // Between two drawers the rule puts no shelf; `panel: true` asks for one (D57).
    if (f.panel && drawersOnly(i)) fixedAt[i] = fixedY(i);
    if (!f.panel) fixedAt[i] = undefined;
    else if (fixedAt[i] !== undefined) fixedSetback.set(fixedAt[i]!, { front: cval(f.setbackFront, `fixed ${k}`), rear: cval(f.setbackRear, `fixed ${k}`) });
  }
  const extraPanels = (cons?.panels ?? []).map((pn, k) => {
    const y = roundMm(cval(pn.y, `panel ${k + 1}`));
    if (y < interiorBottom - 1e-6 || y + t > interiorTop + 1e-6) diagnostics.push({ severity: "error", code: "construction_panel_outside", params: { index: k + 1 }, cabinet: cab });
    return { y, front: cval(pn.setbackFront, `panel ${k + 1}`), rear: cval(pn.setbackRear, `panel ${k + 1}`) };
  });
  const noBack = new Set(cons?.noBack ?? []);
  // A split back needs the panels it ends at to reach into its groove.
  const splitBack = noBack.size > 0;
  const backReachZ = splitBack && !backBehind && backMount !== "surface" && backMount !== "none" ? carcaseZ0 : backFrontZ;

  // Clear interior of each zone, between fixed shelves (or bottom / top).
  const zoneRange = (i: number): [number, number] => {
    const f = fronts[i]!;
    const below = fixedAt[i];
    const above = i > 0 ? fixedAt[i - 1] : undefined;
    return [below !== undefined ? below + t : Math.max(interiorBottom, f.y0), above !== undefined ? above : Math.min(interiorTop, f.y1)];
  };
  // Drawers stop at fixed shelves, else at the carcase bottom and top.
  const drawerBounds = (i: number): { floor: number; ceil: number } => ({
    floor: fixedAt[i] !== undefined ? fixedAt[i]! + t : t,
    ceil: i > 0 && fixedAt[i - 1] !== undefined ? fixedAt[i - 1]! : interiorTop,
  });

  const fsEdges = front(edgeCarcase);
  const fsZ1 = D - num("fixed_shelf_setback");
  let fixedNo = 0;
  /** Panels the back may end at: full depth to the back (no rear setback). */
  const backStops: number[] = [];
  const fixedShelf = (x0: number, x1: number, y: number, sb = { front: 0, rear: 0 }): void => {
    const z0 = (sb.rear > 0 ? backFrontZ : backReachZ) + sb.rear;
    add("fixed_shelf", ++fixedNo, { x: x0, y, z: z0, dx: x1 - x0, dy: t, dz: fsZ1 - sb.front - z0 }, "x", "z", "material.carcase", fsEdges);
  };
  for (let i = 0; i < fixedAt.length; i++) {
    const y = fixedAt[i];
    if (y === undefined) continue;
    const sb = fixedSetback.get(y);
    for (const [sx0, sx1] of sections) fixedShelf(sx0, sx1, y, sb);
    if (!sb || sb.rear <= 0) backStops.push(y);
  }
  for (const pn of extraPanels) {
    for (const [sx0, sx1] of sections) fixedShelf(sx0, sx1, pn.y, pn);
    if (pn.rear <= 0) backStops.push(pn.y);
  }

  // --- Back ----------------------------------------------------------------
  // Inner opening between the carcase panels; the back reaches `engage` mm
  // into the surrounding panels (groove or rebate depth minus play). With
  // zones left without a back (D38) it splits into panels between the
  // fixed panels around the zones that keep one.
  {
    const engage = backMount === "surface" ? 0 : (backMount === "groove" ? num("back_groove_depth") : num("back_rebate_depth")) - play;
    const zBack = backMount === "groove" ? num("back_groove_offset") : 0;
    const topFace = top === "full" ? H - t : H; // underside of the top (rails: none)
    /** Back from the panel at yLo (bottom face; 0 = bottom) to the panel at yHi (bottom face; topFace = top). */
    const backBox = (yLo: number, yHi: number): Box => {
      if (backMount === "surface") {
        const y0 = yLo <= 0 ? 0 : yLo + t / 2;
        const y1 = yHi >= topFace ? H : yHi + t / 2;
        return { x: 0, y: y0, z: 0, dx: W, dy: y1 - y0, dz: tBack };
      }
      const y0 = backBehind ? (yLo <= 0 ? 0 : yLo + t / 2) : yLo + t - engage;
      const y1 = backBehind
        ? yHi >= topFace ? H : yHi + t / 2
        : yHi >= topFace ? (top === "full" ? H - t + engage : H - play) : yHi + engage;
      return { x: t - engage, y: y0, z: zBack, dx: W - 2 * t + 2 * engage, dy: y1 - y0, dz: tBack };
    };
    if (backMount === "none") {
      // No back (sink units): nothing to add.
    } else if (!splitBack) {
      add("back", undefined, backBox(0, topFace), "y", "x", "material.back", none);
    } else {
      // Sections between the stops; a section keeps its back unless the zone at its middle has none.
      const stops = [0, ...[...new Set(backStops)].sort((a, b) => a - b), topFace];
      const zoneAt = (y: number): number => fronts.findIndex((f, i) => {
        const [lo, hi] = zoneRange(i);
        return y >= lo - 1e-6 && y <= hi + 1e-6;
      }) + 1;
      let k = 0;
      let runStart: number | undefined;
      for (let i = 0; i + 1 < stops.length; i++) {
        const mid = (stops[i]! + (i === 0 ? t : t) + stops[i + 1]!) / 2;
        const keep = !noBack.has(zoneAt(mid));
        if (keep && runStart === undefined) runStart = stops[i]!;
        const last = i + 2 === stops.length;
        if (runStart !== undefined && (!keep || last)) {
          const end = keep ? stops[i + 1]! : stops[i]!;
          if (end > runStart) add("back", ++k, backBox(runStart, end), "y", "x", "material.back", none);
          runStart = undefined;
        }
      }
    }
  }

  // Shelves (and a wardrobe interior) live in the tallest door or open zone;
  // without fronts, in the whole interior.
  const shelfZones = fronts
    .map((f, i) => ({ f, i, r: zoneRange(i) }))
    .filter((z) => z.f.type === "door" || z.f.type === "open")
    .sort((a, b) => b.r[1] - b.r[0] - (a.r[1] - a.r[0]));
  const shelfRange: [number, number] | undefined = fronts.length === 0 ? [interiorBottom, interiorTop] : shelfZones[0]?.r;

  // --- Wardrobe interior: hat shelf and hanging rail per hanging section --------
  const interior = opt<"shelves" | "hanging" | "hanging_first" | "hanging_last">("interior");
  const hanging = new Set<number>();
  if (interior !== "shelves" && shelfRange) {
    if (interior === "hanging") sections.forEach((_, k) => hanging.add(k));
    else hanging.add(interior === "hanging_first" ? 0 : sections.length - 1);
  }
  const rails: BoxLayout["rails"] = [];
  if (hanging.size && shelfRange) {
    const hatY = shelfRange[1] - num("hat_shelf_drop") - t;
    const railY = hatY - num("rail_drop");
    if (railY <= shelfRange[0]) {
      diagnostics.push({ severity: "error", code: "hanging_too_low", params: { space: roundMm(shelfRange[1] - shelfRange[0]) }, cabinet: cab });
    } else {
      for (const k of [...hanging].sort()) {
        const [sx0, sx1] = sections[k]!;
        fixedShelf(sx0, sx1, roundMm(hatY));
        rails.push({ x0: roundMm(sx0), x1: roundMm(sx1), y: roundMm(railY), z: roundMm((backFrontZ + D) / 2) });
      }
    }
  }

  // --- Adjustable shelves ----------------------------------------------------
  const shelfCount = num("shelf_count");
  if (shelfCount > 0 && !shelfRange && rc.vars.get("shelf_count")?.source.layer === "cabinet" && !rc.vars.get("shelf_count")?.source.preset) {
    diagnostics.push({ severity: "warning", code: "shelves_no_door_zone", params: { count: shelfCount }, cabinet: cab });
  }
  // The tallest zone gets shelf_count shelves; other door/open zones get
  // as many in proportion to their height (zones split by fixed shelves).
  // A zone's own count (`shelves`, D57) wins for that zone; flap zones only
  // get shelves that way.
  const zonePlan: { range: [number, number]; count: number; main: boolean; own: boolean }[] =
    fronts.length === 0
      ? shelfRange
        ? [{ range: shelfRange, count: shelfCount, main: true, own: false }]
        : []
      : [
          ...shelfZones.map((z, k) => ({
            range: z.r,
            count: z.f.shelves ?? (k === 0 ? shelfCount : Math.round((shelfCount * (z.r[1] - z.r[0])) / (shelfRange![1] - shelfRange![0]))),
            main: k === 0,
            own: z.f.shelves !== undefined,
          })),
          ...fronts.flatMap((f, i) => (f.type === "flap" && f.shelves !== undefined ? [{ range: zoneRange(i), count: f.shelves, main: false, own: true }] : [])),
        ];
  // Extra panels (D38) inside a zone split it into compartments; the zone's
  // shelves are shared out by compartment height (largest remainders, lower
  // compartment first), so no shelf lands on a panel (D57).
  const shelfPlan: { range: [number, number]; count: number; main: boolean }[] = [];
  for (const z of zonePlan) {
    if (z.count <= 0 || (!z.main && !z.own && fixedAt.every((y) => y === undefined))) continue;
    const cuts = [...new Set(extraPanels.map((p) => p.y))].filter((y) => y > z.range[0] + 1e-6 && y + t < z.range[1] - 1e-6).sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    let lo = z.range[0];
    for (const y of cuts) {
      if (y < lo) continue; // panels overlapping each other
      ranges.push([lo, y]);
      lo = y + t;
    }
    ranges.push([lo, z.range[1]]);
    const total = ranges.reduce((a, r) => a + (r[1] - r[0]), 0);
    const share = ranges.map((r) => (total > 0 ? (z.count * (r[1] - r[0])) / total : 0));
    const counts = share.map((x) => Math.floor(x + 1e-9));
    const order = share.map((x, k) => ({ k, rest: x - counts[k]! })).sort((a, b) => b.rest - a.rest || a.k - b.k);
    for (let n = z.count - counts.reduce((a, b) => a + b, 0), k = 0; n > 0 && k < order.length; n--, k++) counts[order[k]!.k]!++;
    ranges.forEach((range, k) => shelfPlan.push({ range, count: counts[k]!, main: z.main }));
  }
  let shelfNo = 0;
  for (const { range, count, main } of shelfPlan) {
    if (count <= 0) continue;
    const gap = num("shelf_gap");
    const zStart = backFrontZ + num("shelf_back_gap");
    const zEnd = D - num("shelf_front_setback");
    const [innerBottom, innerTop] = range;
    const pitch = (innerTop - innerBottom) / (count + 1);
    // With system holes, shelves rest on pins in the nearest hole row so the
    // view shows a real position; height does not change the cutlist.
    const holes =
      opt<string>("system_holes") === "full"
        ? gridPositions(num("sys_grid_y0"), num("sys_pitch"), innerBottom + num("sys_margin"), innerTop - num("sys_margin"))
        : [];
    let crowded = false;
    for (const [k, [sx0, sx1]] of sections.entries()) {
      if (main && hanging.has(k)) continue;
      let lastTop = innerBottom;
      for (let i = 1; i <= count; i++) {
        const target = innerBottom + i * pitch - tShelf / 2;
        const rest = num("shelf_pin_rest");
        const nearest = holes.length
          ? holes.reduce((a, b) => (Math.abs(b + rest - target) < Math.abs(a + rest - target) ? b : a))
          : undefined;
        const y = nearest !== undefined ? nearest + rest : target;
        // More shelves than the zone can take: they would overlap each other or the panels around them.
        if (!crowded && (y < lastTop - 1e-6 || y + tShelf > innerTop + 1e-6)) {
          crowded = true;
          diagnostics.push({ severity: "error", code: "shelves_too_close", params: { count, space: roundMm(innerTop - innerBottom) }, cabinet: cab });
        }
        lastTop = y + tShelf;
        add(
          "shelf",
          ++shelfNo,
          { x: sx0 + gap, y, z: zStart, dx: sx1 - sx0 - 2 * gap, dy: tShelf, dz: zEnd - zStart },
          "x",
          "z",
          "material.shelf",
          front(edgeShelf),
        );
      }
    }
  }

  // --- Fronts: doors and drawer fronts (full overlay) ---------------------------
  const drawers: BoxLayout["drawers"] = [];
  const applianceFronts: BoxLayout["applianceFronts"] = [];
  const flaps: BoxLayout["flaps"] = [];
  {
    // Vertical joints: left and right edge, between doors side by side (D35).
    const gl = num("front_gap_left");
    const gr = num("front_gap_right");
    const gap = num("front_gap_middle");
    const all: PartEdges = { l1: edgeFront, l2: edgeFront, w1: edgeFront, w2: edgeFront };
    let doorNo = 0;
    let drawerNo = 0;
    let applianceNo = 0;
    let flapNo = 0;
    for (const [fi, f] of fronts.entries()) {
      const h = f.y1 - f.y0;
      if (f.type === "open") continue;
      if (f.type === "flap") {
        flapNo++;
        add("flap", flapNo, { x: gl, y: f.y0, z: D, dx: W - gl - gr, dy: h, dz: tFront }, "x", "y", "material.front", all);
        // The flap's compartment: from the panel below it to the panel above it (carcase top and bottom at the ends, D57).
        const above = fi > 0 ? fixedAt[fi - 1] : undefined;
        const below = fi + 1 < fronts.length ? fixedAt[fi] : undefined;
        flaps.push({
          code: `${ROLE_CODES.flap}${flapNo}`,
          top: above !== undefined ? above + t : H,
          bottom: below ?? 0,
          panelAbove: fi === 0 || above !== undefined,
          panelBelow: fi + 1 === fronts.length || below !== undefined,
        });
        continue;
      }
      if (f.type === "panel") {
        add("blind_panel", fi + 1, { x: gl, y: f.y0, z: D, dx: W - gl - gr, dy: h, dz: tFront }, "y", "x", "material.front", all);
        continue;
      }
      if (f.type === "appliance") {
        if (!f.front) continue;
        applianceNo++;
        add("appliance_front", applianceNo, { x: gl, y: f.y0, z: D, dx: W - gl - gr, dy: h, dz: tFront }, "y", "x", "material.front", all);
        applianceFronts.push({ code: `${ROLE_CODES.appliance_front}${applianceNo}`, hinge: opt<"left" | "right">("door_hinge_side") });
        continue;
      }
      if (f.type === "door") {
        const n = f.doors;
        // Blind corner: a fixed panel covers the blind side, doors the rest.
        const corner = opt<"none" | "blind_left" | "blind_right">("corner");
        let x0 = gl;
        let x1 = W - gr;
        if (corner !== "none") {
          const bw = num("blind_w");
          if (bw > W - num("door_min_w")) {
            diagnostics.push({ severity: "error", code: "blind_too_wide", params: { blind: bw, width: W }, cabinet: cab });
          }
          // The door next to the blind panel would hinge on it: there is no carcase side to carry its hinges.
          if (n > 1) diagnostics.push({ severity: "error", code: "blind_corner_two_doors", params: { doors: n }, cabinet: cab });
          const split = corner === "blind_right" ? W - bw : bw;
          const panel = corner === "blind_right" ? { x: split + gap / 2, dx: W - gr - split - gap / 2 } : { x: gl, dx: split - gap / 2 - gl };
          add("blind_panel", fronts.indexOf(f) + 1, { x: panel.x, y: f.y0, z: D, dx: panel.dx, dy: h, dz: tFront }, "y", "x", "material.front", all);
          if (corner === "blind_right") x1 = split - gap / 2;
          else x0 = split + gap / 2;
        }
        const doorW = (x1 - x0 - (n - 1) * gap) / n;
        for (let i = 1; i <= n; i++) {
          doorNo++;
          const x = x0 + (i - 1) * (doorW + gap);
          add("door", doorNo, { x, y: f.y0, z: D, dx: doorW, dy: h, dz: tFront }, "y", "x", "material.front", all);
          // One door: hinge side from the option (corner units: away from the blind side).
          // Two doors: hinged outwards.
          const single = corner === "blind_right" ? "left" : corner === "blind_left" ? "right" : (f.hinge ?? opt<"left" | "right">("door_hinge_side"));
          const hinge = n === 1 ? single : i === 1 ? "left" : "right";
          doors.push({ code: `${ROLE_CODES.door}${doorNo}`, hinge });
        }
      } else {
        drawerNo++;
        if (opt<string>("corner") !== "none" && drawerNo === 1) {
          diagnostics.push({ severity: "warning", code: "corner_with_drawers", params: {}, cabinet: cab });
        }
        add("drawer_front", drawerNo, { x: gl, y: f.y0, z: D, dx: W - gl - gr, dy: h, dz: tFront }, "x", "y", "material.front", all);
        // A drawer beside an upright bottom rail ends in front of it.
        const rear = rb === "upright" && drawerBounds(fi).floor < interiorBottom ? backFrontZ + t : backFrontZ;
        const d = buildDrawer(rc, library, drawerNo, f, { W, H, D, t, backFrontZ: rear, ...drawerBounds(fi) }, add, diagnostics);
        if (d) drawers.push(d);
      }
    }
  }

  // --- Ceiling filler (Passblende, D44) -----------------------------------------------
  // Flush with the fronts, one horizontal gap above the top front, up to the
  // ceiling line minus ceiling_filler_gap; cut to the slope where the ceiling slopes.
  if (opt<string>("ceiling_filler") === "front") {
    const gl = num("front_gap_left");
    const gr = num("front_gap_right");
    const baseY = rc.cabinet.kind === "wall" ? num("wall_bottom") : num("plinth_h");
    const y0 = H - num("front_gap_top") + num("front_gap");
    const line = context.ceiling?.front ?? [[0, num("ceiling_h")], [W, num("ceiling_h")]];
    const hAt = (x: number): number => {
      for (let k = 0; k + 1 < line.length; k++) {
        const [xa, ha] = line[k]!;
        const [xb, hb] = line[k + 1]!;
        if (x >= xa - 1e-9 && x <= xb + 1e-9) return xb - xa < 1e-9 ? ha : ha + ((hb - ha) * (x - xa)) / (xb - xa);
      }
      return line[line.length - 1]![1];
    };
    const top = (x: number): number => hAt(x) - baseY - num("ceiling_filler_gap");
    const xs = [gl, ...line.map(([x]) => x).filter((x) => x > gl + 1e-6 && x < W - gr - 1e-6), W - gr];
    const heights = xs.map((x) => roundMm(top(x) - y0));
    const hMax = Math.max(...heights);
    if (Math.min(...heights) < num("ceiling_filler_min")) {
      diagnostics.push({ severity: "warning", code: "ceiling_filler_too_low", params: { h: roundMm(Math.min(...heights)) }, cabinet: cab });
    } else {
      add("ceiling_filler", undefined, { x: gl, y: y0, z: D, dx: W - gl - gr, dy: hMax, dz: tFront }, "x", "y", "material.front", {
        l1: edgeFront,
        l2: edgeFront,
        w1: edgeFront,
        w2: edgeFront,
      });
      const pb = parts[parts.length - 1]!;
      // Outline in part-local (u along X from gl, v up from y0), counter-clockwise.
      if (heights.some((h) => Math.abs(h - hMax) > 0.01)) {
        pb.outline = [[0, 0], [roundMm(W - gl - gr), 0], ...xs.map((x, k) => [roundMm(x - gl), heights[k]!] as [number, number]).reverse()];
      }
    }
  }

  // --- Free parts (D45), then the parts left out ------------------------------------
  const custom = buildCustomParts({ rc, library, scope: zoneVars, add, parts, diagnostics });
  assignSurfaces(rc, library, parts, context, diagnostics);
  const omit = new Set(cons?.omit ?? []);
  for (const code of omit) {
    if (!parts.some((p) => p.code === code)) diagnostics.push({ severity: "warning", code: "construction_omit_unknown", params: { code }, cabinet: cab });
  }
  if (omit.size) {
    const kept = parts.filter((p) => !omit.has(p.code));
    parts.length = 0;
    parts.push(...kept);
  }
  const has = (code: string): boolean => !omit.has(code);

  // Part overrides that point at parts this cabinet does not have.
  const codes = new Set([...parts.map((p) => p.code), ...omit]);
  for (const code of Object.keys(rc.cabinet.parts)) {
    if (!codes.has(code)) {
      diagnostics.push({ severity: "warning", code: "part_override_unused", params: { code }, cabinet: cab });
    }
  }

  return {
    parts,
    diagnostics,
    layout: { backFrontZ, carcaseZ0, innerBottomY: t, innerTopY: H - t,
      doors: doors.filter((d) => has(d.code)),
      drawers: drawers.filter((d) => has(`${ROLE_CODES.drawer_front}${d.index}`)),
      applianceFronts: applianceFronts.filter((d) => has(d.code)),
      flaps: flaps.filter((d) => has(d.code)),
      rails, custom,
      zones: fronts.map((f, i) => ({ type: f.type, y0: f.y0, y1: f.y1, fixedBelow: fixedAuto[i] ?? null })) },
  };
}
