import { OPTION_BY_KEY } from "../catalog.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { evaluateGraph } from "../graph.ts";
import type { Library } from "../library.ts";
import { addBore, addThroughBore, toCabinet, type Direction, type Face, type OpSource, type ThroughMode } from "../ops.ts";
import { ROLE_CODES, boxSize, roundMm, thicknessAxis, type Axis, type Box, type Part, type PartEdges } from "../part.ts";
import type { ResolvedCabinet } from "../resolve.ts";
import type { CustomPartInput } from "../schema.ts";
import type { AddPart, BoxLayout } from "./box.ts";
import type { Joint } from "./machining.ts";

/**
 * Free construction (D45): parts placed by formulas, free bores and extra
 * hardware. The box rule covers the usual carcase; this is the way out for
 * everything it does not foresee. Nothing here knows a size: every number
 * is a formula of the cabinet's author.
 */

const PLANE_AXIS = { horizontal: "y", vertical: "x", frontal: "z" } as const;
/** Default length axis per plane; `grain` overrides it. */
const LENGTH_AXIS = { horizontal: "x", vertical: "y", frontal: "x" } as const;
/** Edge names by the cabinet direction they face: axis and end. */
const EDGE_SIDES = {
  left: ["x", 0],
  right: ["x", 1],
  bottom: ["y", 0],
  top: ["y", 1],
  rear: ["z", 0],
  front: ["z", 1],
} as const;

/** Evaluates one formula against a scope; undefined when it cannot be calculated. */
function evalIn(v: string | number, scope: ReadonlyMap<string, number>): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const r = evaluateGraph(new Map([["__c", v]]), scope);
  const x = r.values.get("__c");
  return x === undefined || r.diagnostics.length || !Number.isFinite(x) ? undefined : x;
}

/** Copies of a repeated element: scopes with `i` and `n`, or one plain scope. */
function copies(
  repeat: string | number | undefined,
  scope: ReadonlyMap<string, number>,
  max: number,
  bad: (expr: string) => void,
): { scope: ReadonlyMap<string, number>; i: number | undefined }[] {
  if (repeat === undefined) return [{ scope, i: undefined }];
  const n = evalIn(repeat, scope);
  if (n === undefined || !Number.isInteger(n) || n < 0 || n > max) {
    bad(String(repeat));
    return [];
  }
  return Array.from({ length: n }, (_, k) => ({ scope: new Map([...scope, ["i", k + 1], ["n", n]]), i: k + 1 }));
}

export function buildCustomParts(a: {
  rc: ResolvedCabinet;
  library: Library;
  /** Cabinet values plus the zone edges. */
  scope: ReadonlyMap<string, number>;
  add: AddPart;
  parts: Part[];
  diagnostics: Diagnostic[];
}): BoxLayout["custom"] {
  const { rc, library, add, parts, diagnostics } = a;
  const cab = rc.cabinet.id;
  const out: BoxLayout["custom"] = [];
  const taken = new Set(parts.map((p) => p.code));
  const roleCodes = new Set<string>(Object.values(ROLE_CODES));

  for (const def of rc.cabinet.construction?.parts ?? []) {
    const invalid = (what: string, expr: string): void => {
      diagnostics.push({ severity: "error", code: "custom_part_invalid", params: { part: def.id, what, expr }, cabinet: cab });
    };
    // A code the box rule uses (SL, SH2, …) would break stable numbering.
    if (roleCodes.has(def.id.replace(/\d+$/, ""))) {
      diagnostics.push({ severity: "error", code: "custom_part_code_reserved", params: { part: def.id }, cabinet: cab });
      continue;
    }
    for (const { scope, i } of copies(def.repeat, a.scope, 200, (e) => invalid("repeat", e))) {
      const code = def.id + (i ?? "");
      if (def.when !== undefined) {
        const w = evalIn(def.when, scope);
        if (w === undefined) {
          invalid("when", String(def.when));
          continue;
        }
        if (w === 0) continue;
      }
      if (taken.has(code)) {
        diagnostics.push({ severity: "error", code: "custom_part_duplicate", params: { part: code }, cabinet: cab });
        continue;
      }
      const made = customBox(def, scope, rc, library, code, invalid, diagnostics);
      if (!made) continue;
      taken.add(code);
      add("custom", undefined, made.box, made.lengthAxis, made.widthAxis, "material.carcase", made.edges, {
        code,
        material: made.material,
        ...(def.name !== undefined ? { label: def.name } : {}),
        ...(def.note ? { note: def.note } : {}),
      });
      out.push({ code, joint: def.joint === "auto" });
    }
  }
  return out;
}

