import { toLocal, type Operation, type Part, type ProjectResult } from "../src/index.ts";

/**
 * Geometric invariants of an accepted cabinet, checked independently of the
 * engine's own checker: what must hold for every cabinet the engine lets
 * through to the cutlist and the CNC files.
 */
export interface Violation {
  rule: string;
  detail: string;
}

const EPS = 0.011; // one rounding step
const FRONT_ROLES = ["door", "blind_panel", "appliance_front", "flap", "drawer_front"];
const AXES = ["x", "y", "z"] as const;

const sizeOf = (p: Part, a: "u" | "v" | "w"): number => (a === "u" ? p.length : a === "v" ? p.width : p.thickness);

/** Bounds of the material an operation removes, part-local. */
function bounds(op: Operation): Record<"u0" | "u1" | "v0" | "v1" | "w0" | "w1", number> {
  if (op.kind === "pocket") return op;
  const n = op.face[0] === "t" ? "w" : op.face[0] === "l" ? "v" : "u";
  const atMax = op.face === "t1" || op.face === "l2" || op.face === "w2";
  const b = { u0: op.u, u1: op.u, v0: op.v, v1: op.v, w0: op.w, w1: op.w };
  for (const a of ["u", "v", "w"] as const) {
    if (a === n) {
      if (atMax) b[`${a}0`] = op[a] - op.depth;
      else b[`${a}1`] = op[a] + op.depth;
    } else {
      b[`${a}0`] = op[a] - op.d / 2;
      b[`${a}1`] = op[a] + op.d / 2;
    }
  }
  return b;
}

const overlap = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>): boolean =>
  (["u", "v", "w"] as const).every((k) => a[`${k}0`] < b[`${k}1`] - 1e-6 && b[`${k}0`] < a[`${k}1`] - 1e-6);

