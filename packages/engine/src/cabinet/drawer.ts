import type { Diagnostic } from "../diagnostics.ts";
import { evaluateItemParams } from "../hardware/evaluate.ts";
import type { Library } from "../library.ts";
import { roundMm, type PartEdges } from "../part.ts";
import type { ResolvedCabinet } from "../resolve.ts";
import type { AddPart, BoxLayout, PlacedFront } from "./box.ts";

/**
 * Builds one drawer (DECISIONS.md D24) behind a drawer front:
 * - nominal length NL: the longest the slide offers that fits the clear
 *   inside depth (back panel to front edge) minus the slide's depthExtra;
 * - rail screw axis: drawer_axis_offset above the front's lower edge, at
 *   least the slide's axisMin above the carcase bottom, raised to the next
 *   system-grid line so the rail screws use system holes;
 * - box: wooden (sides, inner front, back, bottom in a groove) sized by the
 *   slide's formulas, or metal-sided (bottom and back only).
 */
export function buildDrawer(
  rc: ResolvedCabinet,
  library: Library,
  index: number,
  front: PlacedFront,
  /** floor / ceil: top of the panel below and underside of the panel above the drawer. */
  c: { W: number; H: number; D: number; t: number; backFrontZ: number; floor: number; ceil: number },
  add: AddPart,
  diagnostics: Diagnostic[],
): BoxLayout["drawers"][number] | undefined {
  const at = { cabinet: rc.cabinet.id };
  const num = (n: string): number => rc.values.get(n)!;
  const slideId = rc.options.get("hardware.slide")!.value as string;
  const item = library.hardware.get(slideId)!;
  const slide = item.slide;
  if (!slide) {
    diagnostics.push({ severity: "error", code: "hardware_param_missing", params: { item: item.id, params: "slide" }, ...at });
    return undefined;
  }

  const insideDepth = c.D - c.backFrontZ;
  const nl = [...slide.lengths].sort((a, b) => b - a).find((l) => l + slide.depthExtra <= insideDepth + 1e-9);
  if (nl === undefined) {
    diagnostics.push({
      severity: "error",
      code: "slide_no_length",
      params: { item: item.id, depth: roundMm(insideDepth), min: Math.min(...slide.lengths) + slide.depthExtra },
      ...at,
    });
    return undefined;
  }

  // Rail screw axis: drawer_axis_offset above the front's lower edge, moved
  // down to a system-grid line, but never below the slide's minimum.
  const minAxis = c.floor + slide.axisMin;
  let axis = front.y0 + num("drawer_axis_offset");
  if (rc.options.get("system_holes")!.value === "full") {
    const y0 = num("sys_grid_y0");
    const pitch = num("sys_pitch");
    axis = y0 + Math.floor((axis - y0) / pitch + 1e-9) * pitch;
    if (axis < minAxis - 1e-9) axis = y0 + Math.ceil((minAxis - y0) / pitch - 1e-9) * pitch;
  } else {
    axis = Math.max(axis, minAxis);
  }
  // A system front fixing (hooks) must land on the front: raise the rail to
  // the next grid line if the lowest hook would come too close to the front's
  // lower edge.
  const ff = slide.frontFixing;
  if (ff) {
    const lowest = front.y0 + ff.d / 2 + num("bore_min_wall") - ff.fromBox + slide.axisToBox;
    if (axis < lowest - 1e-9) {
      if (rc.options.get("system_holes")!.value === "full") {
        const y0 = num("sys_grid_y0");
        const pitch = num("sys_pitch");
        axis = y0 + Math.ceil((lowest - y0) / pitch - 1e-9) * pitch;
      } else {
        axis = lowest;
      }
    }
  }
  axis = roundMm(axis);

  const LWK = c.W - 2 * c.t;
  const context = new Map(rc.values);
  context.set("LWK", LWK);
  context.set("NL", nl);
  const params = evaluateItemParams(item, context, at);
  diagnostics.push(...params.diagnostics);
  const p = (n: string): number | undefined => params.values.get(n);

  const clearance = num("drawer_clearance");
  const yb = axis - slide.axisToBox; // box underside
  // The box ends `clearance` below the top of its front, and inside the carcase.
  const room = Math.min(front.y1 - clearance, c.ceil - 3) - yb;
  const z1 = c.D - num("drawer_setback"); // box front
  const edgeDrawer = rc.options.get("edge.drawer")!.value as string | null;
  const top: PartEdges = { l1: null, l2: edgeDrawer, w1: null, w2: null };
  const none: PartEdges = { l1: null, l2: null, w1: null, w2: null };

  const want = front.boxH ?? num("drawer_box_h");
  const minH = num("drawer_box_min_h");
  let boxTop: number;
  if (slide.box === "wood") {
    const innerW = p("inner_w");
    const length = p("length");
    if (innerW === undefined || length === undefined) {
      diagnostics.push({ severity: "error", code: "hardware_param_missing", params: { item: item.id, params: "inner_w, length" }, ...at });
      return undefined;
    }
    const ds = num("drawer_side_t");
    // Side height: the zone's own, else drawer_box_h; 0 = as high as fits (D71).
    const fit = Math.floor(room + 1e-9);
    let hBox = fit;
    if (want > 0 && want > room + 1e-9) {
      diagnostics.push({ severity: "error", code: "drawer_box_too_high", params: { index, want, room: fit }, ...at });
    } else if (want > 0 && want < minH) {
      diagnostics.push({ severity: "error", code: "drawer_box_too_small", params: { index, want, min: minH }, ...at });
    } else if (want > 0) {
      hBox = want;
    }
    if (hBox < minH) {
      diagnostics.push({ severity: "error", code: "drawer_too_low", params: { index, front: roundMm(front.y1 - front.y0), clearance }, ...at });
      return undefined;
    }
    const outer = innerW + 2 * ds;
    const x0 = c.t + (LWK - outer) / 2;
    const z0 = z1 - length;
    const g = num("drawer_bottom_groove");
    const tb = num("drawer_bottom_t");
    add("drawer_side_left", index, { x: x0, y: yb, z: z0, dx: ds, dy: hBox, dz: length }, "z", "y", "material.drawer", top);
    add("drawer_side_right", index, { x: x0 + ds + innerW, y: yb, z: z0, dx: ds, dy: hBox, dz: length }, "z", "y", "material.drawer", top);
    add("drawer_inner", index, { x: x0 + ds, y: yb, z: z1 - ds, dx: innerW, dy: hBox, dz: ds }, "x", "y", "material.drawer", top);
    add("drawer_back", index, { x: x0 + ds, y: yb, z: z0, dx: innerW, dy: hBox, dz: ds }, "x", "y", "material.drawer", top);
    add(
      "drawer_bottom",
      index,
      { x: x0 + ds - g, y: yb + num("drawer_bottom_offset"), z: z0 + ds - g, dx: innerW + 2 * g, dy: tb, dz: length - 2 * ds + 2 * g },
      "x",
      "z",
      "material.drawer_bottom",
      none,
    );
    boxTop = yb + hBox;
  } else {
    const bw = p("bottom_w");
    const bl = p("bottom_l");
    const backW = p("back_w") ?? bw;
    if (bw === undefined || bl === undefined || backW === undefined) {
      diagnostics.push({ severity: "error", code: "hardware_param_missing", params: { item: item.id, params: "bottom_w, bottom_l" }, ...at });
      return undefined;
    }
    // Metal sides come in the slide's heights: the largest that fits, and is not above the wanted height (D71).
    const fitting = [...slide.heights].sort((a, b) => b.h - a.h).filter((h) => h.h <= room + 1e-9);
    const wanted = want > 0 ? fitting.find((h) => h.h <= want + 1e-9) : fitting[0];
    if (fitting.length && !wanted) {
      diagnostics.push({ severity: "error", code: "drawer_box_too_small", params: { index, want, min: fitting[fitting.length - 1]!.h }, ...at });
    }
    const fit = wanted ?? fitting[fitting.length - 1];
    if (!fit) {
      diagnostics.push({ severity: "error", code: "drawer_too_low", params: { index, front: roundMm(front.y1 - front.y0), clearance }, ...at });
      return undefined;
    }
    const tb = num("drawer_side_t");
    const x0 = c.t + (LWK - bw) / 2;
    add("drawer_bottom", index, { x: x0, y: yb, z: z1 - bl, dx: bw, dy: tb, dz: bl }, "x", "z", "material.drawer", none);
    add(
      "drawer_back",
      index,
      { x: c.t + (LWK - backW) / 2, y: yb + tb, z: z1 - bl, dx: backW, dy: fit.back, dz: tb },
      "x",
      "y",
      "material.drawer",
      top,
    );
    boxTop = yb + fit.h;
  }

  if (boxTop > c.ceil + 1e-6) {
    diagnostics.push({ severity: "error", code: "drawer_too_high", params: { index, over: roundMm(boxTop - c.ceil) }, ...at });
  }
  return { index, slide: item.id, nl, axisY: axis, box: slide.box };
}
