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
  pocketWouldCollide,
  resolveOpposing,
  type Direction,
  type OpSource,
  type Point3,
  type ThroughMode,
} from "../ops.ts";
import { boxSize, roundMm, thicknessAxis, type Axis, type Part } from "../part.ts";
import type { ResolvedCabinet } from "../resolve.ts";
import { gridPositions, type BoxLayout } from "./box.ts";
import { evaluateGraph } from "../graph.ts";
import { applyCustomBores, customJoints } from "./custom.ts";

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
  /** Height of a front at cabinet x, from its bottom edge: the box, or its outline when cut to a slope (D51). */
  const frontTopAt = (p: Part, x: number): number => frontTop(p, x);

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
      // Middle panels hold a back only where they run through (backs per section, D46).
      behind
        ? ["side_left", "side_right", "partition"].includes(p.role)
        : ["side_left", "side_right", "bottom", "top", "fixed_shelf", "partition"].includes(p.role) ||
          // A flat rear rail at the bottom holds the back where the shortened bottom no longer does (D64).
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

  // Sloped panels (D47): the back's groove or rebate along the inner face,
  // in the panel's own frame (u along the slope, v along Z, w from the inner face).
  if ((backMount === "groove" || backMount === "rebate") && opt<string>("back_extent") !== "behind_horizontals" && parts.some((p) => p.role === "back")) {
    const c = num("back_groove_clearance") / 2;
    const tb = num("t_back");
    const z0 = backMount === "groove" ? num("back_groove_offset") - c : layout.carcaseZ0;
    const z1 = (backMount === "groove" ? num("back_groove_offset") : layout.carcaseZ0) + tb + c;
    const depth = backMount === "groove" ? num("back_groove_depth") : num("back_rebate_depth");
    for (const ts of parts.filter((p) => p.role === "top_slope")) {
      ts.operations.push({
        kind: "pocket",
        face: "t0",
        u0: 0,
        u1: ts.length,
        v0: roundMm(Math.max(0, z0 - ts.box.z)),
        v1: roundMm(z1 - ts.box.z),
        w0: 0,
        w1: depth,
        sources: [{ kind: "back", ref: backMount }],
      });
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
    /** Findings about item data repeat on every joint: report each once. */
    const once = (d: Diagnostic): void => {
      const k = d.code + JSON.stringify(d.params);
      if (!seenLimits.has(k)) diagnostics.push(d), seenLimits.add(k);
    };
    /** The drilling a joint can take. A hole into a panel's end cannot go through the panel (item data). */
    const jointDrills = (item: HardwareItem, drills: EvaluatedDrill[]): EvaluatedDrill[] =>
      drills.filter((dr, i) => {
        if (dr.mount !== "face" && dr.mount !== "edge" && dr.mount !== "edge_face") return false;
        if (dr.through && dr.mount === "edge") {
          once({ severity: "error", code: "hardware_drill_invalid", params: { item: item.id, index: i + 1, field: "through", detail: "edge" }, ...at });
          return false;
        }
        return true;
      });
    /** The screw's drilling for one joint (thicknesses differ per joint). */
    const screwPlan = (j: Joint): ConnectorPlan | undefined => {
      if (!screw) return undefined;
      const scope = new Map(rc.values);
      scope.set("t_edge", j.edgePart.thickness);
      scope.set("t_face", j.facePart.thickness);
      const params = evaluateItemParams(screw, scope, at);
      const { drills, diagnostics: dd } = evaluateDrilling(screw, params.values, at);
      [...params.diagnostics, ...dd].forEach(once);
      return { item: screw, drills: jointDrills(screw, drills), endMin: 0, spacingMax: Infinity };
    };

    const joints = [...carcaseJoints(parts, opt<string>("carcase_joint")), ...customJoints(parts, layout.custom)];
    /**
     * Joints meeting the same panel from its two faces at the same place
     * (bottoms either side of a middle panel through, fixed shelves at one
     * height): planned together (D55).
     */
    const opposite = new Map<Joint, Joint>();
    for (const a of joints) {
      for (const b of joints) {
        if (a === b || a.facePart !== b.facePart || a.intoFace === b.intoFace || a.line !== b.line || a.across.axis !== b.across.axis) continue;
        if (Math.abs(a.across.value - b.across.value) > a.edgePart.thickness) continue;
        opposite.set(a, b);
      }
    }
    const pairPlans = new Map<Joint, number[] | null>();
    for (const j of joints) {
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
      // Dowels from both faces of one panel (middle panels): shallow face bores,
      // (thickness − bore_min_wall) / 2, the edge bores deeper by the
      // difference, so both joints can use the same positions (D56).
      const dw = (() => {
        if (!dowel || !opposite.has(j) || opt<string>("dowel.opposite") !== "shallow") return dowel;
        const face = Math.min(dowel.faceDepth, (j.facePart.thickness - minWall) / 2);
        return { d: dowel.d, faceDepth: roundMm(face), edgeDepth: roundMm(dowel.edgeDepth + dowel.faceDepth - face) };
      })();
      const dowelFree = (z: number): boolean =>
        !!dw &&
        !boreWouldCollide(j.facePart, point(z), j.intoFace, dw.d, dw.faceDepth, minWall) &&
        !boreWouldCollide(j.edgePart, point(z), flip(j.intoFace), dw.d, dw.edgeDepth, minWall);
      const placeDowel = (z: number): void => {
        const src: OpSource = { kind: "joint", ref: j.ref };
        addBore(j.facePart, point(z), j.intoFace, dw!.d, dw!.faceDepth, src);
        addBore(j.edgePart, point(z), flip(j.intoFace), dw!.d, dw!.edgeDepth, src);
      };

      // Connector drilling for this joint (panel thicknesses differ per joint).
      const connectorPlan = (item: HardwareItem): ConnectorPlan => {
        const scope = new Map(rc.values);
        scope.set("t_edge", j.edgePart.thickness);
        scope.set("t_face", j.facePart.thickness);
        const params = evaluateItemParams(item, scope, at);
        diagnostics.push(...params.diagnostics);
        for (const d of checkLimits(item, params.values, at)) {
          const k = JSON.stringify(d.params);
          if (!seenLimits.has(k)) diagnostics.push(d), seenLimits.add(k);
        }
        const { drills, diagnostics: dd } = evaluateDrilling(item, params.values, at);
        diagnostics.push(...dd);
        for (const dr of drills) {
          if (dr.mount !== "face" && dr.mount !== "edge" && dr.mount !== "edge_face") {
            diagnostics.push({ severity: "error", code: "hardware_unknown_mount", params: { item: item.id, mount: dr.mount, category: item.category }, ...at });
          }
        }
        return { item, drills: jointDrills(item, drills), endMin: params.values.get("end_min") ?? 0, spacingMax: params.values.get("spacing_max") ?? Infinity };
      };
      // Joints on both faces of a middle panel use the connector's middle-panel
      // set where it has one (Clamex P-14 + P-10 Medius), at shared positions (D58).
      const middleItem = fastener?.middle !== undefined && opposite.has(j) ? library.hardware.get(fastener.middle) : undefined;
      if (fastener?.middle !== undefined && opposite.has(j) && !middleItem) {
        diagnostics.push({ severity: "error", code: "hardware_unknown", params: { key: `${fastener.id} middle`, value: fastener.middle }, ...at });
      }
      const conn: ConnectorPlan | undefined = fastener ? connectorPlan(middleItem ?? fastener) : undefined;
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
        // Connectors keep at least their own length along the joint apart (the grid alone allows one pitch, D64).
        const span = Math.max(0, ...c.drills.map((dr) => (dr.op === "groove" ? dr.len : dr.d))) + minWall;
        const spaced = (list: number[]): number[] => {
          const out: number[] = [];
          for (const z of list) if (out.length === 0 || out[out.length - 1]! - z >= span - 1e-9) out.push(z);
          return out;
        };
        // With a joint on the other face of the same panel: evenly spaced
        // positions shared out alternately, so each joint has one end and the
        // grooves never meet (D55). Otherwise the usual pattern.
        const partner = opposite.get(j);
        const grooveLen = Math.max(0, ...c.drills.filter((d) => d.op === "groove").map((d) => d.len));
        const paired = (): number[] | undefined => {
          if (!partner || grooveLen <= 0) return undefined;
          // Planned once for both joints, before either is placed.
          const cached = pairPlans.get(j);
          if (cached !== undefined) return cached ?? undefined;
          const pg: JointGeometry = { ...geo, j: partner, sgn: partner.fromMin ? -1 : 1 };
          const fitsBoth = (z: number): boolean => connectorFits(geo, c, m(z)) && connectorFits(pg, c, m(z));
          // Ends clear of other machining (the backs' grooves in a middle panel), in pitch steps.
          let lo = zMin + o.offsetRear;
          let hi = zMax - o.offsetFront;
          for (let k = 0; k < 10 && !fitsBoth(lo); k++) lo += o.pitch;
          for (let k = 0; k < 10 && !fitsBoth(hi); k++) hi -= o.pitch;
          let plan: { mine: number[]; theirs: number[] } | undefined;
          for (let n = Math.max(2, Math.ceil((hi - lo) / o.maxSpacing) + 1); n >= 1 && hi > lo && !plan; n--) {
            const step = (hi - lo) / (2 * n - 1);
            if (n > 1 && step < grooveLen + 2 * minWall) continue;
            const all = Array.from({ length: 2 * n }, (_, i) => roundMm(hi - i * step));
            // The joint whose ref sorts first takes the front end.
            const first = j.ref < partner.ref;
            const mine = all.filter((_, i) => (i % 2 === 0) === first);
            const theirs = all.filter((_, i) => (i % 2 === 0) !== first);
            if (all.every(fitsBoth)) plan = { mine, theirs };
          }
          pairPlans.set(j, plan?.mine ?? null);
          pairPlans.set(partner, plan?.theirs ?? null);
          return plan?.mine;
        };
        // Middle-panel set: both joints at the same positions, planned once before
        // either is placed; one set per position (counted with the first joint).
        const shared = (): number[] | undefined => {
          if (!middleItem || !partner) return undefined;
          const cached = pairPlans.get(j);
          if (cached !== undefined) return cached ?? undefined;
          const pg: JointGeometry = { ...geo, j: partner, sgn: partner.fromMin ? -1 : 1 };
          // The partner's own grooves are not there yet: check each joint against what exists.
          const zsBoth = spaced(dowelPositions(zMin, zMax, o, (z) => connectorFits(geo, c, m(z)) && connectorFits(pg, c, m(z))));
          pairPlans.set(j, zsBoth);
          pairPlans.set(partner, zsBoth);
          return zsBoth;
        };
        const sharedZs = shared();
        const zs = sharedZs ?? paired() ?? spaced(dowelPositions(zMin, zMax, o, (z) => connectorFits(geo, c, m(z))));
        for (const z of zs) placeConnector(geo, c, m(z));
        placed = zs.length;
        // A middle-panel set joins both joints at one position: count it once.
        if (!sharedZs || !partner || j.ref < partner.ref) use(c.item, zs.length);
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
  if (layout.holeRanges.length) {
    const pitch = num("sys_pitch");
    // Rows only where a section asks for them, on the faces at its ends (D52, D57).
    const wanted = (x: number, y: number): boolean =>
      layout.holeRanges.some((r) => (Math.abs(r.x0 - x) < 0.01 || Math.abs(r.x1 - x) < 0.01) && y >= r.y0 - 1e-6 && y <= r.y1 + 1e-6);
    const zFront = D - num("sys_row_front");
    const zRearMin = layout.backFrontZ + num("sys_row_rear_min");
    const k = Math.floor((zFront - zRearMin) / pitch + 1e-9);
    const rows = k >= 1 ? [zFront, zFront - k * pitch] : [zFront];
    const ys = gridPositions(num("sys_grid_y0"), pitch, layout.innerBottomY, layout.innerTopY);
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
      // A side under a slope ends lower (D47).
      const top = layout.innerTop[side.code];
      const faceYs = top === undefined ? ys : ys.filter((y) => y <= top - num("sys_margin") + 1e-6);
      for (const z of rows) {
        // Under a roof sloping to the rear (D49): no holes above the slope's inner face.
        const rs = layout.rearSlope;
        const yMax = rs ? (rs.line - rs.sn * (rs.D - z)) / rs.cs - num("sys_margin") : Infinity;
        if (z < side.box.z || z > side.box.z + side.box.dz) continue;
        const r = num("sys_hole_d") / 2 + num("bore_min_wall");
        for (const y of faceYs.filter((v) => v <= yMax + 1e-6 && wanted(x, v))) {
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
    // Doors hinged on a middle panel cover only half of it: their own hinge (D57).
    const middleId = opt<string | null>("hardware.hinge_middle");
    const middle = middleId === null ? hinge : library.hardware.get(middleId)!;
    for (const door of layout.doors) {
      const part = byCode.get(door.code)!;
      const panel = byCode.get(door.panel);
      const item = panel?.role === "partition" ? middle : hinge;
      const placed = placeHinges(rc, item, part, door.hinge, panel, parts, diagnostics);
      use(item, placed);
    }
  }

  // --- Handles and knobs ------------------------------------------------------------
  // The cabinet's handle (option), or the one a front zone sets for its fronts (D48).
  const handleId = opt<string | null>("hardware.handle");
  {
    const mode = opt<ThroughMode>("bore.through");
    const overlap = num("through_overlap");
    const planCache = new Map<string, { item: HardwareItem; params: ReadonlyMap<string, number>; cc: number; hd: number }>();
    const planFor = (code: string): { item: HardwareItem; params: ReadonlyMap<string, number>; cc: number; hd: number } | undefined => {
      const id = Object.hasOwn(layout.frontHandles, code) ? layout.frontHandles[code]! : handleId;
      if (id === null) return undefined;
      const cached = planCache.get(id);
      if (cached) return cached;
      const item = library.hardware.get(id);
      if (!item) return undefined; // reported by the rule
      const params = evaluateItemParams(item, rc.values, at);
      diagnostics.push(...params.diagnostics);
      const plan = { item, params: params.values, cc: params.values.get("cc") ?? 0, hd: params.values.get("hole_d") ?? 5 };
      planCache.set(id, plan);
      return plan;
    };
    const drill = (part: Part, plan: NonNullable<ReturnType<typeof planFor>>, pts: { x: number; y: number }[]): void => {
      const { item, hd } = plan;
      const source: OpSource = { kind: "hardware", ref: item.id };
      const z = part.box.z + part.box.dz;
      for (const p of pts) addThroughBore(part, { x: p.x, y: p.y, z }, "-z", hd, mode, overlap, source);
      const pv = (n: string): number | undefined => plan.params.get(n);
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
    const edgeOff = num("handle_edge_offset");
    const endOff = num("handle_end_offset");
    const wall = rc.cabinet.kind === "wall";
    // Grip height in cabinet Y (D66, D72): the handle sits as near to it as the door allows.
    // handle.door_y "end" keeps the old rule: wall units low, others high (D51).
    const byHeight = opt<string>("handle.door_y") === "height";
    const grip = byHeight ? num("handle_height") - (wall ? num("wall_bottom") : num("plinth_h")) : wall ? -Infinity : Infinity;
    const near = (lo: number, hi: number, want: number): number => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, want)));
    for (const d of [...layout.doors, ...layout.applianceFronts]) {
      const p = byCode.get(d.code)!;
      const plan = planFor(d.code);
      if (!plan) continue;
      const { cc } = plan;
      const b = p.box;
      // Opening edge is opposite the hinges; the top of the door at that edge
      // (a door cut to a slope is lower there, D51).
      const xOpen = d.hinge === "left" ? b.x + b.dx - edgeOff : b.x + edgeOff;
      const top = b.y + frontTopAt(p, xOpen);
      if (cc !== 0 && opt<string>("handle.door") === "vertical") {
        const yLo = near(b.y + endOff, top - endOff - cc, grip - cc / 2);
        drill(p, plan, [{ x: xOpen, y: yLo }, { x: xOpen, y: yLo + cc }]);
      } else {
        const y = near(b.y + endOff, top - endOff, grip);
        const inward = d.hinge === "left" ? -1 : 1;
        drill(p, plan, cc === 0 ? [{ x: xOpen, y }] : [{ x: xOpen, y }, { x: xOpen + inward * cc, y }]);
      }
    }
    for (const p of parts.filter((x) => x.role === "flap")) {
      const plan = planFor(p.code);
      if (!plan) continue;
      const { cc } = plan;
      const b = p.box;
      const xc = b.x + b.dx / 2;
      const y = b.y + num("handle_end_offset");
      drill(p, plan, cc === 0 ? [{ x: xc, y }] : [{ x: xc - cc / 2, y }, { x: xc + cc / 2, y }]);
    }
    for (const p of parts.filter((x) => x.role === "drawer_front")) {
      const plan = planFor(p.code);
      if (!plan) continue;
      const { cc } = plan;
      const b = p.box;
      const y = opt<string>("handle.drawer") === "top" ? b.y + b.dy - num("handle_drawer_top") : b.y + b.dy / 2;
      const xc = b.x + b.dx / 2;
      drill(p, plan, cc === 0 ? [{ x: xc, y }] : [{ x: xc - cc / 2, y }, { x: xc + cc / 2, y }]);
    }
  }

  // --- Drawer slides ------------------------------------------------------------------
  for (const [i, d] of layout.drawers.entries()) {
    const item = library.hardware.get(d.slide)!;
    const sd = item.slide!;
    // Limits once per clear width (sections may differ, D46).
    if (layout.drawers.findIndex((e) => e.x1 - e.x0 === d.x1 - d.x0 && e.nl === d.nl) === i) {
      const ctx = new Map(rc.values);
      ctx.set("LWK", d.x1 - d.x0);
      ctx.set("NL", d.nl);
      for (const dg of checkLimits(item, evaluateItemParams(item, ctx, at).values, at)) {
        if (!diagnostics.some((x) => x.code === dg.code && JSON.stringify(x.params) === JSON.stringify(dg.params))) diagnostics.push(dg);
      }
    }
    const fix = sd.fixings.find((f) => d.nl <= f.upTo) ?? sd.fixings[sd.fixings.length - 1]!;
    const source: OpSource = { kind: "hardware", ref: item.id };
    // Rails on the panels left and right of the drawer: sides or middle panels.
    for (const x of [d.x0, d.x1]) {
      const v = verticalAt(x);
      if (!v) continue;
      for (const a of fix.at) {
        addBore(v.part, { x, y: d.axisY, z: D - sd.firstFixing - a }, v.dir, num("sys_hole_d"), num("sys_hole_depth"), source);
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
      for (const x of [d.x0 + ff.fromSide, d.x1 - ff.fromSide]) {
        for (const r of ff.rows) addBore(df, { x, y: yb + ff.fromBox + r, z: df.box.z }, "+z", ff.d, ff.depth, src);
      }
    } else if (d.box === "wood" && opt<string>("drawer_front.fixing") === "screws") {
      const inner = byCode.get(`DI${d.index}`);
      if (inner) {
        const b = inner.box;
        const s = num("front_screw_side");
        const e = num("front_screw_edge");
        const src: OpSource = { kind: "joint", ref: `DI${d.index}-DF${d.index}` };
        // A low box (drawer_box_h) has no room for two rows: one row at mid-height (D71).
        const rows = b.dy >= 2 * e + num("front_screw_d") + num("bore_min_wall") ? [b.y + e, b.y + b.dy - e] : [b.y + b.dy / 2];
        for (const x of [b.x + s, b.x + b.dx - s]) {
          for (const y of rows) {
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
    const source: OpSource = { kind: "hardware", ref: item.id };
    for (const f of layout.flaps) {
      const front = byCode.get(f.code)!;
      // A flap closes against the panel below it and its fitting hangs under the panel above (D71).
      if (!f.panelBelow) diagnostics.push({ severity: "warning", code: "flap_no_panel_below", params: { part: front.id }, ...at, part: front.id });
      if (!f.panelAbove) {
        diagnostics.push({ severity: "error", code: "flap_no_panel_above", params: { part: front.id, item: item.id }, ...at, part: front.id });
        continue;
      }
      // The item sees the flap's compartment as its cabinet: H from the panel below to the panel above.
      const H = f.top - f.bottom;
      const density = library.materials.get(front.material)?.density;
      if (density === undefined) diagnostics.push({ severity: "warning", code: "material_no_density", params: { material: front.material }, ...at });
      const kg = (front.length * front.width * front.thickness * (density ?? 750)) / 1e9 + 2 * num("flap_handle_weight");
      const scope = new Map(rc.values);
      scope.set("front_kg", Math.round(kg * 100) / 100);
      scope.set("H", H);
      scope.set("LF", Math.round(H * kg));
      scope.set("FAo", Math.max(0, front.box.y + front.box.dy - (f.top - t)));
      scope.set("H_in", H - 2 * t);
      scope.set("flap_top", front.box.y + front.box.dy - f.bottom);
      const params = evaluateItemParams(item, scope, at);
      diagnostics.push(...params.diagnostics, ...checkLimits(item, params.values, { ...at, part: front.id }));
      const { drills, diagnostics: dd } = evaluateDrilling(item, params.values, at);
      diagnostics.push(...dd);
      for (const [code, x, dir] of [["SL", t, "-x"], ["SR", W - t, "+x"]] as const) {
        const side = byCode.get(code);
        if (!side) continue;
        for (const dr of drills) {
          if (dr.mount !== "side") continue;
          addBore(side, { x, y: f.top - dr.a, z: D - dr.b }, dir, dr.d, dr.depth, source);
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
        use(hingeItem, placeFlapHinges(rc, hingeItem, front, parts, f.top, params.values.get("hinge_min_from_side") ?? 0, diagnostics));
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
  // One bottom, or one per section when middle panels run through (D46).
  const bottoms = parts.filter((p) => p.role === "bottom").sort((a, b) => a.box.x - b.box.x);
  const bottom = bottoms[0];
  if (legId !== null && rc.cabinet.kind !== "wall" && num("plinth_h") > 0 && bottom) {
    const item = library.hardware.get(legId)!;
    const params = evaluateItemParams(item, rc.values, at);
    diagnostics.push(...params.diagnostics);
    const limits = checkLimits(item, params.values, at);
    diagnostics.push(...limits);
    // Name the legs in the library that would fit (D50).
    if (limits.some((d) => d.severity === "error")) {
      const fit = [...library.hardware.values()]
        .filter((h) => h.category === "leg" && h.id !== item.id)
        .filter((h) => !checkLimits(h, evaluateItemParams(h, rc.values, at).values, at).some((d) => d.severity === "error"))
        .map((h) => h.id);
      if (fit.length) diagnostics.push({ severity: "warning", code: "hardware_alternatives", params: { option: "hardware.leg", items: fit.join(", ") }, ...at });
    }
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
    /** The bottom piece a leg at x is drilled into (a leg under a middle panel has none). */
    const pieceAt = (x: number): Part | undefined => bottoms.find((b) => x >= b.box.x - 1e-6 && x <= b.box.x + b.box.dx + 1e-6);
    // Free of other machining, and still on its bottom piece (a leg must not move off its end, under a side, D64).
    const fits = (x: number, z: number): boolean => {
      const b = pieceAt(x);
      if (!b) return false;
      return drills.every((dr) => {
        if (dr.mount !== "bottom") return true;
        const p = { x: x + dr.a, y: b.box.y, z: z + dr.b };
        if (p.x - dr.d / 2 < b.box.x + minWall - 1e-6 || p.x + dr.d / 2 > b.box.x + b.box.dx - minWall + 1e-6) return false;
        return !boreWouldCollide(b, p, "+y", dr.d, dr.depth, minWall);
      });
    };
    for (const x0 of xs) {
      for (const z of zs) {
        // A leg that meets other machining (middle panel dowels) moves sideways in pitch steps.
        let x = x0;
        for (let k = 1; k <= 4 && !fits(x, z); k++) {
          const step = k * num("sys_pitch");
          x = fits(x0 - step, z) ? x0 - step : x0 + step;
        }
        if (!fits(x, z)) x = x0;
        const piece = pieceAt(x) ?? bottom;
        for (const dr of drills) {
          if (dr.mount !== "bottom") {
            diagnostics.push({ severity: "error", code: "hardware_unknown_mount", params: { item: item.id, mount: dr.mount, category: item.category }, ...at });
            continue;
          }
          addBore(piece, { x: x + dr.a, y: piece.box.y, z: z + dr.b }, "+y", dr.d, dr.depth, source);
        }
        fittings.push({ kind: "leg", item: item.id, x, y: 0, z, d: params.values.get("d") ?? 40, h: num("plinth_h") });
      }
    }
    use(item, xs.length * zs.length);
  }

  // --- Fixed blind panels (D71): joined to the carcase parts they lie on ----------------------
  // A carcase part standing behind the panel with its face (upright front
  // rail, free frontal part) is screwed through from inside like a drawer's
  // inner front (D26); a part that only meets it with its front edge (side,
  // bottom, top or flat rail, fixed shelf, middle panel) gets dowels.
  if (opt<string>("blind_panel.fixing") === "auto") {
    const minWall = num("bore_min_wall");
    const dowelItem = library.hardware.get(opt<string>("hardware.connector"))!;
    const dp = evaluateItemParams(dowelItem, rc.values, at).values;
    const dowel = dp.has("d") && dp.has("face_depth") && dp.has("edge_depth") ? { d: dp.get("d")!, face: dp.get("face_depth")!, edge: dp.get("edge_depth")! } : undefined;
    const carcase = new Set(["side_left", "side_right", "bottom", "top", "rail_front", "fixed_shelf", "partition", "custom"]);
    for (const panel of parts.filter((p) => p.role === "blind_panel")) {
      const b = panel.box;
      let fixings = 0;
      let dowels = 0;
      for (const q of parts) {
        if (!carcase.has(q.role) || Math.abs(q.box.z + q.box.dz - b.z) > 0.011) continue;
        const x0 = Math.max(b.x, q.box.x);
        const x1 = Math.min(b.x + b.dx, q.box.x + q.box.dx);
        const y0 = Math.max(b.y, q.box.y);
        const y1 = Math.min(b.y + b.dy, q.box.y + q.box.dy);
        if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) continue;
        const source: OpSource = { kind: "joint", ref: `${q.code}-${panel.code}` };
        const ax = thicknessAxis(q.lengthAxis, q.widthAxis);
        if (ax === "z") {
          // Screws from inside through the part, front_screw_side / front_screw_edge inside the shared area.
          const s = num("front_screw_side");
          const e = num("front_screw_edge");
          const d = num("front_screw_d");
          const xs = x1 - x0 >= 2 * s + d ? [x0 + s, x1 - s] : [(x0 + x1) / 2];
          const ys = y1 - y0 >= 2 * e + d ? [y0 + e, y1 - e] : [(y0 + y1) / 2];
          for (const x of xs) {
            for (const y of ys) {
              if (boreWouldCollide(q, { x, y, z: q.box.z }, "+z", d, q.thickness, minWall)) continue;
              addThroughBore(q, { x, y, z: q.box.z }, "+z", d, "one_side", 0, source);
              fixings++;
            }
          }
          continue;
        }
        if (!dowel) continue;
        // Dowels on the part's mid-thickness line, where the panel covers it with enough wall.
        const mid = ax === "x" ? q.box.x + q.box.dx / 2 : q.box.y + q.box.dy / 2;
        const need = dowel.d / 2 + minWall;
        const [lo, hi] = ax === "x" ? [b.x, b.x + b.dx] : [b.y, b.y + b.dy];
        if (mid - need < lo - 1e-6 || mid + need > hi + 1e-6) continue;
        const [a0, a1] = ax === "x" ? [y0, y1] : [x0, x1];
        const off = num("blind_dowel_offset");
        const len = a1 - a0;
        if (len < 2 * need) continue;
        const n = len < 2 * off + dowel.d ? 1 : Math.max(2, Math.ceil((len - 2 * off) / num("blind_dowel_max_spacing") - 1e-9) + 1);
        for (let k = 0; k < n; k++) {
          // Whole millimetres along the edge.
          const a = Math.round(n === 1 ? (a0 + a1) / 2 : a0 + off + ((len - 2 * off) * k) / (n - 1));
          const at3 = (z: number): Point3 => (ax === "x" ? { x: mid, y: a, z } : { x: a, y: mid, z });
          // A position that meets other machining (joint dowels, system holes) is left out.
          if (boreWouldCollide(panel, at3(b.z), "+z", dowel.d, dowel.face, minWall) || boreWouldCollide(q, at3(b.z), "-z", dowel.d, dowel.edge, minWall)) continue;
          addBore(panel, at3(b.z), "+z", dowel.d, dowel.face, source);
          addBore(q, at3(b.z), "-z", dowel.d, dowel.edge, source);
          fixings++;
          dowels++;
        }
      }
      use(dowelItem, dowels);
      if (fixings === 0) diagnostics.push({ severity: "warning", code: "blind_panel_not_fixed", params: { part: panel.id }, ...at, part: panel.id });
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

  // --- Free bores and extra hardware (D59) -------------------------------------------------
  for (const f of applyCustomBores(rc, library, parts, diagnostics)) use(library.hardware.get(f.item)!, f.qty);
  for (const [k, h] of (rc.cabinet.construction?.hardware ?? []).entries()) {
    const item = library.hardware.get(h.item);
    const r = typeof h.qty === "number" ? undefined : evaluateGraph(new Map([["__q", h.qty]]), rc.values);
    const qty = typeof h.qty === "number" ? h.qty : r!.diagnostics.length ? undefined : r!.values.get("__q");
    if (!item) diagnostics.push({ severity: "error", code: "hardware_unknown", params: { key: `construction.hardware ${k + 1}`, value: h.item }, ...at });
    else if (qty === undefined || !Number.isFinite(qty) || qty < 0) diagnostics.push({ severity: "error", code: "construction_value_invalid", params: { what: `hardware ${k + 1}`, expr: String(h.qty) }, ...at });
    else use(item, qty);
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
export interface Joint {
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
  // Bottom, top and rails: one each, or one per section (middle panels through, D46).
  const hzRoles = ["bottom", "top", "rail_front", "rail_rear", "rail_bottom"];
  const horizontals = parts.filter((p) => hzRoles.includes(p.role)).sort((a, b) => hzRoles.indexOf(a.role) - hzRoles.indexOf(b.role) || a.box.x - b.box.x);
  const upright = (p: Part): boolean => thicknessAxis(p.lengthAxis, p.widthAxis) === "z";
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;
  const joints: Joint[] = [];
  /** Vertical panel face, horizontal panel end (sides over, or middle panels through). */
  const endJoint = (v: Part, h: Part, left: boolean): Joint => {
    const up = upright(h);
    return {
      ref: `${v.code}-${h.code}`,
      facePart: v,
      edgePart: h,
      plane: { axis: "x", value: left ? v.box.x + v.box.dx : v.box.x },
      intoFace: left ? "-x" : "+x",
      across: up ? { axis: "z", value: h.box.z + h.box.dz / 2 } : { axis: "y", value: h.box.y + h.box.dy / 2 },
      line: up ? "y" : "z",
      ...(up && h.box.y < v.box.y + v.box.dy / 2 ? { fromMin: true } : {}),
    };
  };
  /** Horizontal panel face, vertical panel end (sides between, or middle panels between). */
  const faceJoint = (h: Part, v: Part): Joint => {
    const below = h.box.y + h.box.dy <= v.box.y + 1e-6;
    return {
      ref: `${h.code}-${v.code}`,
      facePart: h,
      edgePart: v,
      plane: { axis: "y", value: below ? h.box.y + h.box.dy : h.box.y },
      intoFace: below ? "-y" : "+y",
      across: { axis: "x", value: v.box.x + v.box.dx / 2 },
      line: "z",
    };
  };
  /** The horizontal runs under/over the vertical part's whole thickness. */
  const spans = (h: Part, v: Part): boolean => h.box.x <= v.box.x + 1e-6 && h.box.x + h.box.dx >= v.box.x + v.box.dx - 1e-6;
  for (const side of sides) {
    const left = side.code === "SL";
    for (const h of horizontals) {
      if (jointType === "sides_over") {
        // Side face, horizontal part's end. Upright rails: across their thickness (Z), along Y.
        if (!near(left ? side.box.x + side.box.dx : side.box.x, left ? h.box.x : h.box.x + h.box.dx)) continue;
        joints.push(endJoint(side, h, left));
      } else if (!upright(h) && spans(h, side)) {
        // Horizontal part's face, side's end. Bottom is below the side, top/rails above.
        joints.push(faceJoint(h, side));
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
  // Middle panels stand between bottom and top/rails, or run through with
  // the horizontals' ends against their faces (D46).
  for (const mp of parts.filter((p) => p.role === "partition")) {
    for (const h of horizontals) {
      if (h.box.z >= mp.box.z + mp.box.dz || mp.box.z >= h.box.z + h.box.dz) continue;
      if (near(h.box.x + h.box.dx, mp.box.x)) joints.push(endJoint(mp, h, false));
      else if (near(h.box.x, mp.box.x + mp.box.dx)) joints.push(endJoint(mp, h, true));
      else if (!upright(h) && spans(h, mp)) joints.push(faceJoint(h, mp));
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
    // No position moves in front of the first one (offsetFront): it would leave the joint or sit in its front edge (D64).
    if (last) while (L - p < o.offsetRear - 1e-9 && p - o.pitch >= o.offsetFront - 1e-9) p -= o.pitch;
    if (L - p < o.offsetRear - 1e-9) break;
    // Move off machining in the way: first towards the front in pitch steps
    // (a groove), then half a pitch either way (dowels of the panel on the
    // other face of a middle panel, D45), then to the rear in pitch steps.
    // A moved dowel keeps offsetFront and offsetRear from the ends (D64).
    const prev = out.length ? zMax - out[out.length - 1]! : -Infinity;
    const ok = (q: number): boolean => q >= o.offsetFront - 1e-9 && L - q >= o.offsetRear - 1e-9 && q - prev >= o.pitch / 2 - 1e-9 && free(roundMm(zMax - q));
    const moves = [0, -o.pitch, -2 * o.pitch, -3 * o.pitch, o.pitch / 2, -o.pitch / 2, o.pitch, (3 * o.pitch) / 2, 2 * o.pitch, 3 * o.pitch];
    const at = moves.map((d) => p + d).find((q) => (q === p ? free(roundMm(zMax - q)) : ok(q)));
    if (at === undefined) continue;
    p = at;
    if (p - prev < o.pitch / 2 - 1e-9 || (p === raster[i] && p - prev < o.pitch - 1e-9)) continue;
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

/** Slot of width d and length len (D36), `depth` into the part from the entry plane. */
function grooveBox(g: JointGeometry, dr: EvaluatedDrill, entry: Point3, dir: Direction): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
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
  return { x0: lo.x, x1: hi.x, y0: lo.y, y1: hi.y, z0: lo.z, z1: hi.z };
}

function connectorFits(g: JointGeometry, c: ConnectorPlan, z: number): boolean {
  return c.drills.every((dr) => {
    const { part, entry, dir } = connectorDrill(g, dr, z);
    // A slot must stay a pocket of its part (not through it, not off it) and clear of other
    // machining, e.g. the slot of the joint on the other face of a middle panel (D55).
    if (dr.op === "groove") return !pocketWouldCollide(part, grooveBox(g, dr, entry, dir), g.minWall);
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
      addPocketFromBox(part, grooveBox(g, dr, entry, dir), source);
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
 * drilling into the underside of the panel above (top, front rail, or the
 * fixed shelf over a flap under another front; `top` is its top face), `b`
 * from the carcase front. Two hinges, each at least `minFromSide` and
 * hinge_end_offset from the sides' inner faces.
 */
function placeFlapHinges(rc: ResolvedCabinet, item: HardwareItem, flap: Part, parts: Part[], top: number, minFromSide: number, diagnostics: Diagnostic[]): number {
  const at = { cabinet: rc.cabinet.id };
  const num = (n: string): number => rc.values.get(n)!;
  const W = num("W");
  const t = num("t_carcase");
  const D = num("D");
  const context = new Map(rc.values);
  context.set("door_h", flap.width);
  context.set("door_w", flap.length);
  context.set("door_t", flap.thickness);
  context.set("hinge_overlay", flap.box.y + flap.box.dy - (top - t));
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
        const p = { x: xc + dr.a, y: top - t, z: D - dr.b };
        const host = parts.find(
          (q) =>
            (q.role === "top" || q.role === "rail_front" || q.role === "fixed_shelf") &&
            Math.abs(q.box.y - p.y) < 0.011 &&
            q.box.dy <= t + 1e-6 &&
            p.z >= q.box.z &&
            p.z <= q.box.z + q.box.dz &&
            p.x >= q.box.x &&
            p.x <= q.box.x + q.box.dx,
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

/** Height of an upright front (length along Y) at cabinet x, from its bottom edge; follows its outline (D51). */
function frontTop(p: Part, x: number): number {
  if (!p.outline || p.lengthAxis !== "y") return p.box.dy;
  const v = x - p.box.x;
  // Highest point of the outline's vertical section at v.
  let top = 0;
  const pts = p.outline;
  for (let i = 0; i < pts.length; i++) {
    const [ua, va] = pts[i]!;
    const [ub, vb] = pts[(i + 1) % pts.length]!;
    if ((va - v) * (vb - v) > 1e-9) continue;
    const u = Math.abs(vb - va) < 1e-9 ? Math.max(ua, ub) : ua + ((ub - ua) * (v - va)) / (vb - va);
    top = Math.max(top, u);
  }
  return top;
}

function placeHinges(
  rc: ResolvedCabinet,
  item: HardwareItem,
  door: Part,
  side: "left" | "right",
  /** The side or middle panel the hinges go into (D46). */
  sidePart: Part | undefined,
  /** All parts of the cabinet (fixed panels the plates keep clear of, D65). */
  parts: readonly Part[],
  diagnostics: Diagnostic[],
): number {
  const at = { cabinet: rc.cabinet.id };
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
  // A door cut to a slope (D51): the hinge edge may end lower than the door's box.
  const y1 = door.box.y + frontTop(door, side === "left" ? door.box.x : door.box.x + door.box.dx) - endOffset;
  let centres = n === 1 ? [(y0 + y1) / 2] : Array.from({ length: n }, (_, i) => y0 + (i * (y1 - y0)) / (n - 1));

  // Snap so the mounting plate lands on the system grid.
  const gridOffset = params.values.get("grid_offset");
  if (gridOffset !== undefined && rc.options.get("system_holes")!.value !== "none") {
    const gy0 = rc.values.get("sys_grid_y0")!;
    const pitch = rc.values.get("sys_pitch")!;
    centres = centres.map((c) => gy0 + Math.round((c - gridOffset - gy0) / pitch) * pitch + gridOffset);
  }

  // A mounting plate never sits on the end of a fixed panel (D65): the hinge
  // moves towards the door's middle in pitch steps until its plate holes are clear.
  if (sidePart) {
    const face = side === "left" ? sidePart.box.x + sidePart.box.dx : sidePart.box.x;
    const panels = parts.filter(
      (p) =>
        (p.role === "fixed_shelf" || p.role === "custom") &&
        thicknessAxis(p.lengthAxis, p.widthAxis) === "y" &&
        (Math.abs(p.box.x - face) < 0.01 || Math.abs(p.box.x + p.box.dx - face) < 0.01),
    );
    const wall = rc.values.get("bore_min_wall")!;
    const blocked = (yc: number): boolean => {
      const scope = new Map(params.values);
      scope.set("hinge_y", yc);
      const { drills } = evaluateDrilling(item, scope, at);
      return drills.some(
        (dr) => dr.mount === "side" && panels.some((p) => yc + dr.a > p.box.y - dr.d / 2 - wall && yc + dr.a < p.box.y + p.box.dy + dr.d / 2 + wall),
      );
    };
    const pitch = rc.values.get("sys_pitch")!;
    const mid = door.box.y + door.box.dy / 2;
    centres = centres.map((c) => {
      const step = c <= mid ? pitch : -pitch;
      let y = c;
      for (let k = 0; k < 8 && blocked(y); k++) y += step;
      return blocked(y) ? c : y;
    });
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
