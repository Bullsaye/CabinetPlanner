import type { CabinetResult } from "../project.ts";
import { faceAxes, toCabinet, type Bore, type Direction, type Face, type Point3 } from "../ops.ts";
import { roundMm, thicknessAxis, type Axis, type Part } from "../part.ts";
import { isFrontRole } from "./frontview.ts";

/**
 * Fittings of a cabinet as simplified, typed solids for views (3D, later
 * drawings), in cabinet coordinates (D2). Every position is read from what
 * the engine built: the drilled bores (operation sources), the drawer layout
 * and the placed rails and legs. Nothing is placed by rules of its own, so a
 * fitting always sits where its holes are (D58). Holds no styling; the sizes
 * that are not product data (how thick an arm is drawn) belong to the view.
 */
export type ViewFitting = HingeFitting | ShelfPinFitting | SlideFitting | LegFitting | RailFitting | ConnectorFitting;

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
    /** The carcase part that carries the plate. */
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
  /** The carcase side it is screwed to. */
  part: string;
  drawer: number;
  side: "left" | "right";
  /** Front end on the side's inner face, at the rail screw axis. */
  at: Point3;
  /** Out of the side's face, into the cabinet. */
  normal: Direction;
  /** Nominal length, along −Z from `at`. */
  length: number;
  /** Clear space between the side and the drawer box. */
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

function cabinetAxis(part: Part, local: "u" | "v" | "w"): Axis {
  if (local === "u") return part.lengthAxis;
  if (local === "v") return part.widthAxis;
  return thicknessAxis(part.lengthAxis, part.widthAxis);
}

/** Entry point and the direction out of the bore, in cabinet coordinates. */
function boreOut(part: Part, o: Bore): { at: Point3; axis: Axis; out: Direction } {
  const axis = cabinetAxis(part, faceAxes(o.face).normal);
  return { at: toCabinet(part, o), axis, out: `${atMax(o.face) ? "+" : "-"}${axis}` as Direction };
}

const bores = (p: Part, ref: (r: string) => boolean, kind: "hardware" | "system" = "hardware"): Bore[] =>
  p.operations.filter((o): o is Bore => o.kind === "bore" && o.sources.some((s) => s.kind === kind && ref(s.ref)));
