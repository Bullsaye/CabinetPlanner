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
import type { ConstructionInput, FrontZone } from "../schema.ts";
import { evaluateGraph } from "../graph.ts";
import { buildDrawer } from "./drawer.ts";
import type { CabinetContext } from "./machining.ts";

/**
 * Rule for the parametric box cabinet: two sides, bottom, top (full panel or
 * two rails), back, middle panels, adjustable shelves and a stack of
 * full-overlay fronts — across the cabinet, or per section (D46).
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
  /** Vertical panels whose inner face ends lower (sides under a slope, D47): code → top of the inner face. */
  innerTop: Record<string, number>;
  /** Doors with the side their hinges are on and the panel (side or middle panel) the hinges go into. */
  doors: { code: string; hinge: "left" | "right"; panel: string }[];
  /** Drawers: slide item, nominal length, rail screw axis height and the clear width (x0…x1) they run in. */
  drawers: { index: number; slide: string; nl: number; axisY: number; box: "wood" | "metal"; x0: number; x1: number }[];
  /** Panels fixed to an appliance door: they get a handle like a door. */
  applianceFronts: { code: string; hinge: "left" | "right" }[];
  /** Lift-up flaps (D39). */
  flaps: { code: string }[];
  /** Front zones top to bottom, and the automatic fixed shelf under each (bottom face; null: none) before construction changes. */
  zones: { type: FrontZone["type"]; y0: number; y1: number; fixedBelow: number | null }[];
  /** Wardrobe rails: clear section between x0 and x1, axis at y, z. */
  rails: { x0: number; x1: number; y: number; z: number }[];
}

