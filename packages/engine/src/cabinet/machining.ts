import type { Diagnostic } from "../diagnostics.ts";
import { checkLimits, evaluateDrilling, evaluateItemParams } from "../hardware/evaluate.ts";
import type { HardwareItem } from "../hardware/schema.ts";
import type { Library } from "../library.ts";
import {
  addBore,
  addPocketFromBox,
  addThroughBore,
  boreWouldCollide,
  checkOperations,
  resolveOpposing,
  type Direction,
  type OpSource,
  type ThroughMode,
} from "../ops.ts";
import { roundMm, type Axis, type Part } from "../part.ts";
import type { ResolvedCabinet } from "../resolve.ts";
import { gridPositions, type BoxLayout } from "./box.ts";

/** Hardware and consumables a cabinet needs (input for the BOM later). */
export interface HardwareUse {
  item: string;
  qty: number;
  unit: string;
}

/**
 * Derives all machining for a built box: back grooves/rebates, joints via
 * the construction method, 32 mm system holes and hardware drilling, then
 * checks every part. Mutates `parts[].operations`.
 */
export function machineBox(
  rc: ResolvedCabinet,
  library: Library,
  parts: Part[],
  layout: BoxLayout,
): { diagnostics: Diagnostic[]; hardware: HardwareUse[] } {
  const diagnostics: Diagnostic[] = [];
  const cab = rc.cabinet.id;
  const at = { cabinet: cab };
  const num = (name: string): number => rc.values.get(name)!;
  const opt = <T>(key: string): T => rc.options.get(key)!.value as T;
  const byCode = new Map(parts.map((p) => [p.code, p]));
  const usage = new Map<string, HardwareUse>();
  const use = (item: HardwareItem, qty: number): void => {
    if (qty <= 0) return;
    const u = usage.get(item.id);
    if (u) u.qty += qty * item.bom.perPlacement;
    else usage.set(item.id, { item: item.id, qty: qty * item.bom.perPlacement, unit: item.bom.unit });
  };

  const W = num("W");
  const D = num("D");
  const t = num("t_carcase");

  // --- Back groove / rebate ---------------------------------------------------
  const back = byCode.get("BK");
  const backMount = opt<string>("back_mount");
  if (back && backMount !== "surface") {
    const play = num("back_play");
    const c = num("back_groove_clearance") / 2;
    const b = back.box;
    const region = {
      x0: b.x - play,
      x1: b.x + b.dx + play,
      y0: b.y - play,
      y1: b.y + b.dy + play,
      z0: b.z - c,
      z1: b.z + b.dz + c,
    };
    const source: OpSource = { kind: "back", ref: backMount };
    for (const code of ["SL", "SR", "BO", "TO"]) {
      const p = byCode.get(code);
      if (p) addPocketFromBox(p, region, source);
    }
  }

  // --- Joints (construction method) -------------------------------------------
  if (opt<string>("joint_method") === "dowel") {
    const connector = library.hardware.get(opt<string>("hardware.connector"))!;
    const params = evaluateItemParams(connector, rc.values, at);
    diagnostics.push(...params.diagnostics);
    const need = ["d", "face_depth", "edge_depth"];
    const missing = need.filter((n) => !params.values.has(n));
    if (missing.length) {
      diagnostics.push({
        severity: "error",
        code: "hardware_param_missing",
        params: { item: connector.id, params: missing.join(", ") },
        ...at,
      });
    } else {
      const dowel = {
        d: params.values.get("d")!,
        faceDepth: params.values.get("face_depth")!,
        edgeDepth: params.values.get("edge_depth")!,
      };
      for (const j of carcaseJoints(parts, opt<string>("carcase_joint"))) {
        const count = dowelJoint(j, dowel, {
          pitch: num("sys_pitch"),
          offsetFront: num("dowel_offset_front"),
          offsetRear: num("dowel_offset_rear"),
          maxSpacing: num("dowel_max_spacing"),
          minCount: num("dowel_min_count"),
          margin: num("bore_min_wall"),
        });
        if (count.placed === 0) {
          diagnostics.push({ severity: "error", code: "joint_no_dowels", params: { joint: j.ref }, ...at });
        } else if (count.placed < num("dowel_min_count")) {
          diagnostics.push({
            severity: "warning",
            code: "joint_few_dowels",
            params: { joint: j.ref, count: count.placed, min: num("dowel_min_count") },
            ...at,
          });
        }
        use(connector, count.placed);
      }
    }
  }

  // --- 32 mm system holes -------------------------------------------------------
  if (opt<string>("system_holes") === "full") {
    const pitch = num("sys_pitch");
    const zFront = D - num("sys_row_front");
    const zRearMin = layout.backFrontZ + num("sys_row_rear_min");
    const k = Math.floor((zFront - zRearMin) / pitch + 1e-9);
    const rows = k >= 1 ? [zFront, zFront - k * pitch] : [zFront];
    const ys = gridPositions(
      num("sys_grid_y0"),
      pitch,
      layout.innerBottomY + num("sys_margin"),
      layout.innerTopY - num("sys_margin"),
    );
    const source: OpSource = { kind: "system", ref: "rows" };
    for (const [code, x, dir] of [
      ["SL", t, "-x"],
      ["SR", W - t, "+x"],
    ] as const) {
      const side = byCode.get(code);
      if (!side) continue;
      for (const z of rows) {
        for (const y of ys) addBore(side, { x, y, z }, dir, num("sys_hole_d"), num("sys_hole_depth"), source);
      }
    }
  }

  // --- Hinges --------------------------------------------------------------------
  if (layout.doors.length > 0) {
    const hinge = library.hardware.get(opt<string>("hardware.hinge"))!;
    for (const door of layout.doors) {
      const part = byCode.get(door.code)!;
      const placed = placeHinges(rc, hinge, part, door.hinge, byCode, diagnostics);
      use(hinge, placed);
    }
  }

  // --- Drawer slides ------------------------------------------------------------------
  for (const [i, d] of layout.drawers.entries()) {
    const item = library.hardware.get(d.slide)!;
    const sd = item.slide!;
    if (i === 0) {
      const ctx = new Map(rc.values);
      ctx.set("LWK", W - 2 * t);
      ctx.set("NL", d.nl);
      diagnostics.push(...checkLimits(item, evaluateItemParams(item, ctx, at).values, at));
    }
    const fix = sd.fixings.find((f) => d.nl <= f.upTo) ?? sd.fixings[sd.fixings.length - 1]!;
    const source: OpSource = { kind: "hardware", ref: item.id };
    for (const [code, x, dir] of [
      ["SL", t, "-x"],
      ["SR", W - t, "+x"],
    ] as const) {
      const side = byCode.get(code);
      if (!side) continue;
      for (const a of fix.at) {
        addBore(side, { x, y: d.axisY, z: D - sd.firstFixing - a }, dir, num("sys_hole_d"), num("sys_hole_depth"), source);
      }
    }
    use(item, 1);

    // Wooden box: the bottom sits in a groove in sides, inner front and back.
    const bottom = byCode.get(`DT${d.index}`);
    if (d.box === "wood" && bottom) {
      const b = bottom.box;
      const region = { x0: b.x - 0.5, x1: b.x + b.dx + 0.5, y0: b.y - 0.25, y1: b.y + b.dy + 0.25, z0: b.z - 0.5, z1: b.z + b.dz + 0.5 };
      for (const c of ["DL", "DR", "DI", "DB"]) {
        const p = byCode.get(`${c}${d.index}`);
        if (p) addPocketFromBox(p, region, { kind: "joint", ref: `DT${d.index}` });
      }
    }
  }

  // --- Shelf supports ----------------------------------------------------------------
  const supportId = opt<string | null>("hardware.shelf_support");
  const shelves = parts.filter((p) => p.role === "shelf").length;
  if (supportId !== null && shelves > 0) {
    const support = library.hardware.get(supportId)!;
    const params = evaluateItemParams(support, rc.values, at);
    diagnostics.push(...params.diagnostics);
    use(support, shelves * (params.values.get("per_shelf") ?? 4));
    if (opt<string>("system_holes") === "none") {
      diagnostics.push({ severity: "warning", code: "shelf_supports_without_holes", params: {}, ...at });
    }
  }

  // --- Opposing holes, then checks ---------------------------------------------------
  const minWall = num("bore_min_wall");
  const opposite = opt<"both_sides" | "through" | "error">("bore.opposite");
  for (const p of parts) resolveOpposing(p, opposite, num("through_overlap"), minWall);
  for (const p of parts) diagnostics.push(...checkOperations(p, minWall));

  return { diagnostics, hardware: [...usage.values()].sort((a, b) => a.item.localeCompare(b.item)) };
}

