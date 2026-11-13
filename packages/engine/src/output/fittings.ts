import type { CabinetResult } from "../project.ts";
import { faceAxes, toCabinet, type Bore, type Direction, type Face, type Point3 } from "../ops.ts";
import { roundMm, thicknessAxis, type Axis, type Part } from "../part.ts";
import { isFrontRole } from "./frontview.ts";

/**
 * Fittings of a cabinet as simplified, typed solids for views (3D, later
 * drawings), in cabinet coordinates (D2). Every position is read from what
 * the engine built: the drilled bores (operation sources), the drawer layout
 * and the placed rails and legs. Nothing is placed by rules of its own, so a
 * fitting always sits where its holes are (D74). Holds no styling; the sizes
 * that are not product data (how thick an arm is drawn) belong to the view.
 */
export type ViewFitting = HingeFitting | ShelfPinFitting | SlideFitting | LegFitting | RailFitting | LiftFitting | ConnectorFitting;

interface FittingBase {
  /** Hardware item id. */
  item: string;
  /** The part the fitting belongs to: it is hidden and moved with it. */
  part?: string;
}

/** Cup hinge: the cup in the front, and the mounting plate on the carcase when it is drilled. */
export interface HingeFitting extends FittingBase {
  kind: "hinge";
  part: string;
  /** Cup centre on the front's inner face. */
  at: Point3;
  /** Out of the cup bore, towards the carcase. */
  normal: Direction;
  /** From the cup towards the hinge edge of the front. */
  edge: Direction;
  /** Cup diameter and depth. */
  d: number;
  depth: number;
  plate?: {
    /** The carcase part that carries the plate (side, middle panel, top or rail for a flap). */
    part: string;
    /** Middle of the plate's holes on that part's face. */
    at: Point3;
    /** Out of the face, into the cabinet. */
    normal: Direction;
    /** Distance between the outermost plate holes. */
    span: number;
  };
}

/** Shelf support pin in the system hole a loose shelf rests on. */
export interface ShelfPinFitting extends FittingBase {
  kind: "shelf_pin";
  /** The shelf. */
  part: string;
  /** The panel with the hole. */
  host: string;
  /** Hole centre on the panel face. */
  at: Point3;
  /** Out of the hole, under the shelf. */
  normal: Direction;
  d: number;
}

/** Drawer slide: the cabinet rail on one side, from the carcase front backwards. */
export interface SlideFitting extends FittingBase {
  kind: "slide";
  /** The carcase side or middle panel it is screwed to. */
  part: string;
  drawer: number;
  /** Which side of the drawer it runs on. */
  side: "left" | "right";
  /** Front end on the panel's face, at the rail screw axis. */
  at: Point3;
  /** Out of the panel's face, towards the drawer. */
  normal: Direction;
  /** Nominal length, along −Z from `at`. */
  length: number;
  /** Clear space between the panel and the drawer box. */
  gap: number;
  /** Z of the rail screws. */
  fixings: number[];
}

/** Adjustable leg under the bottom. */
export interface LegFitting extends FittingBase {
  kind: "leg";
  /** Top of the leg (underside of the bottom). */
  at: Point3;
  d: number;
  h: number;
  /** Its bores in the bottom's underside (none for a screwed leg). */
  fixings: { x: number; z: number; d: number }[];
}

/** Wardrobe rail, from `at` along +X. */
export interface RailFitting extends FittingBase {
  kind: "rail";
  at: Point3;
  d: number;
  length: number;
}