function customBox(
  def: CustomPartInput,
  scope: ReadonlyMap<string, number>,
  rc: ResolvedCabinet,
  library: Library,
  code: string,
  invalid: (what: string, expr: string) => void,
  diagnostics: Diagnostic[],
): { box: Box; lengthAxis: Axis; widthAxis: Axis; material: string; edges: PartEdges } | undefined {
  const cab = rc.cabinet.id;
  // Material: a material option of the cabinet, or a library id; a part override wins (as for every part).
  const ref = rc.cabinet.parts[code]?.material ?? def.material;
  const material = OPTION_BY_KEY.get(ref)?.kind.type === "material" ? (rc.options.get(ref)!.value as string) : ref;
  const mat = library.materials.get(material);
  if (!mat) {
    diagnostics.push({ severity: "error", code: "material_unknown", params: { key: code, value: material }, cabinet: cab, part: `${cab}-${code}` });
    return undefined;
  }
  const tAxis = PLANE_AXIS[def.plane];
  const num = (key: "x" | "y" | "z" | "dx" | "dy" | "dz"): number | undefined => {
    const v = def[key];
    if (v === undefined) {
      if (key === `d${tAxis}`) return mat.thickness;
      invalid(key, "");
      return undefined;
    }
    const x = evalIn(v, scope);
    if (x === undefined) invalid(key, String(v));
    return x;
  };
  const vals = (["x", "y", "z", "dx", "dy", "dz"] as const).map(num);
  if (vals.some((v) => v === undefined)) return undefined;
  const [x, y, z, dx, dy, dz] = vals as number[];
  const box: Box = { x: x!, y: y!, z: z!, dx: dx!, dy: dy!, dz: dz! };

  const inPlane = (["x", "y", "z"] as const).filter((ax) => ax !== tAxis);
  const lengthAxis: Axis = def.grain && def.grain !== tAxis ? def.grain : LENGTH_AXIS[def.plane];
  const widthAxis = inPlane.find((ax) => ax !== lengthAxis)!;

  // Edges: named by direction in the cabinet, stored by length/width (D4).
  const edges: PartEdges = { l1: null, l2: null, w1: null, w2: null };
  for (const [name, [axis, end]] of Object.entries(EDGE_SIDES) as [keyof typeof EDGE_SIDES, readonly [Axis, 0 | 1]][]) {
    const e = def.edges[name];
    if (e === undefined || e === null || axis === tAxis) continue;
    const band = OPTION_BY_KEY.get(e)?.kind.type === "edgeband" ? (rc.options.get(e)!.value as string | null) : e;
    // The edge across the width axis is a long edge (l1/l2), across the length axis a short one (w1/w2).
    const key = (axis === widthAxis ? (end ? "l2" : "l1") : end ? "w2" : "w1") as keyof PartEdges;
    edges[key] = band;
  }
  return { box, lengthAxis, widthAxis, material, edges };
}

/** Roles a free part is never dowelled to: fronts, loose shelves, thin backs, drawer boxes. */
const NO_JOINT = new Set<Part["role"]>([
  "door",
  "blind_panel",
  "appliance_front",
  "flap",
  "ceiling_filler",
  "drawer_front",
  "drawer_side_left",
  "drawer_side_right",
  "drawer_inner",
  "drawer_back",
  "drawer_bottom",
  "shelf",
  "back",
  "worktop",
  "plinth",
]);

/**
 * Butt joints of free parts: wherever an end of a part marked `joint: auto`
 * lies on the face of another panel, over the length they share. The
 * construction method (dowels, connectors) then fills them like every
 * carcase joint.
 */
export function customJoints(parts: Part[], custom: BoxLayout["custom"]): Joint[] {
  const joints: Joint[] = [];
  const auto = new Set(custom.filter((c) => c.joint).map((c) => c.code));
  const tAx = (p: Part): Axis => thicknessAxis(p.lengthAxis, p.widthAxis);
  const hi = (p: Part, ax: Axis): number => p.box[ax] + boxSize(p.box, ax);
  for (const p of parts) {
    if (!auto.has(p.code)) continue;
    const across = tAx(p);
    for (const a of [p.lengthAxis, p.widthAxis]) {
      const line = a === p.lengthAxis ? p.widthAxis : p.lengthAxis;
      for (const end of [0, 1] as const) {
        const plane = end ? hi(p, a) : p.box[a];
        for (const q of parts) {
          if (q === p || NO_JOINT.has(q.role) || tAx(q) !== a) continue;
          // q's face lies in the plane, on the far side of p's end.
          if (Math.abs((end ? q.box[a] : hi(q, a)) - plane) > 0.01) continue;
          // p's whole thickness must sit on q, and they must share a stretch along the joint.
          if (p.box[across] < q.box[across] - 0.01 || hi(p, across) > hi(q, across) + 0.01) continue;
          if (Math.min(hi(p, line), hi(q, line)) - Math.max(p.box[line], q.box[line]) <= 0.01) continue;
          joints.push({
            ref: `${q.code}-${p.code}`,
            facePart: q,
            edgePart: p,
            plane: { axis: a, value: plane },
            intoFace: `${end ? "+" : "-"}${a}` as Direction,
            across: { axis: across, value: p.box[across] + boxSize(p.box, across) / 2 },
            line,
          });
        }
      }
    }
  }
  return joints;
}