// ---------------------------------------------------------------------------
// Joints

/**
 * A butt joint where the end/edge of one part meets the face of another.
 * Connectors run along `line` (always Z for carcase joints: front to back).
 */
interface Joint {
  ref: string;
  facePart: Part;
  edgePart: Part;
  /** Contact plane between the parts. */
  plane: { axis: Axis; value: number };
  /** Drilling direction into the face part (the edge part is drilled the opposite way). */
  intoFace: Direction;
  /** Position across the joint: centre of the edge part's thickness. */
  across: { axis: Axis; value: number };
}

function carcaseJoints(parts: Part[], jointType: string): Joint[] {
  const byCode = new Map(parts.map((p) => [p.code, p]));
  const sides = [byCode.get("SL"), byCode.get("SR")].filter((p): p is Part => !!p);
  const horizontals = ["BO", "TO", "RF", "RR"].map((c) => byCode.get(c)).filter((p): p is Part => !!p);
  const joints: Joint[] = [];
  for (const side of sides) {
    const left = side.code === "SL";
    for (const h of horizontals) {
      if (jointType === "sides_over") {
        // Side face, horizontal part's end.
        joints.push({
          ref: `${side.code}-${h.code}`,
          facePart: side,
          edgePart: h,
          plane: { axis: "x", value: left ? side.box.x + side.box.dx : side.box.x },
          intoFace: left ? "-x" : "+x",
          across: { axis: "y", value: h.box.y + h.box.dy / 2 },
        });
      } else {
        // Horizontal part's face, side's end. Bottom is below the side, top/rails above.
        const below = h.box.y + h.box.dy <= side.box.y + 1e-6;
        joints.push({
          ref: `${h.code}-${side.code}`,
          facePart: h,
          edgePart: side,
          plane: { axis: "y", value: below ? h.box.y + h.box.dy : h.box.y },
          intoFace: below ? "-y" : "+y",
          across: { axis: "x", value: side.box.x + side.box.dx / 2 },
        });
      }
    }
  }
  return joints;
}

