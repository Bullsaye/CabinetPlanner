import type { Diagnostic } from "../diagnostics.ts";
import { checkLimits, evaluateDrilling, evaluateItemParams, type EvaluatedDrill } from "../hardware/evaluate.ts";
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
  type Point3,
  type ThroughMode,
} from "../ops.ts";
import { boxSize, roundMm, thicknessAxis, type Axis, type Part } from "../part.ts";
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
  /** Article chosen from the item's variants (e.g. by power factor). */
  article?: string;
}

/** What the room knows about a cabinet (D37): which carcase sides can be seen. */
export interface CabinetContext {
  visible?: { left: boolean; right: boolean };
  /** Ceiling over the cabinet (D44): lowest point, and the line along the front as (x, height above floor). */
  ceiling?: { min: number; front: [number, number][] };
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
  context: CabinetContext = {},
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
  const use = (item: HardwareItem, qty: number, length?: number, article?: string): void => {
    if (qty <= 0) return;
    const key = article ? `${item.id}|${article}` : item.id;
    let u = usage.get(key);
    if (u) u.qty += qty * item.bom.perPlacement;
    else usage.set(key, (u = { item: item.id, qty: qty * item.bom.perPlacement, unit: item.bom.unit, ...(article ? { article } : {}) }));
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
  // Every back panel (one, or several with zones left open, D38) gets its
  // groove or rebate in the carcase panels around it.
  const backMount = opt<string>("back_mount");
  if (backMount !== "surface") {
    const play = num("back_play");
    const c = num("back_groove_clearance") / 2;
    const source: OpSource = { kind: "back", ref: backMount };
    // Back behind the horizontals: grooves/rebates only in the sides, full height.
    const behind = opt<string>("back_extent") === "behind_horizontals";
    const hosts = parts.filter((p) =>
      behind
        ? p.role === "side_left" || p.role === "side_right"
        : ["side_left", "side_right", "bottom", "top", "fixed_shelf"].includes(p.role) ||
          // A flat rear rail at the bottom holds the back where the shortened bottom no longer does.
          (p.role === "rail_bottom" && thicknessAxis(p.lengthAxis, p.widthAxis) === "y"),
    );
    for (const back of parts.filter((p) => p.role === "back")) {
      const b = back.box;
      const region = { x0: b.x - play, x1: b.x + b.dx + play, y0: b.y - play, y1: b.y + b.dy + play, z0: b.z - c, z1: b.z + b.dz + c };
      for (const p of hosts) {
        // Only where the back ends in the panel, not where it passes behind it.
        const ax = thicknessAxis(p.lengthAxis, p.widthAxis);
        const lo = ax === "x" ? region.x0 : ax === "y" ? region.y0 : region.z0;
        const hi = ax === "x" ? region.x1 : ax === "y" ? region.y1 : region.z1;
        if (lo <= p.box[ax] + 1e-6 && hi >= p.box[ax] + boxSize(p.box, ax) - 1e-6) continue;
        addPocketFromBox(p, region, source);
      }
    }
  }

  // --- Middle panels are notched around upright rails (they join flat horizontals only, D41) ---
  for (const mp of parts.filter((p) => p.role === "partition")) {
    for (const r of parts.filter((p) => ["rail_front", "rail_rear", "rail_bottom"].includes(p.role) && thicknessAxis(p.lengthAxis, p.widthAxis) === "z")) {
      const b = r.box;
      addPocketFromBox(mp, { x0: mp.box.x, x1: mp.box.x + mp.box.dx, y0: b.y, y1: b.y + b.dy, z0: b.z, z1: b.z + b.dz }, { kind: "joint", ref: r.code }, { through: true });
    }
  }

  // --- Cabinet hangers (D39): rail notch in hidden sides, before the joints so dowels keep clear ---
  const hangerId = opt<string | null>("hardware.hanger");
  const hanger = hangerId !== null && rc.cabinet.kind === "wall" ? library.hardware.get(hangerId) : undefined;
  let hangerParams: ReadonlyMap<string, number> | undefined;
  if (hanger) {
    const scope = new Map(rc.values);
    scope.set("back_front_z", layout.backFrontZ);
    const params = evaluateItemParams(hanger, scope, at);
    diagnostics.push(...params.diagnostics, ...checkLimits(hanger, params.values, at));
    hangerParams = params.values;
    const nh = params.values.get("notch_h") ?? 0;
    const nd = params.values.get("notch_d") ?? 0;
    const sideOpt = (k: "left" | "right"): boolean => {
      const o = opt<string>(`side.${k}`);
      return o === "visible" ? true : o === "hidden" ? false : (context.visible?.[k] ?? false);
    };
    if (nh > 0 && nd > 0) {
      const H = num("H");
      for (const [code, k] of [["SL", "left"], ["SR", "right"]] as const) {
        const side = byCode.get(code);
        if (!side || sideOpt(k)) continue;
        const b = side.box;
        addPocketFromBox(side, { x0: b.x, x1: b.x + b.dx, y0: H - nh, y1: H + 1, z0: b.z - 1, z1: b.z + nd }, { kind: "hardware", ref: `${hanger.id}:notch` }, { through: true });
      }
      // Panels reaching into the notch zone would stop the rail.
      if (parts.some((p) => (p.role === "top" || p.role === "rail_rear") && p.box.z < layout.carcaseZ0 + nd - 1e-6)) {
        diagnostics.push({ severity: "warning", code: "hanger_rail_blocked", params: { item: hanger.id }, ...at });
      }
    }
  }

  // --- Joints (construction method, D36) -------------------------------------------
  // dowel: dowels on every joint; connector: connector items (cam, Clamex,
  // confirmat) only; connector_dowel: connectors at the front and rear
  // positions of the dowel pattern, dowels in between.
  const method = opt<string>("joint_method");
  if (method !== "none") {
    const minWall = num("bore_min_wall");
    const H = num("H");
    const base = {
      pitch: num("sys_pitch"),
      offsetFront: num("dowel_offset_front"),
      offsetRear: num("dowel_offset_rear"),
      maxSpacing: num("dowel_max_spacing"),
      minCount: num("dowel_min_count"),
      margin: minWall,
      ...(opt<string>("dowel_pattern") === "sequence" ? { sequence: { second: num("dowel_second"), spacing: num("dowel_raster") } } : {}),
    };
    // Dowel item (option hardware.connector).
    let dowel: { d: number; faceDepth: number; edgeDepth: number } | undefined;
    const dowelItem = library.hardware.get(opt<string>("hardware.connector"))!;
    if (method === "dowel" || method === "connector_dowel") {
      const params = evaluateItemParams(dowelItem, rc.values, at);
      diagnostics.push(...params.diagnostics);
      const missing = ["d", "face_depth", "edge_depth"].filter((n) => !params.values.has(n));
      if (missing.length) {
        diagnostics.push({ severity: "error", code: "hardware_param_missing", params: { item: dowelItem.id, params: missing.join(", ") }, ...at });
      } else {
        dowel = { d: params.values.get("d")!, faceDepth: params.values.get("face_depth")!, edgeDepth: params.values.get("edge_depth")! };
      }
    }
    const fastener = method === "connector" || method === "connector_dowel" ? library.hardware.get(opt<string>("hardware.fastener"))! : undefined;
    const seenLimits = new Set<string>();
    const screw = opt<string>("joint_screws") === "between_dowels" ? library.hardware.get(opt<string>("hardware.joint_screw")) : undefined;
    /** The screw's drilling for one joint (thicknesses differ per joint). */
    const screwPlan = (j: Joint): ConnectorPlan | undefined => {
      if (!screw) return undefined;
      const scope = new Map(rc.values);
      scope.set("t_edge", j.edgePart.thickness);
      scope.set("t_face", j.facePart.thickness);
      const params = evaluateItemParams(screw, scope, at);
      const { drills } = evaluateDrilling(screw, params.values, at);
      return { item: screw, drills: drills.filter((d) => d.mount === "face" || d.mount === "edge" || d.mount === "edge_face"), endMin: 0, spacingMax: Infinity };
    };

    for (const j of carcaseJoints(parts, opt<string>("carcase_joint"))) {
      // Positions along the joint line (Z for flat panels, Y for upright rails),
      // counted from its front end — the top for top rails, the bottom for bottom rails.
      const L = j.line;
      const size = (b: Part["box"]): number => (L === "x" ? b.dx : L === "y" ? b.dy : b.dz);
      const zMin = Math.max(j.facePart.box[L], j.edgePart.box[L]);
      const zMax = Math.min(j.facePart.box[L] + size(j.facePart.box), j.edgePart.box[L] + size(j.edgePart.box));
      const m = (s: number): number => (j.fromMin ? zMin + zMax - s : s);
      const point = (s: number): Point3 => {
        const p = { x: 0, y: 0, z: 0 };
        p[L] = m(s);
        p[j.plane.axis] = j.plane.value;
        p[j.across.axis] = j.across.value;
        return p;
      };
      const dowelFree = (z: number): boolean =>
        !!dowel &&
        !boreWouldCollide(j.facePart, point(z), j.intoFace, dowel.d, dowel.faceDepth, minWall) &&
        !boreWouldCollide(j.edgePart, point(z), flip(j.intoFace), dowel.d, dowel.edgeDepth, minWall);
      const placeDowel = (z: number): void => {
        const src: OpSource = { kind: "joint", ref: j.ref };
        addBore(j.facePart, point(z), j.intoFace, dowel!.d, dowel!.faceDepth, src);
        addBore(j.edgePart, point(z), flip(j.intoFace), dowel!.d, dowel!.edgeDepth, src);
      };

      // Connector drilling for this joint (panel thicknesses differ per joint).
      let conn: ConnectorPlan | undefined;
      if (fastener) {
        const scope = new Map(rc.values);
        scope.set("t_edge", j.edgePart.thickness);
        scope.set("t_face", j.facePart.thickness);
        const params = evaluateItemParams(fastener, scope, at);
        diagnostics.push(...params.diagnostics);
        for (const d of checkLimits(fastener, params.values, at)) {
          const k = JSON.stringify(d.params);
          if (!seenLimits.has(k)) diagnostics.push(d), seenLimits.add(k);
        }
        const { drills, diagnostics: dd } = evaluateDrilling(fastener, params.values, at);
        diagnostics.push(...dd);
        for (const dr of drills) {
          if (dr.mount !== "face" && dr.mount !== "edge" && dr.mount !== "edge_face") {
            diagnostics.push({ severity: "error", code: "hardware_unknown_mount", params: { item: fastener.id, mount: dr.mount, category: fastener.category }, ...at });
          }
        }
        conn = { item: fastener, drills: drills.filter((d) => d.mount === "face" || d.mount === "edge" || d.mount === "edge_face"), endMin: params.values.get("end_min") ?? 0, spacingMax: params.values.get("spacing_max") ?? Infinity };
      }
      const geo: JointGeometry = { j, W, H, D, minWall, mode: opt<ThroughMode>("bore.through"), overlap: num("through_overlap"), sgn: j.fromMin ? -1 : 1 };

      let placed = 0;
      let dowelLine: number[] = [];
      if (method === "dowel") {
        const zs = dowelPositions(zMin, zMax, base, dowelFree);
        zs.forEach(placeDowel);
        placed = zs.length;
        dowelLine = zs;
        use(dowelItem, zs.length);
      } else if (method === "connector" && conn) {
        const c = conn;
        const o = {
          ...base,
          offsetFront: Math.max(num("connector_offset_front"), c.endMin),
          offsetRear: Math.max(num("connector_offset_rear"), c.endMin),
          maxSpacing: Math.min(num("connector_max_spacing"), c.spacingMax),
          minCount: 2,
        };
        delete (o as { sequence?: unknown }).sequence;
        const zs = dowelPositions(zMin, zMax, o, (z) => connectorFits(geo, c, m(z)));
        for (const z of zs) placeConnector(geo, c, m(z));
        placed = zs.length;
        use(c.item, zs.length);
      } else if (method === "connector_dowel" && conn) {
        const c = conn;
        // The dowel pattern without the free check, then connectors at its ends.
        const zs = dowelPositions(zMin, zMax, base, (z) => dowelFree(z) || connectorFits(geo, c, m(z)));
        dowelLine = zs;
        const ends = zs.length >= 2 ? [zs[0]!, zs[zs.length - 1]!] : zs;
        for (const z of zs) {
          if (ends.includes(z) && connectorFits(geo, c, m(z))) {
            placeConnector(geo, c, m(z));
            use(c.item, 1);
          } else if (dowel && dowelFree(z)) {
            placeDowel(z);
            use(dowelItem, 1);
          } else continue;
          placed++;
        }
      }
      // Screws through the face part alongside the dowels (D41): between
      // dowels, starting between the first two, every joint_screw_every-th gap.
      if (screw && dowelLine.length >= 2) {
        const sp = screwPlan(j);
        const every = Math.max(1, Math.round(num("joint_screw_every")));
        let n = 0;
        for (let k = 0; k + 1 < dowelLine.length; k += every) {
          const mid = (dowelLine[k]! + dowelLine[k + 1]!) / 2;
          if (sp && connectorFits(geo, sp, m(mid))) {
            placeConnector(geo, sp, m(mid));
            n++;
          }
        }
        use(screw, n);
      }
      if (placed === 0) {
        diagnostics.push({ severity: "error", code: "joint_no_dowels", params: { joint: j.ref }, ...at });
      } else if (method === "dowel" && placed < num("dowel_min_count")) {
        diagnostics.push({ severity: "warning", code: "joint_few_dowels", params: { joint: j.ref, count: placed, min: num("dowel_min_count") }, ...at });
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
    for (const p of parts.filter((x) => x.role === "flap")) {
      const b = p.box;
      const xc = b.x + b.dx / 2;
      const y = b.y + num("handle_end_offset");
      drill(p, cc === 0 ? [{ x: xc, y }] : [{ x: xc - cc / 2, y }, { x: xc + cc / 2, y }]);
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

  // --- Hanger drilling: inside face of each side, `a` below the top edge, `b` in front of the back ---
  if (hanger && hangerParams) {
    const { drills, diagnostics: dd } = evaluateDrilling(hanger, hangerParams, at);
    diagnostics.push(...dd);
    const H = num("H");
    const source: OpSource = { kind: "hardware", ref: hanger.id };
    for (const [code, x, dir] of [["SL", t, "-x"], ["SR", W - t, "+x"]] as const) {
      const side = byCode.get(code);
      if (!side) continue;
      for (const dr of drills) {
        if (dr.mount !== "side") continue;
        addBore(side, { x, y: H - dr.a, z: layout.backFrontZ + dr.b }, dir, dr.d, dr.depth, source);
      }
    }
    use(hanger, 1);
  }

  // --- Lift-up flaps (D39): mechanism by power factor, drilled into both sides ---
  if (layout.flaps.length) {
    const item = library.hardware.get(opt<string>("hardware.flap"))!;
    const H = num("H");
    const source: OpSource = { kind: "hardware", ref: item.id };
    for (const f of layout.flaps) {
      const front = byCode.get(f.code)!;
      const density = library.materials.get(front.material)?.density;
      if (density === undefined) diagnostics.push({ severity: "warning", code: "material_no_density", params: { material: front.material }, ...at });
      const kg = (front.length * front.width * front.thickness * (density ?? 750)) / 1e9 + 2 * num("flap_handle_weight");
      const scope = new Map(rc.values);
      scope.set("front_kg", Math.round(kg * 100) / 100);
      scope.set("LF", Math.round(H * kg));
      scope.set("FAo", Math.max(0, front.box.y + front.box.dy - (H - t)));
      scope.set("H_in", H - 2 * t);
      scope.set("flap_top", front.box.y + front.box.dy);
      const params = evaluateItemParams(item, scope, at);
      diagnostics.push(...params.diagnostics, ...checkLimits(item, params.values, { ...at, part: front.id }));
      const { drills, diagnostics: dd } = evaluateDrilling(item, params.values, at);
      diagnostics.push(...dd);
      for (const [code, x, dir] of [["SL", t, "-x"], ["SR", W - t, "+x"]] as const) {
        const side = byCode.get(code);
        if (!side) continue;
        for (const dr of drills) {
          if (dr.mount !== "side") continue;
          addBore(side, { x, y: H - dr.a, z: D - dr.b }, dir, dr.d, dr.depth, source);
        }
      }
      // Mount "front": into the flap's inner face, `a` below its top edge, `b` from the side's inner face.
      const fy1 = front.box.y + front.box.dy;
      for (const dr of drills) {
        if (dr.mount === "side") continue;
        if (dr.mount !== "front") {
          diagnostics.push({ severity: "error", code: "hardware_unknown_mount", params: { item: item.id, mount: dr.mount, category: item.category }, ...at });
          continue;
        }
        for (const x of [t + dr.b, W - t - dr.b]) addBore(front, { x, y: fy1 - dr.a, z: front.box.z }, "+z", dr.d, dr.depth, source);
      }
      // Fittings without their own pivot hang the flap on cup hinges at its top edge (D42).
      if ((params.values.get("hinges") ?? 0) > 0) {
        const hingeItem = library.hardware.get(opt<string>("hardware.hinge"))!;
        use(hingeItem, placeFlapHinges(rc, hingeItem, front, parts, params.values.get("hinge_min_from_side") ?? 0, diagnostics));
      }
      const fits = (p: string, min?: number, max?: number): boolean => {
        const val = params.values.get(p);
        return val !== undefined && (min === undefined || val >= min) && (max === undefined || val <= max);
      };
      const v = item.variants.find((x) => fits(x.param, x.min, x.max) && x.and.every((c) => fits(c.param, c.min, c.max)));
      if (item.variants.length && !v) {
        diagnostics.push({ severity: "error", code: "hardware_no_variant", params: { item: item.id }, ...at, part: front.id });
      }
      use(item, 1, undefined, v?.code);
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
    // Rows follow the bottom when it is shortened (sink units, D41).
    const zs = spread(Math.max(layout.backFrontZ, bottom.box.z) + num("leg_inset_rear"), Math.min(D, bottom.box.z + bottom.box.dz) - num("leg_inset_front"));
    const source: OpSource = { kind: "hardware", ref: item.id };
    const minWall = num("bore_min_wall");
    // Free of other machining, and still on the bottom (a leg must not move off its end, under a side).
    const onBottom = (x: number, d: number): boolean => x - d / 2 - minWall >= bottom.box.x - 1e-6 && x + d / 2 + minWall <= bottom.box.x + bottom.box.dx + 1e-6;
    const fits = (x: number, z: number): boolean =>
      drills.every(
        (dr) =>
          dr.mount !== "bottom" ||
          (onBottom(x + dr.a, dr.d) && !boreWouldCollide(bottom, { x: x + dr.a, y: bottom.box.y, z: z + dr.b }, "+y", dr.d, dr.depth, minWall)),
      );
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
  /** Axis the connectors run along (Z for flat panels, Y for upright rails). */
  line: Axis;
  /** Count positions from the low end of the line (bottom rails), else from the high end. */
  fromMin?: boolean;
}

function carcaseJoints(parts: Part[], jointType: string): Joint[] {
  const byCode = new Map(parts.map((p) => [p.code, p]));
  const sides = [byCode.get("SL"), byCode.get("SR")].filter((p): p is Part => !!p);
  const horizontals = ["BO", "TO", "RF", "RR", "RB"].map((c) => byCode.get(c)).filter((p): p is Part => !!p);
  const upright = (p: Part): boolean => thicknessAxis(p.lengthAxis, p.widthAxis) === "z";
  const joints: Joint[] = [];
  for (const side of sides) {
    const left = side.code === "SL";
    for (const h of horizontals) {
      if (jointType === "sides_over") {
        // Side face, horizontal part's end. Upright rails: across their thickness (Z), along Y.
        const up = upright(h);
        joints.push({
          ref: `${side.code}-${h.code}`,
          facePart: side,
          edgePart: h,
          plane: { axis: "x", value: left ? side.box.x + side.box.dx : side.box.x },
          intoFace: left ? "-x" : "+x",
          across: up ? { axis: "z", value: h.box.z + h.box.dz / 2 } : { axis: "y", value: h.box.y + h.box.dy / 2 },
          line: up ? "y" : "z",
          ...(up && h.box.y < side.box.y + side.box.dy / 2 ? { fromMin: true } : {}),
        });
      } else if (!upright(h)) {
        // Horizontal part's face, side's end. Bottom is below the side, top/rails above.
        const below = h.box.y + h.box.dy <= side.box.y + 1e-6;
        joints.push({
          ref: `${h.code}-${side.code}`,
          facePart: h,
          edgePart: side,
          plane: { axis: "y", value: below ? h.box.y + h.box.dy : h.box.y },
          intoFace: below ? "-y" : "+y",
          across: { axis: "x", value: side.box.x + side.box.dx / 2 },
          line: "z",
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
        line: "z",
      });
    }
  }
  // Middle panels always stand between bottom and top/rails.
  for (const mp of parts.filter((p) => p.role === "partition")) {
    for (const h of horizontals.filter((x) => !upright(x) && x.box.z < mp.box.z + mp.box.dz && mp.box.z < x.box.z + x.box.dz)) {
      const below = h.box.y + h.box.dy <= mp.box.y + 1e-6;
      joints.push({
        ref: `${h.code}-${mp.code}`,
        facePart: h,
        edgePart: mp,
        plane: { axis: "y", value: below ? h.box.y + h.box.dy : h.box.y },
        intoFace: below ? "-y" : "+y",
        across: { axis: "x", value: mp.box.x + mp.box.dx / 2 },
        line: "z",
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

interface ConnectorPlan {
  item: HardwareItem;
  drills: EvaluatedDrill[];
  endMin: number;
  spacingMax: number;
}

interface JointGeometry {
  j: Joint;
  W: number;
  H: number;
  D: number;
  minWall: number;
  mode: ThroughMode;
  overlap: number;
  /** +1: `a` runs with the line axis (towards the front end); -1 for joints counted from the low end. */
  sgn: 1 | -1;
}

const sign = (d: Direction): 1 | -1 => (d[0] === "+" ? 1 : -1);

/**
 * Where one connector drill goes (D36): "face" into the face part from the
 * joint plane, "edge" into the edge part's end, both `b` across from the
 * edge part's mid-thickness towards its inner face; "edge_face" into the
 * edge part's inner face, `b` from the joint plane. `a` runs along the
 * joint towards the front.
 */
function connectorDrill(g: JointGeometry, dr: EvaluatedDrill, z: number): { part: Part; entry: Point3; dir: Direction } {
  const { j } = g;
  const across = j.across.axis;
  const centre = across === "x" ? g.W / 2 : across === "y" ? g.H / 2 : g.D / 2;
  const inner = centre >= j.across.value ? 1 : -1; // edge part's inner face, towards the cabinet centre
  const intoEdge = flip(j.intoFace);
  const p: Point3 = { x: 0, y: 0, z: 0 };
  p[j.line] = z + g.sgn * dr.a;
  if (dr.mount === "edge_face") {
    p[j.plane.axis] = j.plane.value + sign(intoEdge) * dr.b;
    p[across] = j.across.value + (inner * j.edgePart.box[across === "x" ? "dx" : across === "y" ? "dy" : "dz"]) / 2;
    return { part: j.edgePart, entry: p, dir: `${inner > 0 ? "-" : "+"}${across}` as Direction };
  }
  p[j.plane.axis] = j.plane.value;
  p[across] = j.across.value + inner * dr.b;
  return dr.mount === "face" ? { part: j.facePart, entry: p, dir: j.intoFace } : { part: j.edgePart, entry: p, dir: intoEdge };
}

function connectorFits(g: JointGeometry, c: ConnectorPlan, z: number): boolean {
  return c.drills.every((dr) => {
    if (dr.op === "groove") return true;
    const { part, entry, dir } = connectorDrill(g, dr, z);
    const depth = dr.through ? part.thickness : dr.depth;
    // A bore that would leave the part (e.g. too close to the end) does not fit either.
    try {
      return !boreWouldCollide(part, entry, dir, dr.d, depth, g.minWall);
    } catch {
      return false;
    }
  });
}

function placeConnector(g: JointGeometry, c: ConnectorPlan, z: number): void {
  // One group per connector: its housing, bolt hole and lever hole meet on purpose.
  const source: OpSource = { kind: "hardware", ref: c.item.id, group: `${g.j.ref}@${roundMm(z)}` };
  for (const dr of c.drills) {
    const { part, entry, dir } = connectorDrill(g, dr, z);
    if (dr.op === "groove") {
      // Slot of width d and length len, depth into the part from the joint plane.
      const lo = { ...entry };
      const hi = { ...entry };
      const ax = dir[1] as Axis;
      const across = g.j.across.axis;
      if (sign(dir) > 0) hi[ax] += dr.depth;
      else lo[ax] -= dr.depth;
      lo[across] -= dr.d / 2;
      hi[across] += dr.d / 2;
      lo[g.j.line] -= dr.len / 2;
      hi[g.j.line] += dr.len / 2;
      addPocketFromBox(part, { x0: lo.x, x1: hi.x, y0: lo.y, y1: hi.y, z0: lo.z, z1: hi.z }, source);
    } else if (dr.through) {
      addThroughBore(part, entry, dir, dr.d, g.mode, g.overlap, source);
    } else {
      addBore(part, entry, dir, dr.d, dr.depth, source);
    }
  }
}

// ---------------------------------------------------------------------------
// Hinges

/**
 * Cup hinges along a flap's top edge (D42): the hinge item's "door" drilling
 * goes into the flap (hinge edge = top edge, `a` along it), its "side"
 * drilling into the underside of the panel above (top or front rail), `b`
 * from the carcase front. Two hinges, each at least `minFromSide` and
 * hinge_end_offset from the sides' inner faces.
 */
function placeFlapHinges(rc: ResolvedCabinet, item: HardwareItem, flap: Part, parts: Part[], minFromSide: number, diagnostics: Diagnostic[]): number {
  const at = { cabinet: rc.cabinet.id };
  const num = (n: string): number => rc.values.get(n)!;
  const W = num("W");
  const H = num("H");
  const t = num("t_carcase");
  const D = num("D");
  const context = new Map(rc.values);
  context.set("door_h", flap.width);
  context.set("door_w", flap.length);
  context.set("door_t", flap.thickness);
  context.set("hinge_overlay", flap.box.y + flap.box.dy - (H - t));
  const params = evaluateItemParams(item, context, at);
  diagnostics.push(...params.diagnostics);
  const off = Math.max(minFromSide, num("hinge_end_offset"));
  const xs = [t + off, W - t - off];
  const source: OpSource = { kind: "hardware", ref: item.id };
  const fy1 = flap.box.y + flap.box.dy;
  xs.forEach((xc, i) => {
    const scope = new Map(params.values);
    scope.set("hinge_y", xc);
    scope.set("hinge_index", i + 1);
    const { drills, diagnostics: dd } = evaluateDrilling(item, scope, at);
    diagnostics.push(...dd);
    for (const dr of drills) {
      if (dr.mount === "door") {
        addBore(flap, { x: xc + dr.a, y: fy1 - dr.b, z: flap.box.z }, "+z", dr.d, dr.depth, source);
      } else if (dr.mount === "side") {
        const p = { x: xc + dr.a, y: H - t, z: D - dr.b };
        const host = parts.find(
          (q) => (q.role === "top" || q.role === "rail_front") && q.box.y + q.box.dy >= H - 1e-6 && p.z >= q.box.z && p.z <= q.box.z + q.box.dz && q.box.dy <= t + 1e-6,
        );
        if (!host) {
          diagnostics.push({ severity: "error", code: "flap_hinge_no_top", params: { item: item.id }, ...at });
          return;
        }
        addBore(host, p, "+y", dr.d, dr.depth, source);
      }
    }
  });
  return xs.length;
}

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