/** Free bores (D45), in part-local coordinates; problems become diagnostics, never exceptions. */
export function applyCustomBores(rc: ResolvedCabinet, parts: Part[], diagnostics: Diagnostic[]): void {
  const cab = rc.cabinet.id;
  const byCode = new Map(parts.map((p) => [p.code, p]));
  const mode = rc.options.get("bore.through")!.value as ThroughMode;
  const overlap = rc.values.get("through_overlap") ?? 0;
  (rc.cabinet.construction?.bores ?? []).forEach((def, k) => {
    const index = k + 1;
    const part = byCode.get(def.part);
    if (!part) {
      diagnostics.push({ severity: "warning", code: "custom_bore_part_unknown", params: { index, part: def.part }, cabinet: cab });
      return;
    }
    const invalid = (what: string, expr: string): void => {
      diagnostics.push({ severity: "error", code: "custom_bore_invalid", params: { index, part: def.part, what, expr }, cabinet: cab, part: part.id });
    };
    const base = new Map([...rc.values, ["part_l", part.length], ["part_w", part.width], ["part_t", part.thickness]]);
    for (const { scope } of copies(def.repeat, base, 500, (e) => invalid("repeat", e))) {
      if (def.when !== undefined) {
        const w = evalIn(def.when, scope);
        if (w === undefined) invalid("when", String(def.when));
        if (!w) continue;
      }
      const get = (key: "u" | "v" | "d" | "depth"): number | undefined => {
        if (key === "depth" && def.depth === "through") return 0;
        const x = evalIn(def[key], scope);
        if (x === undefined) invalid(key, String(def[key]));
        return x;
      };
      const [u, v, d, depth] = [get("u"), get("v"), get("d"), get("depth")];
      if (u === undefined || v === undefined || d === undefined || depth === undefined) continue;
      const placed = placeBore(part, def.face, u, v);
      if (d <= 0 || depth < 0 || !placed) {
        diagnostics.push({ severity: "error", code: "custom_bore_outside", params: { index, part: def.part, u: roundMm(u), v: roundMm(v) }, cabinet: cab, part: part.id });
        continue;
      }
      const source: OpSource = { kind: "custom", ref: `bore ${index}` };
      const wide = def.face === "t0" || def.face === "t1";
      if (wide && (depth === 0 || depth >= part.thickness)) addThroughBore(part, placed.entry, placed.dir, d, mode, overlap, source);
      else if (depth === 0 || depth > placed.room) {
        diagnostics.push({ severity: "error", code: "custom_bore_outside", params: { index, part: def.part, u: roundMm(u), v: roundMm(v) }, cabinet: cab, part: part.id });
      } else addBore(part, placed.entry, placed.dir, d, depth, source);
    }
  });
}

/** Entry point, drilling direction and material behind the entry for a bore at (u, v) on a face. */
function placeBore(part: Part, face: Face, u: number, v: number): { entry: { x: number; y: number; z: number }; dir: Direction; room: number } | undefined {
  const T = part.thickness;
  const tAxis = thicknessAxis(part.lengthAxis, part.widthAxis);
  const inside = (x: number, max: number): boolean => x >= 0 && x <= max;
  let local: { u: number; v: number; w: number };
  let axis: Axis;
  let room: number;
  if (face === "t0" || face === "t1") {
    if (!inside(u, part.length) || !inside(v, part.width)) return undefined;
    local = { u, v, w: face === "t0" ? 0 : T };
    axis = tAxis;
    room = T;
  } else if (face === "l1" || face === "l2") {
    // Long edges: u along the length, v across the thickness.
    if (!inside(u, part.length) || !inside(v, T)) return undefined;
    local = { u, v: face === "l1" ? 0 : part.width, w: v };
    axis = part.widthAxis;
    room = part.width;
  } else {
    // Short edges: u along the width, v across the thickness.
    if (!inside(u, part.width) || !inside(v, T)) return undefined;
    local = { u: face === "w1" ? 0 : part.length, v: u, w: v };
    axis = part.lengthAxis;
    room = part.length;
  }
  const positive = face === "t0" || face === "l1" || face === "w1";
  return { entry: toCabinet(part, local), dir: `${positive ? "+" : "-"}${axis}` as Direction, room };
}