export interface PlacedFront {
  type: FrontZone["type"];
  /** Appliance zones: a panel fixed to the appliance door. */
  front?: boolean;
  /** Door zones: hinge side of a single door. */
  hinge?: "left" | "right";
  doors: number;
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
  const fronts: PlacedFront[] = [];
  let top = H - gaps.top;
  zones.forEach((z, i) => {
    const h = heights[i] ?? restH;
    if (h <= 0) {
      diagnostics.push({ severity: "error", code: "fronts_too_high", params: { index: i + 1, available: roundMm(available) }, ...at });
    }
    fronts.push({
      type: z.type,
      ...(z.type === "appliance" ? { front: z.front ?? false } : {}),
      ...(z.hinge ? { hinge: z.hinge } : {}),
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
  /** Board sizes when the box is only a bounding box (parts at an angle, D47). */
  sizes?: { length: number; width: number; thickness: number },
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
    sizes?: { length: number; width: number; thickness: number },
  ): void => {
    const code = ROLE_CODES[role] + (index ?? "");
    const override = rc.cabinet.parts[code];
    const material = override?.material ?? (rc.options.get(materialKey)!.value as string);
    const finalEdges: PartEdges = { ...edges };
    if (override?.edges) {
      for (const k of ["l1", "l2", "w1", "w2"] as const) {
        const e = override.edges[k];
        if (e !== undefined) finalEdges[k] = e;
      }
    }
    const rounded: Box = {
      x: roundMm(box.x),
      y: roundMm(box.y),
      z: roundMm(box.z),
      dx: roundMm(box.dx),
      dy: roundMm(box.dy),
      dz: roundMm(box.dz),
    };
    const length = sizes ? roundMm(sizes.length) : boxSize(rounded, lengthAxis);
    const width = sizes ? roundMm(sizes.width) : boxSize(rounded, widthAxis);
    const thickness = sizes ? roundMm(sizes.thickness) : boxSize(rounded, thicknessAxis(lengthAxis, widthAxis));
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
      ...(override?.note ? { note: override.note } : {}),
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

  const sideY = joint === "sides_over" ? 0 : t;
  const sideH = joint === "sides_over" ? H : H - 2 * t;
  const hzX = joint === "sides_over" ? t : 0; // horizontal panels
  const hzW = joint === "sides_over" ? W - 2 * t : W;

  // --- Sections and middle panels (D25, D46) ---------------------------------------
  // Without `sections`, partition_count equal sections share one front stack.
  // With `sections`, every section has its own fronts and interior; their
  // count sets the middle panels.
  const secIn = rc.cabinet.sections;
  const sectioned = !!secIn && secIn.length > 0;
  let nPart = sectioned ? secIn.length - 1 : num("partition_count");
  if (sectioned) {
    const pc = rc.vars.get("partition_count");
    if (pc?.source.layer === "cabinet" && !pc.source.preset && num("partition_count") !== nPart) {
      diagnostics.push({ severity: "warning", code: "sections_partition_count", params: { count: num("partition_count"), sections: secIn.length }, cabinet: cab });
    }
    if (rc.cabinet.fronts) diagnostics.push({ severity: "warning", code: "sections_fronts_ignored", params: {}, cabinet: cab });
    if (rc.cabinet.construction?.noBack?.length) diagnostics.push({ severity: "warning", code: "sections_unsupported", params: { what: "noBack" }, cabinet: cab });
  } else if (nPart > 0 && rc.cabinet.fronts?.some((f) => f.type === "drawer")) {
    diagnostics.push({ severity: "warning", code: "partitions_with_drawers", params: { count: nPart }, cabinet: cab });
    nPart = 0;
  }
  const evalIn = (v: string | number, what: string): number | undefined => {
    const r = evaluateGraph(new Map([["__s", v]]), rc.values);
    const x = r.values.get("__s");
    if (x === undefined || r.diagnostics.length) {
      diagnostics.push({ severity: "error", code: "section_value_invalid", params: { what, expr: String(v) }, cabinet: cab });
      return undefined;
    }
    return x;
  };
  const LW = W - 2 * t - nPart * t;
  const widthIn: (number | undefined)[] = sectioned
    ? secIn.map((s, k) => (s.w === undefined ? undefined : evalIn(s.w, `section ${k + 1} w`)))
    : Array.from({ length: nPart + 1 }, () => undefined);
  {
    const fixedW = widthIn.reduce<number>((a, w) => a + (w ?? 0), 0);
    const restN = widthIn.filter((w) => w === undefined).length;
    if (restN === 0 && Math.abs(fixedW - LW) > 0.01) {
      diagnostics.push({ severity: "error", code: "sections_width_mismatch", params: { sum: roundMm(fixedW), available: roundMm(LW) }, cabinet: cab });
    }
    const restW = restN ? (LW - fixedW) / restN : 0;
    for (let k = 0; k < widthIn.length; k++) if (widthIn[k] === undefined) widthIn[k] = restW;
    if (widthIn.some((w) => w! <= 0)) {
      diagnostics.push({ severity: "error", code: "sections_too_wide", params: { available: roundMm(LW) }, cabinet: cab });
    }
  }
  const sections: [number, number][] = [];
  {
    let x = t;
    for (const w of widthIn) {
      sections.push([x, x + w!]);
      x += w! + t;
    }
  }
  // Middle panels between bottom and top (bottom and top run through), or
  // through from the bottom edge to the top edge (bottom and top split per section).
  const through = nPart > 0 && opt<string>("partition_joint") === "through";
  /** Horizontal panels: one across the carcase, or one per section between the middle panels. */
  const pieces: [number, number][] = through
    ? sections.map(([sx0, sx1], k) => [k === 0 ? hzX : sx0, k === sections.length - 1 ? hzX + hzW : sx1])
    : [[hzX, hzX + hzW]];
  const pieceNo = (k: number): number | undefined => (pieces.length > 1 ? k + 1 : undefined);

  // --- Sides, bottom and top --------------------------------------------
  // sides_over: sides run full height, bottom/top sit between them.
  // sides_between: bottom/top run full width, sides sit between them.
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
  pieces.forEach(([px0, px1], k) =>
    add("bottom", pieceNo(k), { x: px0, y: 0, z: hz0 + bsRear, dx: px1 - px0, dy: t, dz: D - bsFront - hz0 - bsRear }, "x", "z", "material.carcase", front(edgeCarcase)),
  );
  const uprightOk = (code: string): boolean => {
    if (joint === "sides_over") return true;
    diagnostics.push({ severity: "error", code: "upright_rail_needs_sides_over", params: { rail: code }, cabinet: cab });
    return false;
  };

  if (top === "full") {
    pieces.forEach(([px0, px1], k) =>
      add("top", pieceNo(k), { x: px0, y: H - t, z: hz0, dx: px1 - px0, dy: t, dz: D - hz0 }, "x", "z", "material.carcase", front(edgeCarcase)),
    );
  } else {
    // Rails: flat (in the top plane, rail_w deep) or upright (standing, rail_w high), or none.
    const railW = num("rail_w");
    const rf = opt<"flat" | "upright" | "none">("rail.front");
    const rr = opt<"flat" | "upright" | "none">("rail.rear");
    pieces.forEach(([px0, px1], k) => {
      const dx = px1 - px0;
      if (rf === "flat") add("rail_front", pieceNo(k), { x: px0, y: H - t, z: D - railW, dx, dy: t, dz: railW }, "x", "z", "material.carcase", front(edgeCarcase));
      if (rf === "upright" && uprightOk("RF")) add("rail_front", pieceNo(k), { x: px0, y: H - railW, z: D - t, dx, dy: railW, dz: t }, "x", "y", "material.carcase", front(edgeCarcase));
      if (rr === "flat") add("rail_rear", pieceNo(k), { x: px0, y: H - t, z: backFrontZ, dx, dy: t, dz: railW }, "x", "z", "material.carcase", none);
      if (rr === "upright" && uprightOk("RR")) add("rail_rear", pieceNo(k), { x: px0, y: H - railW, z: backFrontZ, dx, dy: railW, dz: t }, "x", "y", "material.carcase", none);
    });
    const depthOf = (o: string): number => (o === "flat" ? railW : o === "upright" ? t : 0);
    if (backFrontZ + depthOf(rr) > D - depthOf(rf)) {
      diagnostics.push({ severity: "error", code: "rails_overlap", params: { rail_w: railW, depth: D }, cabinet: cab });
    }
  }
  // Rear rail at the bottom (sink units): flat behind the shortened bottom, or upright.
  const rb = opt<"none" | "flat" | "upright">("rail.bottom");
  if (rb !== "none") {
    const bw = num("rail_bottom_w");
    const depth = rb === "flat" ? bw : t;
    if (depth > bsRear + 1e-6) {
      diagnostics.push({ severity: "error", code: "bottom_rail_overlap", params: { need: roundMm(depth), setback: roundMm(bsRear) }, cabinet: cab });
    }
    pieces.forEach(([px0, px1], k) => {
      if (rb === "flat") add("rail_bottom", pieceNo(k), { x: px0, y: 0, z: hz0, dx: px1 - px0, dy: t, dz: bw }, "x", "z", "material.carcase", none);
      else if (uprightOk("RB")) add("rail_bottom", pieceNo(k), { x: px0, y: 0, z: hz0, dx: px1 - px0, dy: bw, dz: t }, "x", "y", "material.carcase", none);
    });
  }

  // --- Middle panels -----------------------------------------------------------
  // In front of the back, between bottom and top; or through from bottom to
  // top edge, full depth with the back split per section into grooves in
  // its faces (grooved backs; otherwise in front of the back, D46).
  const backPerSection = through && backMount === "groove";
  if (backPerSection && 2 * num("back_groove_depth") > t - num("bore_min_wall") + 1e-6) {
    // The two backs' grooves sit opposite each other in the middle panel.
    diagnostics.push({ severity: "error", code: "back_grooves_meet", params: { depth: num("back_groove_depth"), thickness: t, wall: num("bore_min_wall") }, cabinet: cab });
  }
  if (nPart > 0) {
    const z0 = backPerSection ? carcaseZ0 : backFrontZ;
    for (let i = 1; i <= nPart; i++) {
      // Through: from the carcase bottom edge to the top edge, whatever the side joint.
      const y0 = through ? 0 : t;
      const y1 = through ? H : H - t;
      add("partition", i, { x: sections[i - 1]![1], y: y0, z: z0, dx: t, dy: y1 - y0, dz: D - num("partition_setback") - z0 }, "y", "z", "material.carcase", front(edgeCarcase));
    }
  }

  // --- Columns: a front stack over one or more sections ---------------------------------
  const gl = num("front_gap_left");
  const gr = num("front_gap_right");
  const gm = num("front_gap_middle");
  const interiorOpt = opt<"shelves" | "hanging" | "hanging_first" | "hanging_last">("interior");
  const panelLeft = (k: number): string => (k === 0 ? ROLE_CODES.side_left : `${ROLE_CODES.partition}${k}`);
  const panelRight = (k: number): string => (k === sections.length - 1 ? ROLE_CODES.side_right : `${ROLE_CODES.partition}${k + 1}`);
  interface Column {
    /** Section indices the column spans. */
    secs: number[];
    /** Clear interior and front extent in X. */
    x0: number;
    x1: number;
    fx0: number;
    fx1: number;
    zones: FrontZone[];
    doorCount: number;
    /** Section indices with a hanging rail (decided once the zones are known). */
    hangingOpt: "none" | "all" | "first" | "last";
    shelves: number;
    cons: ConstructionInput | undefined;
    hingeDefault: "left" | "right";
    leftPanel: string;
    rightPanel: string;
  }
  const doorDefault = (): FrontZone[] => (num("door_count") > 0 ? [{ type: "door" as const }] : []);
  const columns: Column[] = sectioned
    ? secIn.map((s, k) => {
        const last = k === secIn.length - 1;
        const hanging = s.interior ?? (interiorOpt === "hanging" || (interiorOpt === "hanging_first" && k === 0) || (interiorOpt === "hanging_last" && last) ? "hanging" : "shelves");
        const shelves = s.shelves === undefined ? num("shelf_count") : Math.max(0, Math.round(evalIn(s.shelves, `section ${k + 1} shelves`) ?? 0));
        const cc = rc.cabinet.construction;
        const sc = s.construction;
        return {
          secs: [k],
          x0: sections[k]![0],
          x1: sections[k]![1],
          fx0: k === 0 ? gl : sections[k]![0] - t / 2 + gm / 2,
          fx1: last ? W - gr : sections[k]![1] + t / 2 - gm / 2,
          zones: s.fronts ?? [{ type: "door" as const, doors: 1 }],
          doorCount: 1,
          hangingOpt: hanging === "hanging" ? "all" : "none",
          shelves,
          cons: cc || sc ? { panels: [...(cc?.panels ?? []), ...(sc?.panels ?? [])], fixed: { ...(cc?.fixed ?? {}), ...(sc?.fixed ?? {}) }, noBack: [] } : undefined,
          hingeDefault: k === 0 ? "left" : last ? "right" : opt<"left" | "right">("door_hinge_side"),
          leftPanel: panelLeft(k),
          rightPanel: panelRight(k),
        } satisfies Column;
      })
    : [
        {
          secs: sections.map((_, k) => k),
          x0: t,
          x1: W - t,
          fx0: gl,
          fx1: W - gr,
          zones: rc.cabinet.fronts ?? doorDefault(),
          doorCount: num("door_count"),
          hangingOpt: interiorOpt === "hanging" ? "all" : interiorOpt === "hanging_first" ? "first" : interiorOpt === "hanging_last" ? "last" : "none",
          shelves: num("shelf_count"),
          cons: rc.cabinet.construction,
          hingeDefault: opt<"left" | "right">("door_hinge_side"),
          leftPanel: ROLE_CODES.side_left,
          rightPanel: ROLE_CODES.side_right,
        },
      ];

  const noBack = new Set(sectioned ? [] : rc.cabinet.construction?.noBack ?? []);
  // A split back needs the panels it ends at to reach into its groove.
  const splitBack = noBack.size > 0;
  const backReachZ = splitBack && !backBehind && backMount !== "surface" && backMount !== "none" ? carcaseZ0 : backFrontZ;
  const between = num("front_gap");
  const fsEdges = front(edgeCarcase);
  const fsZ1 = D - num("fixed_shelf_setback");
  let fixedNo = 0;
  /** Panels the back may end at: full depth to the back (no rear setback). */
  const backStops: number[] = [];
  const fixedShelf = (x0: number, x1: number, y: number, sb = { front: 0, rear: 0 }): void => {
    const z0 = (sb.rear > 0 ? backFrontZ : backReachZ) + sb.rear;
    add("fixed_shelf", ++fixedNo, { x: x0, y, z: z0, dx: x1 - x0, dy: t, dz: fsZ1 - sb.front - z0 }, "x", "z", "material.carcase", fsEdges);
  };

  /** Per column: front stack, fixed shelves and zone ranges (phase A). */
  const laid = columns.map((col) => {
    const fz = layoutFronts(col.zones, H, { top: num("front_gap_top"), bottom: num("front_gap_bottom"), between }, col.doorCount, rc.values, { cabinet: cab });
    diagnostics.push(...fz.diagnostics);
    const fronts = fz.fronts;

    // --- Fixed shelves ------------------------------------------------------------
    // Structural shelves (dowelled like the bottom) where an appliance niche or
    // an open zone meets another zone, and between stacked door zones. Under
    // an appliance the shelf's top is the front's lower edge, above it the
    // shelf sits one gap above the front, so the niche is front height + gap.
    const fixedAt: (number | undefined)[] = []; // bottom face of the shelf under zone i
    for (let i = 0; i + 1 < fronts.length; i++) {
      const a = fronts[i]!;
      const b = fronts[i + 1]!;
      const tallUnit = rc.cabinet.kind === "tall";
      const needs =
        a.type === "appliance" ||
        b.type === "appliance" ||
        a.type === "open" ||
        b.type === "open" ||
        (a.type === "door" && b.type === "door") ||
        // Tall units close drawers off from the zone above (wardrobes).
        (tallUnit && a.type !== b.type);
      if (!needs) continue;
      const y = a.type === "appliance" ? a.y0 - t : b.type === "appliance" ? b.y1 + between : (a.y0 + b.y1) / 2 - t / 2;
      if (y < t - 1e-6 || y + t > H - t + 1e-6) {
        diagnostics.push({ severity: "error", code: "fixed_shelf_outside", params: { index: i + 1 }, cabinet: cab });
        continue;
      }
      fixedAt[i] = roundMm(y);
    }
    // --- Construction elements (D38) ------------------------------------------------
    const fixedAuto = fronts.map((_, i) => fixedAt[i] ?? null);
    const cons = col.cons;
    const zoneVars = new Map(rc.values);
    fronts.forEach((f, i) => {
      zoneVars.set(`zone${i + 1}_y0`, f.y0);
      zoneVars.set(`zone${i + 1}_y1`, f.y1);
    });
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
      if (!(i >= 0 && i < fixedAt.length) || fixedAt[i] === undefined) {
        diagnostics.push({ severity: "warning", code: "construction_fixed_unknown", params: { index: k }, cabinet: cab });
        continue;
      }
      if (!f.panel) fixedAt[i] = undefined;
      else fixedSetback.set(fixedAt[i]!, { front: cval(f.setbackFront, `fixed ${k}`), rear: cval(f.setbackRear, `fixed ${k}`) });
    }
    const extraPanels = (cons?.panels ?? []).map((pn, k) => {
      const y = roundMm(cval(pn.y, `panel ${k + 1}`));
      if (y < t - 1e-6 || y + t > H - t + 1e-6) diagnostics.push({ severity: "error", code: "construction_panel_outside", params: { index: k + 1 }, cabinet: cab });
      return { y, front: cval(pn.setbackFront, `panel ${k + 1}`), rear: cval(pn.setbackRear, `panel ${k + 1}`) };
    });
    // Clear interior of each zone: between the fixed shelves around it, or
    // the front edges (bottom / top at most). An extra panel at the zone's
    // edge (within one gap and its thickness) or inside it bounds it too (D46).
    const reach = between + t;
    const zoneRange = (i: number): [number, number] => {
      const f = fronts[i]!;
      const below = fixedAt[i];
      const above = i > 0 ? fixedAt[i - 1] : undefined;
      const mid = (f.y0 + f.y1) / 2;
      let lo = below !== undefined ? below + t : Math.max(t, f.y0);
      let hi = above !== undefined ? above : Math.min(H - t, f.y1);
      const tops = extraPanels.map((p) => p.y + t).filter((y) => y >= f.y0 - reach - 1e-6 && y <= mid);
      if (tops.length) lo = below !== undefined ? Math.max(lo, ...tops) : Math.max(...tops);
      const bots = extraPanels.map((p) => p.y).filter((y) => y <= f.y1 + reach + 1e-6 && y >= mid);
      if (bots.length) hi = above !== undefined ? Math.min(hi, ...bots) : Math.min(...bots);
      return [lo, hi];
    };
    // Drawers stop at the nearest panel below and above (fixed shelves and
    // extra panels), else at the carcase bottom and top.
    const drawerBounds = (i: number): { floor: number; ceil: number } => {
      const f = fronts[i]!;
      const mid = (f.y0 + f.y1) / 2;
      const ys = [...fixedAt.filter((y): y is number => y !== undefined), ...extraPanels.map((p) => p.y)];
      return {
        floor: Math.max(t, ...ys.filter((y) => y + t <= mid).map((y) => y + t)),
        ceil: Math.min(H - t, ...ys.filter((y) => y >= mid)),
      };
    };
    for (let i = 0; i < fixedAt.length; i++) {
      const y = fixedAt[i];
      if (y === undefined) continue;
      const sb = fixedSetback.get(y);
      for (const k of col.secs) fixedShelf(sections[k]![0], sections[k]![1], y, sb);
      if (!sb || sb.rear <= 0) backStops.push(y);
    }
    for (const pn of extraPanels) {
      for (const k of col.secs) fixedShelf(sections[k]![0], sections[k]![1], pn.y, pn);
      if (pn.rear <= 0) backStops.push(pn.y);
    }
    return { col, fronts, fixedAt, fixedAuto, zoneRange, drawerBounds };
  });

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
    // Middle panels through, full depth: one back per section (D46).
    let backNo = 0;
    const addBack = (b: Box, many: boolean): void => {
      if (!backPerSection) {
        add("back", many ? ++backNo : undefined, b, "y", "x", "material.back", none);
        return;
      }
      for (const [sx0, sx1] of sections) {
        add("back", ++backNo, { ...b, x: sx0 - engage, dx: sx1 - sx0 + 2 * engage }, "y", "x", "material.back", none);
      }
    };
    if (backMount === "none") {
      // No back (sink units): nothing to add.
    } else if (!splitBack) {
      addBack(backBox(0, topFace), false);
    } else {
      // Sections between the stops; a section keeps its back unless the zone at its middle has none.
      const { fronts, zoneRange } = laid[0]!;
      const stops = [0, ...[...new Set(backStops)].sort((a, b) => a - b), topFace];
      const zoneAt = (y: number): number => fronts.findIndex((f, i) => {
        const [lo, hi] = zoneRange(i);
        return y >= lo - 1e-6 && y <= hi + 1e-6;
      }) + 1;
      let runStart: number | undefined;
      for (let i = 0; i + 1 < stops.length; i++) {
        const mid = (stops[i]! + (i === 0 ? t : t) + stops[i + 1]!) / 2;
        const keep = !noBack.has(zoneAt(mid));
        if (keep && runStart === undefined) runStart = stops[i]!;
        const last = i + 2 === stops.length;
        if (runStart !== undefined && (!keep || last)) {
          const end = keep ? stops[i + 1]! : stops[i]!;
          if (end > runStart) addBack(backBox(runStart, end), true);
          runStart = undefined;
        }
      }
    }
  }

  // Shelves (and a wardrobe interior) live in the tallest door or open zone;
  // without fronts, in the whole interior.
  const plans = laid.map((l) => {
    const shelfZones = l.fronts
      .map((f, i) => ({ f, i, r: l.zoneRange(i) }))
      .filter((z) => z.f.type === "door" || z.f.type === "open")
      .sort((a, b) => b.r[1] - b.r[0] - (a.r[1] - a.r[0]));
    const shelfRange: [number, number] | undefined = l.fronts.length === 0 ? [t, H - t] : shelfZones[0]?.r;
    const hanging = new Set<number>();
    const secs = l.col.secs;
    if (shelfRange) {
      if (l.col.hangingOpt === "all") secs.forEach((k) => hanging.add(k));
      else if (l.col.hangingOpt === "first") hanging.add(secs[0]!);
      else if (l.col.hangingOpt === "last") hanging.add(secs[secs.length - 1]!);
    }
    return { ...l, shelfZones, shelfRange, hanging };
  });

  // --- Wardrobe interior: hat shelf and hanging rail per hanging section --------
  // Without a hat shelf (option hat_shelf off) the rail hangs rail_drop under
  // the panel that closes the zone at the top (D46).
  const rails: BoxLayout["rails"] = [];
  for (const { shelfRange, hanging } of plans) {
    if (!hanging.size || !shelfRange) continue;
    const hat = opt<boolean>("hat_shelf");
    const hatY = shelfRange[1] - num("hat_shelf_drop") - t;
    const railY = hat ? hatY - num("rail_drop") : shelfRange[1] - num("rail_drop");
    if (railY <= shelfRange[0]) {
      diagnostics.push({ severity: "error", code: "hanging_too_low", params: { space: roundMm(shelfRange[1] - shelfRange[0]) }, cabinet: cab });
      continue;
    }
    for (const k of [...hanging].sort()) {
      const [sx0, sx1] = sections[k]!;
      if (hat) fixedShelf(sx0, sx1, roundMm(hatY));
      rails.push({ x0: roundMm(sx0), x1: roundMm(sx1), y: roundMm(railY), z: roundMm((backFrontZ + D) / 2) });
    }
  }

  // --- Adjustable shelves ----------------------------------------------------
  let shelfNo = 0;
  for (const { col, fronts, fixedAt, shelfZones, shelfRange, hanging } of plans) {
    const shelfCount = col.shelves;
    if (!sectioned && shelfCount > 0 && !shelfRange && rc.vars.get("shelf_count")?.source.layer === "cabinet" && !rc.vars.get("shelf_count")?.source.preset) {
      diagnostics.push({ severity: "warning", code: "shelves_no_door_zone", params: { count: shelfCount }, cabinet: cab });
    }
    // The tallest zone gets shelf_count shelves; other door/open zones get
    // as many in proportion to their height (zones split by fixed shelves),
    // unless the zone sets its own count.
    const shelfPlan: { range: [number, number]; count: number; main: boolean; own: boolean }[] =
      fronts.length === 0
        ? shelfRange
          ? [{ range: shelfRange, count: shelfCount, main: true, own: false }]
          : []
        : shelfZones.map((z, k) => {
            const own = col.zones[z.i]?.shelves;
            return {
              range: z.r,
              count: own ?? (k === 0 ? shelfCount : Math.round((shelfCount * (z.r[1] - z.r[0])) / (shelfRange![1] - shelfRange![0]))),
              main: k === 0,
              own: own !== undefined,
            };
          });
    for (const { range, count, main, own } of shelfPlan) {
      if (count <= 0 || (!main && !own && fixedAt.every((y) => y === undefined))) continue;
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
      for (const k of col.secs) {
        const [sx0, sx1] = sections[k]!;
        if (main && hanging.has(k)) continue;
        for (let i = 1; i <= count; i++) {
          const target = innerBottom + i * pitch - tShelf / 2;
          const rest = num("shelf_pin_rest");
          const nearest = holes.length
            ? holes.reduce((a, b) => (Math.abs(b + rest - target) < Math.abs(a + rest - target) ? b : a))
            : undefined;
          const y = nearest !== undefined ? nearest + rest : target;
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
  }

  // --- Fronts: doors and drawer fronts (full overlay) ---------------------------
  // Each column's fronts span its front extent: the outer edges less the side
  // gaps, or to the middle of a middle panel less half the middle gap (D46).
  const drawers: BoxLayout["drawers"] = [];
  const applianceFronts: BoxLayout["applianceFronts"] = [];
  const flaps: BoxLayout["flaps"] = [];
  {
    const gap = gm;
    const all: PartEdges = { l1: edgeFront, l2: edgeFront, w1: edgeFront, w2: edgeFront };
    let doorNo = 0;
    let drawerNo = 0;
    let applianceNo = 0;
    let flapNo = 0;
    let blindNo = 0;
    for (const { col, fronts, drawerBounds } of laid) {
      const X0 = col.fx0;
      const X1 = col.fx1;
      for (const [fi, f] of fronts.entries()) {
        const h = f.y1 - f.y0;
        const zoneNo = sectioned ? ++blindNo : fi + 1;
        if (f.type === "open") continue;
        if (f.type === "flap") {
          if (sectioned) {
            diagnostics.push({ severity: "error", code: "sections_unsupported", params: { what: "flap" }, cabinet: cab });
            continue;
          }
          flapNo++;
          add("flap", flapNo, { x: X0, y: f.y0, z: D, dx: X1 - X0, dy: h, dz: tFront }, "x", "y", "material.front", all);
          flaps.push({ code: `${ROLE_CODES.flap}${flapNo}` });
          continue;
        }
        if (f.type === "panel") {
          add("blind_panel", zoneNo, { x: X0, y: f.y0, z: D, dx: X1 - X0, dy: h, dz: tFront }, "y", "x", "material.front", all);
          continue;
        }
        if (f.type === "appliance") {
          if (!f.front) continue;
          applianceNo++;
          add("appliance_front", applianceNo, { x: X0, y: f.y0, z: D, dx: X1 - X0, dy: h, dz: tFront }, "y", "x", "material.front", all);
          applianceFronts.push({ code: `${ROLE_CODES.appliance_front}${applianceNo}`, hinge: col.hingeDefault });
          continue;
        }
        if (f.type === "door") {
          const n = f.doors;
          // Blind corner: a fixed panel covers the blind side, doors the rest.
          const corner = opt<"none" | "blind_left" | "blind_right">("corner");
          let x0 = X0;
          let x1 = X1;
          if (corner !== "none" && sectioned) {
            if (fi === 0 && col.secs[0] === 0) diagnostics.push({ severity: "warning", code: "sections_unsupported", params: { what: "corner" }, cabinet: cab });
          } else if (corner !== "none") {
            const bw = num("blind_w");
            if (bw > W - num("door_min_w")) {
              diagnostics.push({ severity: "error", code: "blind_too_wide", params: { blind: bw, width: W }, cabinet: cab });
            }
            const split = corner === "blind_right" ? W - bw : bw;
            const panel = corner === "blind_right" ? { x: split + gap / 2, dx: W - gr - split - gap / 2 } : { x: gl, dx: split - gap / 2 - gl };
            add("blind_panel", fronts.indexOf(f) + 1, { x: panel.x, y: f.y0, z: D, dx: panel.dx, dy: h, dz: tFront }, "y", "x", "material.front", all);
            if (corner === "blind_right") x1 = split - gap / 2;
            else x0 = split + gap / 2;
          }
          const blind = sectioned ? "none" : corner;
          const doorW = (x1 - x0 - (n - 1) * gap) / n;
          for (let i = 1; i <= n; i++) {
            doorNo++;
            const x = x0 + (i - 1) * (doorW + gap);
            add("door", doorNo, { x, y: f.y0, z: D, dx: doorW, dy: h, dz: tFront }, "y", "x", "material.front", all);
            // One door: hinge side from the zone, else the section's outer side
            // (or the option); corner units: away from the blind side. Two doors: hinged outwards.
            const single = blind === "blind_right" ? "left" : blind === "blind_left" ? "right" : (f.hinge ?? col.hingeDefault);
            const hinge = n === 1 ? single : i === 1 ? "left" : "right";
            doors.push({ code: `${ROLE_CODES.door}${doorNo}`, hinge, panel: hinge === "left" ? col.leftPanel : col.rightPanel });
          }
        } else {
          drawerNo++;
          if (opt<string>("corner") !== "none" && drawerNo === 1) {
            diagnostics.push({ severity: "warning", code: "corner_with_drawers", params: {}, cabinet: cab });
          }
          add("drawer_front", drawerNo, { x: X0, y: f.y0, z: D, dx: X1 - X0, dy: h, dz: tFront }, "x", "y", "material.front", all);
          const d = buildDrawer(rc, library, drawerNo, f, { x0: col.x0, x1: col.x1, H, D, t, backFrontZ, ...drawerBounds(fi) }, add, diagnostics);
          if (d) drawers.push(d);
        }
      }
    }
  }

  // --- Sloped top corners (Schräge, D47) ---------------------------------------------
  const innerTop: Record<string, number> = {};
  for (const side of ["left", "right"] as const) {
    const drop = num(`slope_${side}_drop`);
    if (drop <= 0) continue;
    applySlope(side, drop, num(`slope_${side}_angle`));
  }
  function applySlope(side: "left" | "right", drop: number, angleDeg: number): void {
    const where = { cabinet: cab };
    const a = (angleDeg * Math.PI) / 180;
    const sn = Math.sin(a);
    const cs = Math.cos(a);
    const run = drop / Math.tan(a);
    const otherRun = (() => {
      const o = side === "left" ? "right" : "left";
      const d = num(`slope_${o}_drop`);
      return d > 0 ? d / Math.tan((num(`slope_${o}_angle`) * Math.PI) / 180) : 0;
    })();
    if (top !== "full") {
      diagnostics.push({ severity: "error", code: "slope_needs_full_top", params: {}, ...where });
      return;
    }
    if (drop > H - sideY - 2 * t - 1e-6 || run + otherRun > W - 2 * t - 1e-6) {
      diagnostics.push({ severity: "error", code: "slope_too_large", params: { side, drop: roundMm(drop), run: roundMm(run) }, ...where });
      return;
    }
    // Work as if the slope were on the right; m() mirrors X for a left slope.
    const m = (x: number): number => (side === "right" ? x : W - x);
    const pt = (x: number, y: number): [number, number] => [roundMm(m(x)), roundMm(y)];
    const ccw = (pts: [number, number][]): [number, number][] => {
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]!;
        const [bx, by] = pts[(i + 1) % pts.length]!;
        area += ax * by - bx * ay;
      }
      return area < 0 ? [...pts].reverse() : pts;
    };
    // Outer slope line: sn·x + cs·y = k; the inner face is t further in.
    const k = sn * W + cs * (H - drop);
    const P1 = { x: W - run, y: H }; // upper end (outer)
    const P2 = { x: W, y: H - drop }; // lower end at the side (outer)
    const Q1 = { x: P1.x - t * Math.tan(a / 2), y: H - t }; // mitre with the top, inner
    const Q2 = { x: W - t, y: H - drop - (t * (1 - sn)) / cs }; // mitre with the side, inner
    const bevelTop = roundMm(angleDeg / 2);
    const bevelSide = roundMm((90 - angleDeg) / 2);
    const resize = (p: Part, box: Box): void => {
      const rounded: Box = { x: roundMm(box.x), y: roundMm(box.y), z: roundMm(box.z), dx: roundMm(box.dx), dy: roundMm(box.dy), dz: roundMm(box.dz) };
      const length = boxSize(rounded, p.lengthAxis);
      const width = boxSize(rounded, p.widthAxis);
      p.cutLength = roundMm(p.cutLength + length - p.length);
      p.cutWidth = roundMm(p.cutWidth + width - p.width);
      p.length = length;
      p.width = width;
      p.box = rounded;
    };
    // Side: up to the slope's lower end, mitred.
    const sideCode = side === "right" ? ROLE_CODES.side_right : ROLE_CODES.side_left;
    const sp = parts.find((p) => p.code === sideCode)!;
    resize(sp, { ...sp.box, y: sideY, dy: P2.y - sideY });
    sp.profile = { points: ccw([pt(W - t, sideY), pt(W, sideY), pt(W, P2.y), pt(W - t, Q2.y)]) };
    // The side's length runs along Y from the bottom: its top end is w2.
    sp.bevels = { ...sp.bevels, w2: bevelSide };
    innerTop[sideCode] = roundMm(Q2.y);
    // Top (the piece reaching into the slope): up to the slope's upper end, mitred.
    const tops = parts.filter((p) => p.role === "top");
    const tp = side === "right" ? tops.reduce((a2, b) => (b.box.x > a2.box.x ? b : a2)) : tops.reduce((a2, b) => (b.box.x < a2.box.x ? b : a2));
    const tx0 = side === "right" ? tp.box.x : W - (tp.box.x + tp.box.dx); // far end, in slope coordinates
    if (Q1.x <= tx0 + 1e-6) {
      diagnostics.push({ severity: "error", code: "slope_too_large", params: { side, drop: roundMm(drop), run: roundMm(run) }, ...where });
      return;
    }
    resize(tp, side === "right" ? { ...tp.box, dx: P1.x - tp.box.x } : { ...tp.box, x: m(P1.x), dx: tp.box.x + tp.box.dx - m(P1.x) });
    tp.profile = { points: ccw([pt(tx0, H - t), pt(Q1.x, H - t), pt(P1.x, H), pt(tx0, H)]) };
    tp.bevels = { ...tp.bevels, [side === "right" ? "w2" : "w1"]: bevelTop };
    // The sloped panel: outer face from P1 to P2, mitred at both ends.
    // Its box is the board laid flat in the top plane (the frame for machining,
    // part sheets and DXF); the profile gives its real position.
    const slopeLen = drop / sn;
    const z0 = tp.box.z;
    add(
      "top_slope",
      side === "right" ? (num("slope_left_drop") > 0 ? 2 : undefined) : num("slope_right_drop") > 0 ? 1 : undefined,
      { x: side === "right" ? W - slopeLen : 0, y: H - t, z: z0, dx: slopeLen, dy: t, dz: D - z0 },
      "x",
      "z",
      "material.carcase",
      front(edgeCarcase),
    );
    const ts = parts[parts.length - 1]!;
    ts.profile = { points: ccw([pt(P1.x, P1.y), pt(Q1.x, Q1.y), pt(Q2.x, Q2.y), pt(P2.x, P2.y)]), rotated: true };
    ts.bevels = { w1: bevelTop, w2: bevelSide };
    // Back(s): cut along the slope, reaching into the slope panel's groove
    // (inner face + engage), or up to the outer face for a surface back or
    // a back behind the horizontals.
    const engage = backMount === "groove" ? num("back_groove_depth") - play : backMount === "rebate" ? num("back_rebate_depth") - play : 0;
    const limit = backMount === "surface" || backBehind ? k : k - t + engage;
    for (const bk of parts.filter((p) => p.role === "back")) {
      const b = bk.box;
      const corners: [number, number][] = [[b.x, b.y], [b.x + b.dx, b.y], [b.x + b.dx, b.y + b.dy], [b.x, b.y + b.dy]];
      const val = ([x, y]: [number, number]): number => sn * m(x) + cs * y - limit;
      if (corners.every((q) => val(q) <= 1e-6)) continue;
      // Clip the rectangle by the half-plane (Sutherland–Hodgman, one edge).
      const out: [number, number][] = [];
      const base = bk.outline
        ? bk.outline.map(([u, v]) => [b[bk.widthAxis === "x" ? "x" : "y"] + (bk.widthAxis === "x" ? v : u), b.y + (bk.widthAxis === "x" ? u : v)] as [number, number])
        : corners;
      for (let i = 0; i < base.length; i++) {
        const A = base[i]!;
        const B = base[(i + 1) % base.length]!;
        const va = val(A);
        const vb = val(B);
        if (va <= 1e-9) out.push(A);
        if ((va < -1e-9 && vb > 1e-9) || (va > 1e-9 && vb < -1e-9)) {
          const f = va / (va - vb);
          out.push([A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1])]);
        }
      }
      // Part-local (u along the back's length = Y, v along X), counter-clockwise.
      const local = out.map(([x, y]) => [roundMm(y - b.y), roundMm(x - b.x)] as [number, number]);
      bk.outline = ccw(local);
    }
    // Parts the slope would cut, and fronts reaching above it.
    const inner = k - t;
    for (const p of parts) {
      if (p === sp || p === tp || p === ts || p.role === "back" || p.role.startsWith("drawer_")) continue;
      const b = p.box;
      const xr = side === "right" ? b.x + b.dx : W - b.x; // end towards the slope, in slope coordinates
      const yt = b.y + b.dy;
      const isFront = ["door", "drawer_front", "blind_panel", "appliance_front", "flap", "ceiling_filler"].includes(p.role);
      if (isFront) {
        if (sn * xr + cs * yt > k + 1e-6) diagnostics.push({ severity: "warning", code: "slope_cuts_front", params: { part: p.id }, ...where, part: p.id });
      } else if (["side_left", "side_right", "top", "bottom", "top_slope"].includes(p.role)) {
        continue;
      } else if (sn * xr + cs * yt > inner + 1e-6) {
        diagnostics.push({ severity: "error", code: "slope_cuts_part", params: { part: p.id }, ...where, part: p.id });
      }
    }
    diagnostics.push({ severity: "warning", code: "slope_joints_manual", params: { parts: [tp.code, ts.code, sp.code].join(", ") }, ...where });
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

  // Part overrides that point at parts this cabinet does not have.
  const codes = new Set(parts.map((p) => p.code));
  for (const code of Object.keys(rc.cabinet.parts)) {
    if (!codes.has(code)) {
      diagnostics.push({ severity: "warning", code: "part_override_unused", params: { code }, cabinet: cab });
    }
  }

  return {
    parts,
    diagnostics,
    layout: { backFrontZ, carcaseZ0, innerBottomY: t, innerTopY: H - t, innerTop, doors, drawers, applianceFronts, flaps, rails,
      zones: laid[0]!.fronts.map((f, i) => ({ type: f.type, y0: f.y0, y1: f.y1, fixedBelow: laid[0]!.fixedAuto[i] ?? null })) },
  };
}