/** Lift-up flap fitting (D39) on one side: the box around its holes in the side's face. */
export interface LiftFitting extends FittingBase {
  kind: "lift";
  /** The side it is screwed to. */
  part: string;
  /** The flap it carries. */
  flap: string;
  /** Out of the side's face, into the cabinet. */
  normal: Direction;
  /** Face plane (X) and the extent of the holes on it. */
  x: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Connector seen in a panel face: the cam housing (or screw head) in its bore. */
export interface ConnectorFitting extends FittingBase {
  kind: "connector";
  part: string;
  /** Bore centre on the face. */
  at: Point3;
  /** Out of the bore. */
  normal: Direction;
  d: number;
  depth: number;
}

const atMax = (f: Face): boolean => f === "t1" || f === "l2" || f === "w2";
const EPS = 0.01;

function cabinetAxis(part: Part, local: "u" | "v" | "w"): Axis {
  if (local === "u") return part.lengthAxis;
  if (local === "v") return part.widthAxis;
  return thicknessAxis(part.lengthAxis, part.widthAxis);
}

interface Opening {
  part: Part;
  bore: Bore;
  /** Centre of the opening on the part's face, in cabinet coordinates. */
  at: Point3;
  axis: Axis;
  /** Out of the opening, away from the part. */
  out: Direction;
}

/**
 * Where a bore opens, in cabinet coordinates: its entry and, for a hole
 * through the part (D23), the far opening too (the same hole seen from the
 * other face, where the hardware on that face sits).
 */
function openings(part: Part, o: Bore): Opening[] {
  const axis = cabinetAxis(part, faceAxes(o.face).normal);
  const sign = atMax(o.face) ? 1 : -1;
  const at = toCabinet(part, o);
  const entry: Opening = { part, bore: o, at, axis, out: `${sign > 0 ? "+" : "-"}${axis}` as Direction };
  if (!o.through) return [entry];
  const far = { ...at };
  far[axis] -= sign * part.thickness;
  return [entry, { part, bore: o, at: far, axis, out: `${sign > 0 ? "-" : "+"}${axis}` as Direction }];
}

/** Bores of a part from one hardware item (or the system holes). A part at an angle keeps its own frame: none. */
const bores = (p: Part, ref: (r: string) => boolean, kind: "hardware" | "system" = "hardware"): Bore[] =>
  p.profile?.rotated ? [] : p.operations.filter((o): o is Bore => o.kind === "bore" && o.sources.some((s) => s.kind === kind && ref(s.ref)));
const point = (q: Point3): Point3 => ({ x: roundMm(q.x), y: roundMm(q.y), z: roundMm(q.z) });
const dist = (a: Point3, b: Point3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function viewFittingsOf(c: CabinetResult): ViewFitting[] {
  const out: ViewFitting[] = [];
  const opt = (k: string): string | undefined => {
    const v = c.resolved.options.get(k)?.value;
    return typeof v === "string" ? v : undefined;
  };
  const num = (n: string): number => c.resolved.values.get(n) ?? 0;
  const byCode = new Map(c.parts.map((p) => [p.code, p]));

  // --- Cup hinges: the cabinet's hinge and the middle-panel hinge (D57); flaps
  // without their own pivot hang on the cabinet's hinge (D42). The largest bore
  // of the item in a front is the cup; the item's bores in carcase parts are the
  // plate holes, each given to the nearest cup of the same item.
  const hingeItems = [...new Set([opt("hardware.hinge"), opt("hardware.hinge_middle")].filter((x): x is string => !!x))];
  const edgeOf = new Map<string, Direction>();
  for (const d of c.layout?.doors ?? []) edgeOf.set(d.code, d.hinge === "left" ? "-x" : "+x");
  for (const f of c.layout?.flaps ?? []) edgeOf.set(f.code, "+y");
  for (const item of hingeItems) {
    const hinges: HingeFitting[] = [];
    const plateHoles: Opening[] = [];
    for (const p of c.parts) {
      const hs = bores(p, (r) => r === item);
      if (!hs.length) continue;
      if (!isFrontRole(p.role)) {
        for (const o of hs) plateHoles.push(...openings(p, o));
        continue;
      }
      const d = Math.max(...hs.map((o) => o.d));
      for (const o of hs) {
        if (o.d !== d) continue;
        const b = openings(p, o)[0]!;
        // Without a layout entry (free construction): the nearer of the front's upright edges.
        const edge = edgeOf.get(p.code) ?? (b.at.x - p.box.x <= p.box.x + p.box.dx - b.at.x ? "-x" : "+x");
        hinges.push({ kind: "hinge", item, part: p.id, at: point(b.at), normal: b.out, edge, d: o.d, depth: o.depth });
      }
    }
    const groups = new Map<HingeFitting, Opening[]>();
    for (const h of plateHoles) {
      let best: HingeFitting | undefined;
      for (const hinge of hinges) if (!best || dist(hinge.at, h.at) < dist(best.at, h.at)) best = hinge;
      if (best) groups.set(best, [...(groups.get(best) ?? []), h]);
    }
    for (const [hinge, holes] of groups) {
      // One plate per hinge, on the part with the nearest hole.
      const first = holes.reduce((a, b) => (dist(b.at, hinge.at) < dist(a.at, hinge.at) ? b : a));
      const own = holes.filter((h) => h.part === first.part && h.out === first.out);
      const mean = (a: Axis): number => own.reduce((s, h) => s + h.at[a], 0) / own.length;
      const span = Math.max(...(["x", "y", "z"] as const).map((a) => Math.max(...own.map((h) => h.at[a])) - Math.min(...own.map((h) => h.at[a]))));
      hinge.plate = { part: first.part.id, at: point({ x: mean("x"), y: mean("y"), z: mean("z") }), normal: first.out, span: roundMm(span) };
    }
    out.push(...hinges);
  }

  // --- Shelf supports: the system holes just under each loose shelf, in the panels beside it.
  const support = opt("hardware.shelf_support");
  if (support) {
    const rest = num("shelf_pin_rest");
    const gap = num("shelf_gap");
    const uprights = c.parts.filter((p) => p.role !== "shelf" && thicknessAxis(p.lengthAxis, p.widthAxis) === "x");
    const holes = uprights.flatMap((host) => bores(host, () => true, "system").flatMap((o) => openings(host, o)));
    for (const shelf of c.parts) {
      if (shelf.role !== "shelf") continue;
      const s = shelf.box;
      for (const h of holes) {
        if (h.axis !== "x" || Math.abs(h.at.y - (s.y - rest)) > EPS || h.at.z < s.z - EPS || h.at.z > s.z + s.dz + EPS) continue;
        // The hole on the face beside the shelf's end, opening towards it.
        const left = Math.abs(h.at.x - (s.x - gap)) < EPS && h.out === "+x";
        const right = Math.abs(h.at.x - (s.x + s.dx + gap)) < EPS && h.out === "-x";
        if (!left && !right) continue;
        out.push({ kind: "shelf_pin", item: support, part: shelf.id, host: h.part.id, at: point(h.at), normal: h.out, d: h.bore.d });
      }
    }
  }

  // --- Drawer slides: a rail on the panel left and right of each drawer (a side
  // or a middle panel, D46) at the screw axis, from the panel's front edge.
  for (const d of c.layout?.drawers ?? []) {
    const box = ["DL", "DR", "DI", "DB", "DT"].flatMap((k) => byCode.get(`${k}${d.index}`) ?? []);
    for (const [side, x, want] of [["left", d.x0, "+x"], ["right", d.x1, "-x"]] as const) {
      const fix = c.parts
        .filter((p) => !isFrontRole(p.role))
        .flatMap((p) => bores(p, (r) => r === d.slide).flatMap((o) => openings(p, o)))
        .filter((b) => b.axis === "x" && b.out === want && Math.abs(b.at.x - x) < EPS && Math.abs(b.at.y - d.axisY) < EPS);
      if (!fix.length) continue;
      const host = fix[0]!.part;
      const gap = box.length ? Math.min(...box.map((p) => (side === "left" ? p.box.x - x : x - (p.box.x + p.box.dx)))) : 0;
      out.push({
        kind: "slide",
        item: d.slide,
        part: host.id,
        drawer: d.index,
        side,
        at: point({ x, y: d.axisY, z: host.box.z + host.box.dz }),
        normal: want,
        length: d.nl,
        gap: roundMm(Math.max(0, gap)),
        fixings: fix.filter((b) => b.part === host).map((b) => roundMm(b.at.z)).sort((a, b) => b - a),
      });
    }
  }

  // --- Lift-up flap fittings: per flap and side, the box around the item's holes there.
  const flapItem = opt("hardware.flap");
  if (flapItem) {
    for (const f of c.layout?.flaps ?? []) {
      const front = byCode.get(f.code);
      if (!front) continue;
      for (const code of ["SL", "SR"]) {
        const side = byCode.get(code);
        if (!side) continue;
        const hs = bores(side, (r) => r === flapItem)
          .flatMap((o) => openings(side, o))
          .filter((b) => b.axis === "x" && b.out === (code === "SL" ? "+x" : "-x") && b.at.y <= f.top + EPS && b.at.y >= f.bottom - EPS);
        if (!hs.length) continue;
        const ys = hs.map((b) => b.at.y);
        const zs = hs.map((b) => b.at.z);
        out.push({
          kind: "lift",
          item: flapItem,
          part: side.id,
          flap: front.id,
          normal: hs[0]!.out,
          x: roundMm(hs[0]!.at.x),
          y0: roundMm(Math.min(...ys)),
          y1: roundMm(Math.max(...ys)),
          z0: roundMm(Math.min(...zs)),
          z1: roundMm(Math.max(...zs)),
        });
      }
    }
  }

  // --- Legs and wardrobe rails as placed by the machining stage (D31), legs with their
  // bores in the bottom piece above them (one per section when middle panels run through, D46).
  const bottoms = c.parts.filter((p) => p.role === "bottom");
  for (const f of c.fittings) {
    if (f.kind === "rail" && f.length) out.push({ kind: "rail", item: f.item, at: point(f), d: f.d, length: f.length });
    if (f.kind === "leg" && f.h) {
      const bottom = bottoms.find((b) => f.x >= b.box.x - EPS && f.x <= b.box.x + b.box.dx + EPS) ?? bottoms[0];
      const fixings = bottom
        ? bores(bottom, (r) => r === f.item)
            .flatMap((o) => openings(bottom, o).slice(0, 1).map((b) => ({ ...b, d: o.d })))
            .filter((b) => b.axis === "y" && Math.hypot(b.at.x - f.x, b.at.z - f.z) <= f.d / 2 + EPS)
            .map((b) => ({ x: roundMm(b.at.x), z: roundMm(b.at.z), d: b.d }))
        : [];
      out.push({ kind: "leg", item: f.item, ...(bottom ? { part: bottom.id } : {}), at: point(f), d: f.d, h: f.h, fixings });
    }
  }

  // --- Connectors: per fitting (operation group) the largest bore in a panel face,
  // i.e. the cam housing rather than the bolt hole in the other panel.
  const best = new Map<string, { p: Part; o: Bore; item: string }>();
  for (const p of c.parts) {
    if (p.profile?.rotated) continue;
    for (const o of p.operations) {
      if (o.kind !== "bore" || (o.face !== "t0" && o.face !== "t1")) continue;
      for (const s of o.sources) {
        if (s.kind !== "hardware" || !s.group) continue;
        const key = `${s.ref}|${s.group}`;
        if (!best.has(key) || best.get(key)!.o.d < o.d) best.set(key, { p, o, item: s.ref });
      }
    }
  }
  for (const { p, o, item } of best.values()) {
    const b = openings(p, o)[0]!;
    out.push({ kind: "connector", item, part: p.id, at: point(b.at), normal: b.out, d: o.d, depth: o.depth });
  }
  return out;
}