const flip = (d: Direction): Direction => ((d[0] === "+" ? "-" : "+") + d[1]) as Direction;

/**
 * Dowel positions on the system grid along Z, measured from the front end of
 * the joint: the first at `offsetFront`, the others every `pitch` until
 * `offsetRear` from the rear end, thinned out so that consecutive dowels are
 * at most `maxSpacing` apart (and never fewer than `minCount` when possible).
 */
export function dowelPositions(
  zMin: number,
  zMax: number,
  o: { pitch: number; offsetFront: number; offsetRear: number; maxSpacing: number; minCount: number },
  /** Candidates rejected here (e.g. because they would hit a groove) are skipped. */
  free: (z: number) => boolean = () => true,
): number[] {
  const candidates: number[] = [];
  for (let z = zMax - o.offsetFront; z >= zMin + o.offsetRear - 1e-9; z -= o.pitch) {
    const zr = roundMm(z);
    if (free(zr)) candidates.push(zr);
  }
  if (candidates.length <= 2) return candidates;

  const chosen = [candidates[0]!];
  let i = 0;
  while (i < candidates.length - 1) {
    // Farthest candidate within maxSpacing of the last chosen one (at least the next).
    let j = i + 1;
    while (j + 1 < candidates.length && chosen[chosen.length - 1]! - candidates[j + 1]! <= o.maxSpacing + 1e-9) j++;
    chosen.push(candidates[j]!);
    i = j;
  }
  if (chosen.length < o.minCount) {
    const n = Math.min(o.minCount, candidates.length);
    return Array.from({ length: n }, (_, k) => candidates[Math.round((k * (candidates.length - 1)) / (n - 1))]!);
  }
  return chosen;
}

function dowelJoint(
  j: Joint,
  dowel: { d: number; faceDepth: number; edgeDepth: number },
  o: { pitch: number; offsetFront: number; offsetRear: number; maxSpacing: number; minCount: number; margin: number },
): { placed: number } {
  const zMin = Math.max(j.facePart.box.z, j.edgePart.box.z);
  const zMax = Math.min(j.facePart.box.z + j.facePart.box.dz, j.edgePart.box.z + j.edgePart.box.dz);
  const point = (z: number) => {
    const p = { x: 0, y: 0, z };
    p[j.plane.axis] = j.plane.value;
    p[j.across.axis] = j.across.value;
    return p;
  };
  const free = (z: number): boolean =>
    !boreWouldCollide(j.facePart, point(z), j.intoFace, dowel.d, dowel.faceDepth, o.margin) &&
    !boreWouldCollide(j.edgePart, point(z), flip(j.intoFace), dowel.d, dowel.edgeDepth, o.margin);
  const zs = dowelPositions(zMin, zMax, o, free);
  const source: OpSource = { kind: "joint", ref: j.ref };
  for (const z of zs) {
    const p = point(z);
    addBore(j.facePart, p, j.intoFace, dowel.d, dowel.faceDepth, source);
    addBore(j.edgePart, p, flip(j.intoFace), dowel.d, dowel.edgeDepth, source);
  }
  return { placed: zs.length };
}