export function violations(r: ProjectResult, cabinetIndex = 0): Violation[] {
  const out: Violation[] = [];
  const bad = (rule: string, detail: string): void => void out.push({ rule, detail });
  const c = r.cabinets[cabinetIndex]!;
  const v = (n: string): number => c.resolved.values.get(n)!;
  const W = v("W");
  const H = v("H");
  const D = v("D");
  const minWall = v("bore_min_wall");
  const parts = c.parts;

  // --- Sizes ------------------------------------------------------------------------
  for (const p of parts) {
    const nums = [p.length, p.width, p.thickness, p.cutLength, p.cutWidth, p.box.x, p.box.y, p.box.z, p.box.dx, p.box.dy, p.box.dz];
    if (nums.some((n) => !Number.isFinite(n))) bad("finite", p.id);
    if (!(p.length > 0 && p.width > 0 && p.thickness > 0 && p.cutLength > 0 && p.cutWidth > 0)) bad("positive size", p.id);
    if (p.cutLength > p.length + EPS || p.cutWidth > p.width + EPS) bad("cut size above finished size", p.id);
    // Inside the cabinet: carcase plus front thickness; fronts may hang below with a negative bottom gap.
    if (p.role === "ceiling_filler") continue;
    const b = p.box;
    const yMin = Math.min(0, v("front_gap_bottom"));
    if (b.x < -EPS || b.x + b.dx > W + EPS || b.y < yMin - EPS || b.y + b.dy > H + EPS || b.z < -EPS || b.z + b.dz > D + v("t_front") + EPS) {
      bad("inside the cabinet", `${p.id} x${b.x}+${b.dx} y${b.y}+${b.dy} z${b.z}+${b.dz}`);
    }
  }

  // --- Machining ----------------------------------------------------------------------
  for (const p of parts) {
    const ops = p.operations;
    for (const op of ops) {
      const b = bounds(op);
      if (Object.values(b).some((n) => typeof n === "number" && !Number.isFinite(n))) bad("finite operation", p.id);
      if (op.kind === "pocket") {
        if (!(op.u0 < op.u1 && op.v0 < op.v1 && op.w0 < op.w1)) bad("pocket has volume", p.id);
        if (op.u0 < -EPS || op.v0 < -EPS || op.w0 < -EPS || op.u1 > p.length + EPS || op.v1 > p.width + EPS || op.w1 > p.thickness + EPS) bad("pocket inside its part", p.id);
        continue;
      }
      if (!(op.d > 0 && op.depth > 0)) bad("bore has a diameter and a depth", `${p.id} Ø${op.d} × ${op.depth}`);
      const n = op.face[0] === "t" ? "w" : op.face[0] === "l" ? "v" : "u";
      const atMax = op.face === "t1" || op.face === "l2" || op.face === "w2";
      if (Math.abs(op[n] - (atMax ? sizeOf(p, n) : 0)) > EPS) bad("bore enters on its face", p.id);
      for (const a of ["u", "v", "w"] as const) {
        if (a === n) {
          // Remaining wall behind the bore, unless it goes through on purpose.
          const wall = sizeOf(p, a) - op.depth;
          if (!op.through && wall < minWall - EPS) bad("bore leaves the remaining wall", `${p.id} ${op.sources[0]!.ref} wall ${wall}`);
          if (op.through && Math.abs(op.depth - sizeOf(p, a)) > EPS) bad("through bore is as deep as the part", p.id);
        } else if (b[`${a}0`] < minWall - EPS || b[`${a}1`] > sizeOf(p, a) - minWall + EPS) {
          bad("bore keeps the wall to the edges", `${p.id} ${op.sources[0]!.ref} ${a} ${b[`${a}0`]}…${b[`${a}1`]} of ${sizeOf(p, a)}`);
        }
      }
    }
    for (let i = 0; i < ops.length; i++) {
      for (let j = i + 1; j < ops.length; j++) {
        const a = ops[i]!;
        const b = ops[j]!;
        if (a.kind === "pocket" && b.kind === "pocket") continue; // pockets may meet (D17)
        const group = a.sources.some((s) => s.group !== undefined && b.sources.some((t) => t.group === s.group));
        const halves = a.kind === "bore" && b.kind === "bore" && a.split && b.split && a.face !== b.face && Math.abs(a.u - b.u) < EPS && Math.abs(a.v - b.v) < EPS;
        if (group || halves) continue;
        if (overlap(bounds(a), bounds(b))) bad("operations do not collide", `${p.id} ${a.sources[0]!.ref} / ${b.sources[0]!.ref}`);
      }
    }
  }

  // --- Parts do not occupy the same space, except inside a pocket (groove, rebate, notch) ---
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const A = parts[i]!;
      const B = parts[j]!;
      const lo = { x: 0, y: 0, z: 0 };
      const hi = { x: 0, y: 0, z: 0 };
      for (const k of AXES) {
        lo[k] = Math.max(A.box[k], B.box[k]);
        hi[k] = Math.min(A.box[k] + A.box[`d${k}`], B.box[k] + B.box[`d${k}`]);
      }
      if (AXES.some((k) => hi[k] - lo[k] <= 2 * EPS)) continue;
      const pocketed = [A, B].some((P) =>
        P.operations.some((o) => {
          if (o.kind !== "pocket") return false;
          const a = toLocal(P, lo);
          const b = toLocal(P, hi);
          const e = 0.6; // play and clearance of the groove
          return o.u0 <= a.u + e && o.u1 >= b.u - e && o.v0 <= a.v + e && o.v1 >= b.v - e && o.w0 <= a.w + e && o.w1 >= b.w - e;
        }),
      );
      if (!pocketed) bad("parts do not intersect", `${A.id} / ${B.id} by ${AXES.map((k) => Math.round((hi[k] - lo[k]) * 100) / 100).join(" × ")}`);
    }
  }

  // --- Fronts ---------------------------------------------------------------------------
  const zones = c.layout?.zones ?? [];
  if (zones.length) {
    const g = v("front_gap");
    // Heights and gaps add up to the carcase height, top to bottom.
    if (Math.abs(zones[0]!.y1 - (H - v("front_gap_top"))) > EPS) bad("top front gap", `${zones[0]!.y1}`);
    if (Math.abs(zones[zones.length - 1]!.y0 - v("front_gap_bottom")) > EPS) bad("bottom front gap", `${zones[zones.length - 1]!.y0}`);
    for (let i = 0; i + 1 < zones.length; i++) {
      if (Math.abs(zones[i]!.y0 - zones[i + 1]!.y1 - g) > EPS) bad("gap between stacked fronts", `zone ${i + 1}: ${zones[i]!.y0 - zones[i + 1]!.y1}`);
    }
    const sum = zones.reduce((s, z) => s + (z.y1 - z.y0), 0) + g * (zones.length - 1) + v("front_gap_top") + v("front_gap_bottom");
    if (Math.abs(sum - H) > EPS * zones.length) bad("front heights and gaps add up to H", `${sum} / ${H}`);
    // Across: the fronts of a zone cover the width between the side gaps, with the middle gap between them.
    const fronts = parts.filter((p) => FRONT_ROLES.includes(p.role));
    for (const [i, z] of zones.entries()) {
      const row = fronts.filter((p) => Math.abs(p.box.y - z.y0) < EPS && Math.abs(p.box.y + p.box.dy - z.y1) < EPS).sort((a, b) => a.box.x - b.box.x);
      const expectFront = z.type === "door" || z.type === "drawer" || z.type === "panel" || z.type === "flap";
      if (!expectFront) continue;
      if (row.length === 0) {
        bad("zone has its front", `zone ${i + 1} (${z.type})`);
        continue;
      }
      if (Math.abs(row[0]!.box.x - v("front_gap_left")) > EPS) bad("left front gap", `zone ${i + 1}: ${row[0]!.box.x}`);
      const last = row[row.length - 1]!.box;
      if (Math.abs(W - (last.x + last.dx) - v("front_gap_right")) > EPS) bad("right front gap", `zone ${i + 1}: ${W - last.x - last.dx}`);
      for (let k = 0; k + 1 < row.length; k++) {
        const gap = row[k + 1]!.box.x - (row[k]!.box.x + row[k]!.box.dx);
        if (Math.abs(gap - v("front_gap_middle")) > EPS) bad("gap between fronts side by side", `zone ${i + 1}: ${gap}`);
      }
      for (const p of row) if (Math.abs(p.box.z - D) > EPS) bad("fronts sit on the carcase front", p.id);
    }
    // Every front belongs to a zone.
    for (const p of fronts) {
      if (!zones.some((z) => Math.abs(p.box.y - z.y0) < EPS && Math.abs(p.box.y + p.box.dy - z.y1) < EPS)) bad("front lies in a zone", p.id);
    }
  }
  return out;
}
