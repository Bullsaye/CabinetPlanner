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

/** Where a handle or knob sits (for 3D and drawings): holes on the outer face, cabinet coordinates. */
export interface HandlePlacement {
  item: string;
  part: string;
  points: { x: number; y: number; z: number }[];
  /** Display sizes from the item (mm): bar length and Ø, knob size, standoff. */
  length?: number;
  barD?: number;
  size?: number;
  standoff?: number;
}

/** Hardware and consumables a cabinet needs (input for the BOM later). */
export interface HardwareUse {
  item: string;
  qty: number;
  unit: string;
  /** Cut lengths for items cut to size (wardrobe rails), mm. */
  lengths?: number[];
}

/**
 * Fittings shown in 3D (cabinet coordinates): a rail from (x, y, z) along +X
 * with `length`, or a leg standing under (x, y, z) with height `h`.
 */
export interface Fitting {
  kind: "rail" | "leg";
  item: string;
  x: number;
  y: number;
  z: number;
  d: number;
  length?: number;
  h?: number;
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
): { diagnostics: Diagnostic[]; hardware: HardwareUse[]; handles: HandlePlacement[]; fittings: Fitting[] } {
  const diagnostics: Diagnostic[] = [];
  const cab = rc.cabinet.id;
  const at = { cabinet: cab };
  const num = (name: string): number => rc.values.get(name)!;
  const opt = <T>(key: string): T => rc.options.get(key)!.value as T;
  const byCode = new Map(parts.map((p) => [p.code, p]));
  const usage = new Map<string, HardwareUse>();
  const handles: HandlePlacement[] = [];
  const fittings: Fitting[] = [];
  const use = (item: HardwareItem, qty: number, length?: number): void => {
    if (qty <= 0) return;
    let u = usage.get(item.id);
    if (u) u.qty += qty * item.bom.perPlacement;
    else usage.set(item.id, (u = { item: item.id, qty: qty * item.bom.perPlacement, unit: item.bom.unit }));
    if (length !== undefined) (u.lengths ??= []).push(roundMm(length));
  };
  // Vertical panels (sides, middle panels) whose face lies in the plane x.
  const verticalAt = (x: number): { part: Part; dir: Direction } | undefined => {
    for (const p of parts) {
      if (p.role !== "side_left" && p.role !== "side_right" && p.role !== "partition") continue;
      if (Math.abs(p.box.x + p.box.dx - x) < 0.01) return { part: p, dir: "-x" };
      if (Math.abs(p.box.x - x) < 0.01) return { part: p, dir: "+x" };
    }
    return undefined;
  };
  const fixedShelves = parts.filter((p) => p.role === "fixed_shelf");

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
    // Back behind the horizontals: grooves/rebates only in the sides, full height.
    const behind = opt<string>("back_extent") === "behind_horizontals";
    for (const code of behind ? ["SL", "SR"] : ["SL", "SR", "BO", "TO"]) {
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
          ...(opt<string>("dowel_pattern") === "sequence" ? { sequence: { second: num("dowel_second"), spacing: num("dowel_raster") } } : {}),
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
    const faces: [Part | undefined, number, Direction][] = [
      [byCode.get("SL"), t, "-x"],
      [byCode.get("SR"), W - t, "+x"],
    ];
    // Middle panels carry rows on both faces (opposing holes resolved below).
    for (const mp of parts.filter((p) => p.role === "partition")) {
      faces.push([mp, mp.box.x, "+x"], [mp, mp.box.x + mp.box.dx, "-x"]);
    }
    for (const [side, x, dir] of faces) {
      if (!side) continue;
      for (const z of rows) {
        if (z < side.box.z || z > side.box.z + side.box.dz) continue;
        const r = num("sys_hole_d") / 2 + num("bore_min_wall");
        for (const y of ys) {
          // No holes behind the end of a fixed shelf: it would cover them and meet its dowels.
          const covered = fixedShelves.some(
            (fs) =>
              [side.box.x, side.box.x + side.box.dx].some((fx) => Math.abs(fs.box.x - fx) < 0.01 || Math.abs(fs.box.x + fs.box.dx - fx) < 0.01) &&
              y > fs.box.y - r &&
              y < fs.box.y + fs.box.dy + r,
          );
          if (!covered) addBore(side, { x, y, z }, dir, num("sys_hole_d"), num("sys_hole_depth"), source);
        }
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

  // --- Handles and knobs ------------------------------------------------------------
  const handleId = opt<string | null>("hardware.handle");
  if (handleId !== null) {
    const item = library.hardware.get(handleId)!;
    const params = evaluateItemParams(item, rc.values, at);
    diagnostics.push(...params.diagnostics);
    const cc = params.values.get("cc") ?? 0;
    const hd = params.values.get("hole_d") ?? 5;
    const mode = opt<ThroughMode>("bore.through");
    const overlap = num("through_overlap");
    const source: OpSource = { kind: "hardware", ref: item.id };
    const drill = (part: Part, pts: { x: number; y: number }[]): void => {
      const z = part.box.z + part.box.dz;
      for (const p of pts) addThroughBore(part, { x: p.x, y: p.y, z }, "-z", hd, mode, overlap, source);
      const pv = (n: string): number | undefined => params.values.get(n);
      handles.push({
        item: item.id,
        part: part.id,
        points: pts.map((p) => ({ x: roundMm(p.x), y: roundMm(p.y), z: roundMm(z) })),
        ...(pv("length") !== undefined ? { length: pv("length")! } : {}),
        ...(pv("bar_d") !== undefined ? { barD: pv("bar_d")! } : {}),
        ...(pv("size") !== undefined ? { size: pv("size")! } : {}),
        ...(pv("standoff") !== undefined ? { standoff: pv("standoff")! } : {}),
      });
      use(item, 1);
    };
    const wall = rc.cabinet.kind === "wall";
    const edgeOff = num("handle_edge_offset");
    const endOff = num("handle_end_offset");
    for (const d of [...layout.doors, ...layout.applianceFronts]) {
      const p = byCode.get(d.code)!;
      const b = p.box;
      // Opening edge is opposite the hinges; wall units get the handle low, others high.
      const xOpen = d.hinge === "left" ? b.x + b.dx - edgeOff : b.x + edgeOff;
      const yEnd = wall ? b.y + endOff : b.y + b.dy - endOff;
      if (cc === 0) drill(p, [{ x: xOpen, y: yEnd }]);
      else if (opt<string>("handle.door") === "vertical") {
        drill(p, wall ? [{ x: xOpen, y: yEnd }, { x: xOpen, y: yEnd + cc }] : [{ x: xOpen, y: yEnd - cc }, { x: xOpen, y: yEnd }]);
      } else {
        const inward = d.hinge === "left" ? -1 : 1;
        drill(p, [{ x: xOpen, y: yEnd }, { x: xOpen + inward * cc, y: yEnd }]);
      }
    }
    for (const p of parts.filter((x) => x.role === "drawer_front")) {
      const b = p.box;
      const y = opt<string>("handle.drawer") === "top" ? b.y + b.dy - num("handle_drawer_top") : b.y + b.dy / 2;
      const xc = b.x + b.dx / 2;
      drill(p, cc === 0 ? [{ x: xc, y }] : [{ x: xc - cc / 2, y }, { x: xc + cc / 2, y }]);
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

    // Drawer front fixing: the system's own holes in the back of the front,
    // or (wooden drawers) screws through the inner front.
    const df = byCode.get(`DF${d.index}`);
    if (df && sd.frontFixing) {
      const ff = sd.frontFixing;
      const yb = d.axisY - sd.axisToBox;
      const src: OpSource = { kind: "hardware", ref: `${item.id}:front` };
      for (const x of [t + ff.fromSide, W - t - ff.fromSide]) {
        for (const r of ff.rows) addBore(df, { x, y: yb + ff.fromBox + r, z: df.box.z }, "+z", ff.d, ff.depth, src);
      }
    } else if (d.box === "wood" && opt<string>("drawer_front.fixing") === "screws") {
      const inner = byCode.get(`DI${d.index}`);
      if (inner) {
        const b = inner.box;
        const s = num("front_screw_side");
        const e = num("front_screw_edge");
        const src: OpSource = { kind: "joint", ref: `DI${d.index}-DF${d.index}` };
        for (const x of [b.x + s, b.x + b.dx - s]) {
          for (const y of [b.y + e, b.y + b.dy - e]) {
            addThroughBore(inner, { x, y, z: b.z }, "+z", num("front_screw_d"), "one_side", 0, src);
          }
        }
      }
    }

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

  // --- Wardrobe rails: cut to the clear width, end supports screwed to the section's panels ---
  if (layout.rails.length) {
    const item = library.hardware.get(opt<string>("hardware.rail"))!;
    const source: OpSource = { kind: "hardware", ref: item.id };
    for (const r of layout.rails) {
      const ctx = new Map(rc.values);
      ctx.set("LS", r.x1 - r.x0);
      const params = evaluateItemParams(item, ctx, at);
      diagnostics.push(...params.diagnostics);
      const length = params.values.get("length") ?? r.x1 - r.x0;
      const { drills, diagnostics: dd } = evaluateDrilling(item, params.values, at);
      diagnostics.push(...dd);
      for (const x of [r.x0, r.x1]) {
        const v = verticalAt(x);
        if (!v) continue;
        for (const dr of drills) {
          if (dr.mount !== "end") {
            diagnostics.push({ severity: "error", code: "hardware_unknown_mount", params: { item: item.id, mount: dr.mount, category: item.category }, ...at });
            continue;
          }
          addBore(v.part, { x, y: r.y + dr.b, z: r.z + dr.a }, v.dir, dr.d, dr.depth, source);
        }
      }
      use(item, 1, length);
      fittings.push({ kind: "rail", item: item.id, x: roundMm((r.x0 + r.x1 - length) / 2), y: r.y, z: r.z, d: params.values.get("d") ?? 25, length: roundMm(length) });
    }
  }

  // --- Adjustable legs under floor units with a plinth -------------------------------------
  const legId = opt<string | null>("hardware.leg");
  const bottom = byCode.get("BO");
  if (legId !== null && rc.cabinet.kind !== "wall" && num("plinth_h") > 0 && bottom) {
    const item = library.hardware.get(legId)!;
    const params = evaluateItemParams(item, rc.values, at);
    diagnostics.push(...params.diagnostics);
    diagnostics.push(...checkLimits(item, params.values, at));
    const { drills, diagnostics: dd } = evaluateDrilling(item, params.values, at);
    diagnostics.push(...dd);
    const spread = (a: number, b: number): number[] => {
      const n = Math.max(2, Math.ceil((b - a) / num("leg_max_spacing") - 1e-9) + 1);
      return Array.from({ length: n }, (_, i) => roundMm(a + ((b - a) * i) / (n - 1)));
    };
    const xs = spread(num("leg_inset_side"), W - num("leg_inset_side"));
    const zs = spread(layout.backFrontZ + num("leg_inset_rear"), D - num("leg_inset_front"));
    const source: OpSource = { kind: "hardware", ref: item.id };
    const minWall = num("bore_min_wall");
    const fits = (x: number, z: number): boolean =>
      drills.every((dr) => dr.mount !== "bottom" || !boreWouldCollide(bottom, { x: x + dr.a, y: bottom.box.y, z: z + dr.b }, "+y", dr.d, dr.depth, minWall));
    for (const x0 of xs) {
      for (const z of zs) {
        // A leg that meets other machining (middle panel dowels) moves sideways in pitch steps.
        let x = x0;
        for (let k = 1; k <= 4 && !fits(x, z); k++) {
          const step = k * num("sys_pitch");
          x = fits(x0 - step, z) ? x0 - step : x0 + step;
        }
        if (!fits(x, z)) x = x0;
        for (const dr of drills) {
          if (dr.mount !== "bottom") {
            diagnostics.push({ severity: "error", code: "hardware_unknown_mount", params: { item: item.id, mount: dr.mount, category: item.category }, ...at });
            continue;
          }
          addBore(bottom, { x: x + dr.a, y: bottom.box.y, z: z + dr.b }, "+y", dr.d, dr.depth, source);
        }
        fittings.push({ kind: "leg", item: item.id, x, y: 0, z, d: params.values.get("d") ?? 40, h: num("plinth_h") });
      }
    }
    use(item, xs.length * zs.length);
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

  return { diagnostics, hardware: [...usage.values()].sort((a, b) => a.item.localeCompare(b.item)), handles, fittings };
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
  // Fixed shelves sit between sides and middle panels whatever the carcase joint.
  for (const fs of parts.filter((p) => p.role === "fixed_shelf")) {
    for (const v of parts.filter((p) => p.role === "side_left" || p.role === "side_right" || p.role === "partition")) {
      const leftEnd = Math.abs(v.box.x + v.box.dx - fs.box.x) < 0.01;
      const rightEnd = Math.abs(v.box.x - (fs.box.x + fs.box.dx)) < 0.01;
      if (!leftEnd && !rightEnd) continue;
      joints.push({
        ref: `${v.code}-${fs.code}`,
        facePart: v,
        edgePart: fs,
        plane: { axis: "x", value: leftEnd ? fs.box.x : fs.box.x + fs.box.dx },
        intoFace: leftEnd ? "-x" : "+x",
        across: { axis: "y", value: fs.box.y + fs.box.dy / 2 },
      });
    }
  }
  // Middle panels always stand between bottom and top/rails.
  for (const mp of parts.filter((p) => p.role === "partition")) {
    for (const h of horizontals) {
      const below = h.box.y + h.box.dy <= mp.box.y + 1e-6;
      joints.push({
        ref: `${h.code}-${mp.code}`,
        facePart: h,
        edgePart: mp,
        plane: { axis: "y", value: below ? h.box.y + h.box.dy : h.box.y },
        intoFace: below ? "-y" : "+y",
        across: { axis: "x", value: mp.box.x + mp.box.dx / 2 },
      });
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
  o: {
    pitch: number;
    offsetFront: number;
    offsetRear: number;
    maxSpacing: number;
    minCount: number;
    /** Sequence pattern (D35): first at offsetFront, the next `second` behind it, then every `spacing`. */
    sequence?: { second: number; spacing: number };
  },
  /** Candidates rejected here (e.g. because they would hit a groove) are skipped. */
  free: (z: number) => boolean = () => true,
): number[] {
  if (o.sequence) return sequencePositions(zMin, zMax, o, o.sequence, free);
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

/**
 * Sequence pattern, measured from the front end: offsetFront, + second,
 * then every `spacing` while inside the joint. The rearmost raster position
 * that comes closer than offsetRear to the rear end moves forward in pitch
 * steps; it is dropped when it would come within one pitch of the dowel
 * before it. A blocked position (groove) also moves forward in pitch steps.
 */
function sequencePositions(
  zMin: number,
  zMax: number,
  o: { pitch: number; offsetFront: number; offsetRear: number },
  s: { second: number; spacing: number },
  free: (z: number) => boolean,
): number[] {
  const L = zMax - zMin;
  const raster: number[] = [o.offsetFront];
  if (s.second > 0) raster.push(o.offsetFront + s.second);
  for (let p = raster[raster.length - 1]! + s.spacing; p < L; p += s.spacing) raster.push(p);
  const out: number[] = [];
  for (let i = 0; i < raster.length; i++) {
    let p = raster[i]!;
    if (p >= L) break;
    const last = i === raster.length - 1;
    if (last) while (L - p < o.offsetRear - 1e-9) p -= o.pitch;
    else if (L - p < o.offsetRear - 1e-9) break;
    // Move off machining in the way (e.g. a groove), towards the front.
    let tries = 0;
    while (!free(roundMm(zMax - p)) && tries++ < 3) p -= o.pitch;
    if (!free(roundMm(zMax - p))) continue;
    const prev = out.length ? zMax - out[out.length - 1]! : -Infinity;
    if (p - prev < o.pitch - 1e-9) continue;
    out.push(roundMm(zMax - p));
  }
  return out;
}

function dowelJoint(
  j: Joint,
  dowel: { d: number; faceDepth: number; edgeDepth: number },
  o: Parameters<typeof dowelPositions>[2] & { margin: number },
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