// ---------------------------------------------------------------------------
// Hinges

function placeHinges(
  rc: ResolvedCabinet,
  item: HardwareItem,
  door: Part,
  side: "left" | "right",
  byCode: Map<string, Part>,
  diagnostics: Diagnostic[],
): number {
  const at = { cabinet: rc.cabinet.id };
  const sidePart = byCode.get(side === "left" ? "SL" : "SR");
  const context = new Map(rc.values);
  context.set("door_h", door.length);
  context.set("door_w", door.width);
  context.set("door_t", door.thickness);
  // How far the door covers the hinge side, measured from the side's inner
  // face to the door's hinge edge (full overlay: side thickness − side gap).
  if (sidePart) {
    context.set(
      "hinge_overlay",
      side === "left"
        ? sidePart.box.x + sidePart.box.dx - door.box.x
        : door.box.x + door.box.dx - sidePart.box.x,
    );
  }
  const params = evaluateItemParams(item, context, at);
  diagnostics.push(...params.diagnostics);
  // Placement preferences are cabinet variables; the item only supplies its
  // recommended count, used when hinge_count is 0 (auto).
  const fixedCount = rc.values.get("hinge_count")!;
  const count = fixedCount > 0 ? fixedCount : params.values.get("count");
  const endOffset = rc.values.get("hinge_end_offset")!;
  if (count === undefined) {
    if (!params.diagnostics.length) {
      diagnostics.push({
        severity: "error",
        code: "hardware_param_missing",
        params: { item: item.id, params: "count" },
        ...at,
      });
    }
    return 0;
  }
  const n = Math.max(1, Math.round(count));
  const y0 = door.box.y + endOffset;
  const y1 = door.box.y + door.box.dy - endOffset;
  let centres = n === 1 ? [(y0 + y1) / 2] : Array.from({ length: n }, (_, i) => y0 + (i * (y1 - y0)) / (n - 1));

  // Snap so the mounting plate lands on the system grid.
  const gridOffset = params.values.get("grid_offset");
  if (gridOffset !== undefined && rc.options.get("system_holes")!.value === "full") {
    const gy0 = rc.values.get("sys_grid_y0")!;
    const pitch = rc.values.get("sys_pitch")!;
    centres = centres.map((c) => gy0 + Math.round((c - gridOffset - gy0) / pitch) * pitch + gridOffset);
  }

  diagnostics.push(...checkLimits(item, params.values, { ...at, part: door.id }));
  const source: OpSource = { kind: "hardware", ref: item.id };
  centres.forEach((yc, i) => {
    const scope = new Map(params.values);
    scope.set("hinge_y", yc);
    scope.set("hinge_index", i + 1);
    const { drills, diagnostics: dd } = evaluateDrilling(item, scope, at);
    diagnostics.push(...dd);
    for (const dr of drills) {
      const y = yc + dr.a;
      if (dr.mount === "door") {
        const x = side === "left" ? door.box.x + dr.b : door.box.x + door.box.dx - dr.b;
        if (dr.through) {
          addThroughBore(door, { x, y, z: door.box.z }, "+z", dr.d, rc.options.get("bore.through")!.value as ThroughMode, rc.values.get("through_overlap")!, source);
        } else {
          addBore(door, { x, y, z: door.box.z }, "+z", dr.d, dr.depth, source);
        }
      } else if (dr.mount === "side") {
        if (!sidePart) continue;
        const left = side === "left";
        const x = left ? sidePart.box.x + sidePart.box.dx : sidePart.box.x;
        const z = sidePart.box.z + sidePart.box.dz - dr.b;
        if (dr.through) {
          addThroughBore(sidePart, { x, y, z }, left ? "-x" : "+x", dr.d, rc.options.get("bore.through")!.value as ThroughMode, rc.values.get("through_overlap")!, source);
        } else {
          addBore(sidePart, { x, y, z }, left ? "-x" : "+x", dr.d, dr.depth, source);
        }
      } else {
        diagnostics.push({
          severity: "error",
          code: "hardware_unknown_mount",
          params: { item: item.id, mount: dr.mount, category: item.category },
          ...at,
        });
      }
    }
  });
  return centres.length;
}
