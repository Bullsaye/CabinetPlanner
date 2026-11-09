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
import { buildDrawer } from "./drawer.ts";

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
  /** Wardrobe rails: clear section between x0 and x1, axis at y, z. */
  rails: { x0: number; x1: number; y: number; z: number }[];
}

export interface PlacedFront {
  type: FrontZone["type"];
  /** Appliance zones: a panel fixed to the appliance door. */
  front?: boolean;
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
) => void;

export function buildBox(
  rc: ResolvedCabinet,
  library: Library,
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
  const backMount = opt<"groove" | "rebate" | "surface">("back_mount");
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
    backFrontZ = tBack;
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
  add("bottom", undefined, { x: hzX, y: 0, z: hz0, dx: hzW, dy: t, dz: D - hz0 }, "x", "z", "material.carcase", front(edgeCarcase));

  if (top === "full") {
    add("top", undefined, { x: hzX, y: H - t, z: hz0, dx: hzW, dy: t, dz: D - hz0 }, "x", "z", "material.carcase", front(edgeCarcase));
  } else {
    const railW = num("rail_w");
    add("rail_front", undefined, { x: hzX, y: H - t, z: D - railW, dx: hzW, dy: t, dz: railW }, "x", "z", "material.carcase", front(edgeCarcase));
    add("rail_rear", undefined, { x: hzX, y: H - t, z: backFrontZ, dx: hzW, dy: t, dz: railW }, "x", "z", "material.carcase", none);
    if (backFrontZ + railW > D - railW) {
      diagnostics.push({ severity: "error", code: "rails_overlap", params: { rail_w: railW, depth: D }, cabinet: cab });
    }
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
  for (let k = 0; k <= nPart; k++) sections.push([t + k * (sw + t), t + k * (sw + t) + sw]);
  if (nPart > 0) {
    const z0 = backFrontZ;
    for (let i = 1; i <= nPart; i++) {
      add(
        "partition",
        i,
        { x: t + i * sw + (i - 1) * t, y: t, z: z0, dx: t, dy: H - 2 * t, dz: D - num("partition_setback") - z0 },
        "y",
        "z",
        "material.carcase",
        front(edgeCarcase),
      );
    }
  }

  // --- Back ----------------------------------------------------------------
  // Inner opening between the carcase panels; the back reaches `engage` mm
  // into the surrounding panels (groove or rebate depth minus play).
  {
    let box: Box;
    if (backMount === "surface") {
      box = { x: 0, y: 0, z: 0, dx: W, dy: H, dz: tBack };
    } else {
      const engage = (backMount === "groove" ? num("back_groove_depth") : num("back_rebate_depth")) - play;
      const z = backMount === "groove" ? num("back_groove_offset") : 0;
      // Inside: into the bottom and top (or up to the top edge behind rails).
      // Behind the horizontals: the full carcase height, in the sides only.
      const y0 = backBehind ? 0 : t - engage;
      const y1 = backBehind ? H : top === "full" ? H - t + engage : H - play;
      box = { x: t - engage, y: y0, z, dx: W - 2 * t + 2 * engage, dy: y1 - y0, dz: tBack };
    }
    add("back", undefined, box, "y", "x", "material.back", none);
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
  // Structural shelves (dowelled like the bottom) where an appliance niche or
  // an open zone meets another zone, and between stacked door zones. Under
  // an appliance the shelf's top is the front's lower edge, above it the
  // shelf sits one gap above the front, so the niche is front height + gap.
  const between = num("front_gap");
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
  // Clear interior of each zone, between fixed shelves (or bottom / top).
  const zoneRange = (i: number): [number, number] => {
    const f = fronts[i]!;
    const below = fixedAt[i];
    const above = i > 0 ? fixedAt[i - 1] : undefined;
    return [below !== undefined ? below + t : Math.max(t, f.y0), above !== undefined ? above : Math.min(H - t, f.y1)];
  };
  // Drawers stop at fixed shelves, else at the carcase bottom and top.
  const drawerBounds = (i: number): { floor: number; ceil: number } => ({
    floor: fixedAt[i] !== undefined ? fixedAt[i]! + t : t,
    ceil: i > 0 && fixedAt[i - 1] !== undefined ? fixedAt[i - 1]! : H - t,
  });

  const fsEdges = front(edgeCarcase);
  const fsZ0 = backFrontZ;
  const fsZ1 = D - num("fixed_shelf_setback");
  let fixedNo = 0;
  const fixedShelf = (x0: number, x1: number, y: number): void => {
    add("fixed_shelf", ++fixedNo, { x: x0, y, z: fsZ0, dx: x1 - x0, dy: t, dz: fsZ1 - fsZ0 }, "x", "z", "material.carcase", fsEdges);
  };
  for (let i = 0; i < fixedAt.length; i++) {
    const y = fixedAt[i];
    if (y === undefined) continue;
    for (const [sx0, sx1] of sections) fixedShelf(sx0, sx1, y);
  }

  // Shelves (and a wardrobe interior) live in the tallest door or open zone;
  // without fronts, in the whole interior.
  const shelfZones = fronts
    .map((f, i) => ({ f, i, r: zoneRange(i) }))
    .filter((z) => z.f.type === "door" || z.f.type === "open")
    .sort((a, b) => b.r[1] - b.r[0] - (a.r[1] - a.r[0]));
  const shelfRange: [number, number] | undefined = fronts.length === 0 ? [t, H - t] : shelfZones[0]?.r;

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
  const shelfPlan: { range: [number, number]; count: number; main: boolean }[] =
    fronts.length === 0
      ? shelfRange
        ? [{ range: shelfRange, count: shelfCount, main: true }]
        : []
      : shelfZones.map((z, k) => ({
          range: z.r,
          count: k === 0 ? shelfCount : Math.round((shelfCount * (z.r[1] - z.r[0])) / (shelfRange![1] - shelfRange![0])),
          main: k === 0,
        }));
  let shelfNo = 0;
  for (const { range, count, main } of shelfPlan) {
    if (count <= 0 || (!main && fixedAt.every((y) => y === undefined))) continue;
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
    for (const [k, [sx0, sx1]] of sections.entries()) {
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

  // --- Fronts: doors and drawer fronts (full overlay) ---------------------------
  const drawers: BoxLayout["drawers"] = [];
  const applianceFronts: BoxLayout["applianceFronts"] = [];
  {
    // Vertical joints: left and right edge, between doors side by side (D35).
    const gl = num("front_gap_left");
    const gr = num("front_gap_right");
    const gap = num("front_gap_middle");
    const all: PartEdges = { l1: edgeFront, l2: edgeFront, w1: edgeFront, w2: edgeFront };
    let doorNo = 0;
    let drawerNo = 0;
    let applianceNo = 0;
    for (const [fi, f] of fronts.entries()) {
      const h = f.y1 - f.y0;
      if (f.type === "open") continue;
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
          const single = corner === "blind_right" ? "left" : corner === "blind_left" ? "right" : opt<"left" | "right">("door_hinge_side");
          const hinge = n === 1 ? single : i === 1 ? "left" : "right";
          doors.push({ code: `${ROLE_CODES.door}${doorNo}`, hinge });
        }
      } else {
        drawerNo++;
        if (opt<string>("corner") !== "none" && drawerNo === 1) {
          diagnostics.push({ severity: "warning", code: "corner_with_drawers", params: {}, cabinet: cab });
        }
        add("drawer_front", drawerNo, { x: gl, y: f.y0, z: D, dx: W - gl - gr, dy: h, dz: tFront }, "x", "y", "material.front", all);
        const d = buildDrawer(rc, library, drawerNo, f, { W, H, D, t, backFrontZ, ...drawerBounds(fi) }, add, diagnostics);
        if (d) drawers.push(d);
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
    layout: { backFrontZ, carcaseZ0, innerBottomY: t, innerTopY: H - t, doors, drawers, applianceFronts, rails },
  };
}