const point = (q: Point3): Point3 => ({ x: roundMm(q.x), y: roundMm(q.y), z: roundMm(q.z) });
const dist = (a: Point3, b: Point3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function viewFittingsOf(c: CabinetResult): ViewFitting[] {
  const out: ViewFitting[] = [];
  const opt = (k: string): string | undefined => {
    const v = c.resolved.options.get(k)?.value;
    return typeof v === "string" ? v : undefined;
  };
  const num = (n: string): number => c.resolved.values.get(n) ?? 0;

  // --- Cup hinges: the largest bore of the hinge item in a front is the cup; the
  // item's bores in carcase parts are the plate holes of the nearest cup.
  const hingeItem = opt("hardware.hinge");
  if (hingeItem) {
    const edgeOf = new Map<string, Direction>();
    for (const d of c.layout?.doors ?? []) edgeOf.set(d.code, d.hinge === "left" ? "-x" : "+x");
    for (const f of c.layout?.flaps ?? []) edgeOf.set(f.code, "+y");
    const hinges: HingeFitting[] = [];
    const plateHoles: { part: Part; at: Point3; out: Direction }[] = [];
    for (const p of c.parts) {
      const hs = bores(p, (r) => r === hingeItem);
      if (!hs.length) continue;
      if (!isFrontRole(p.role)) {
        for (const o of hs) {
          const b = boreOut(p, o);
          plateHoles.push({ part: p, at: b.at, out: b.out });
        }
        continue;
      }
      const d = Math.max(...hs.map((o) => o.d));
      for (const o of hs) {
        if (o.d !== d) continue;
        const b = boreOut(p, o);
        // Without a layout entry (free construction): the nearer of the front's upright edges.
        const edge = edgeOf.get(p.code) ?? (b.at.x - p.box.x <= p.box.x + p.box.dx - b.at.x ? "-x" : "+x");
        hinges.push({ kind: "hinge", item: hingeItem, part: p.id, at: point(b.at), normal: b.out, edge, d: o.d, depth: o.depth });
      }
    }
    const groups = new Map<HingeFitting, typeof plateHoles>();
    for (const h of plateHoles) {
      let best: HingeFitting | undefined;
      for (const hinge of hinges) if (!best || dist(hinge.at, h.at) < dist(best.at, h.at)) best = hinge;
      if (best) groups.set(best, [...(groups.get(best) ?? []), h]);
    }
    for (const [hinge, holes] of groups) {
      // One plate per hinge, on one part.
      const host = holes[0]!.part;
      const own = holes.filter((h) => h.part === host);
      const mean = (a: Axis): number => own.reduce((s, h) => s + h.at[a], 0) / own.length;
      const span = Math.max(...(["x", "y", "z"] as const).map((a) => Math.max(...own.map((h) => h.at[a])) - Math.min(...own.map((h) => h.at[a]))));
      hinge.plate = { part: host.id, at: point({ x: mean("x"), y: mean("y"), z: mean("z") }), normal: own[0]!.out, span: roundMm(span) };
    }
    out.push(...hinges);
  }

  // --- Shelf supports: the system holes just under each loose shelf, in the panels beside it.
  const support = opt("hardware.shelf_support");
  if (support) {
    const rest = num("shelf_pin_rest");
    const gap = num("shelf_gap");
    for (const shelf of c.parts) {
      if (shelf.role !== "shelf") continue;
      const s = shelf.box;
      for (const host of c.parts) {
        if (host === shelf || thicknessAxis(host.lengthAxis, host.widthAxis) !== "x") continue;
        for (const o of bores(host, () => true, "system")) {
          const b = boreOut(host, o);
          if (b.axis !== "x" || Math.abs(b.at.y - (s.y - rest)) > 0.01 || b.at.z < s.z - 0.01 || b.at.z > s.z + s.dz + 0.01) continue;
          // The face the hole opens to; a through hole (opposing rows, D23) opens to both.
          const faces = [b.at.x, ...(o.through ? [b.out === "+x" ? host.box.x : host.box.x + host.box.dx] : [])];
          for (const x of faces) {
            const left = Math.abs(x - (s.x - gap)) < 0.01;
            const right = Math.abs(x - (s.x + s.dx + gap)) < 0.01;
            if (!left && !right) continue;
            out.push({ kind: "shelf_pin", item: support, part: shelf.id, host: host.id, at: point({ ...b.at, x }), normal: left ? "+x" : "-x", d: o.d });
          }
        }
      }
    }
  }

  // --- Drawer slides: a rail on each side at the screw axis, from the carcase front.
  for (const d of c.layout?.drawers ?? []) {
    const box = c.parts.filter((p) => p.role.startsWith("drawer_") && p.role !== "drawer_front" && p.code.replace(/^\D+/, "") === String(d.index));
    for (const side of ["left", "right"] as const) {
      const host = c.parts.find((p) => p.role === (side === "left" ? "side_left" : "side_right"));
      if (!host) continue;
      const fix = bores(host, (r) => r === d.slide)
        .map((o) => boreOut(host, o))
        .filter((b) => b.axis === "x" && Math.abs(b.at.y - d.axisY) < 0.01);
      if (!fix.length) continue;
      const x = fix[0]!.at.x;
      const gap = box.length ? Math.min(...box.map((p) => (side === "left" ? p.box.x - x : x - (p.box.x + p.box.dx)))) : 0;
      out.push({
        kind: "slide",
        item: d.slide,
        part: host.id,
        drawer: d.index,
        side,
        at: point({ x, y: d.axisY, z: host.box.z + host.box.dz }),
        normal: fix[0]!.out,
        length: d.nl,
        gap: roundMm(Math.max(0, gap)),
        fixings: fix.map((b) => roundMm(b.at.z)).sort((a, b) => b - a),
      });
    }
  }

  // --- Legs and wardrobe rails as placed by the machining stage (D31), legs with their bores.
  const bottom = c.parts.find((p) => p.role === "bottom");
  for (const f of c.fittings) {
    if (f.kind === "rail" && f.length) out.push({ kind: "rail", item: f.item, at: point(f), d: f.d, length: f.length });
    if (f.kind === "leg" && f.h) {
      const fixings = bottom
        ? bores(bottom, (r) => r === f.item)
            .map((o) => ({ ...boreOut(bottom, o), d: o.d }))
            .filter((b) => b.axis === "y" && Math.hypot(b.at.x - f.x, b.at.z - f.z) <= f.d / 2 + 0.01)
            .map((b) => ({ x: roundMm(b.at.x), z: roundMm(b.at.z), d: b.d }))
        : [];
      out.push({ kind: "leg", item: f.item, ...(bottom ? { part: bottom.id } : {}), at: point(f), d: f.d, h: f.h, fixings });
    }
  }

  // --- Connectors: per fitting (operation group) the largest bore in a panel face,
  // i.e. the cam housing rather than the bolt hole in the other panel.
  const best = new Map<string, { p: Part; o: Bore; item: string }>();
  for (const p of c.parts) {
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
    const b = boreOut(p, o);
    out.push({ kind: "connector", item, part: p.id, at: point(b.at), normal: b.out, d: o.d, depth: o.depth });
  }
  return out;
}
