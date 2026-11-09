import type { OpSource } from "../ops.ts";
import type { Part } from "../part.ts";
import type { ResolvedStyle, Rule, Selector } from "./style.ts";
import { dot, faceNormal, type PartView, type Side } from "./view.ts";

/** A machining feature in drawing coordinates (mm, origin bottom-left, Y up). */
export interface DFeature {
  op: "bore" | "pocket";
  /** face: on the viewed face; far: on the opposite face; edge: in an edge. */
  where: "face" | "far" | "edge";
  /** For edge features: the drawing side they enter from. */
  side?: Side;
  /** Bore entry point (for pockets: the rectangle centre). */
  X: number;
  Y: number;
  d: number;
  depth: number;
  /** Pockets: rectangle in drawing coordinates. */
  rect?: { x0: number; y0: number; x1: number; y1: number };
  sources: OpSource[];
}

/** A regular row (axis x) or column (axis y) of equal features. */
export interface Pattern {
  axis: "x" | "y";
  /** The common coordinate (Y for rows, X for columns). */
  at: number;
  start: number;
  pitch: number;
  count: number;
}

export interface GroupRules {
  positions: "all" | "pattern" | "none";
  tag: boolean;
  table: boolean;
  hide: boolean;
  label?: string;
}

export interface FeatureGroup {
  key: string;
  tag: string;
  op: "bore" | "pocket";
  where: "face" | "far" | "edge";
  side?: Side;
  d: number;
  depth: number;
  sources: OpSource[];
  features: DFeature[];
  patterns: Pattern[];
  /** Features not in any pattern. */
  singles: DFeature[];
  rules: GroupRules;
}

const r2 = (x: number): number => {
  const v = Math.round(x * 100) / 100;
  return v === 0 ? 0 : v;
};

export function extractFeatures(view: PartView): DFeature[] {
  const part = view.part;
  const out: DFeature[] = [];
  const sideOfNormal = (nrm: readonly number[]): Side | undefined => {
    const x = dot(nrm as [number, number, number], view.r);
    const y = dot(nrm as [number, number, number], view.p);
    if (x > 0.5) return "right";
    if (x < -0.5) return "left";
    if (y > 0.5) return "top";
    if (y < -0.5) return "bottom";
    return undefined;
  };
  for (const op of part.operations) {
    const nrm = faceNormal(part, op.face);
    const facing = dot(nrm, view.n);
    const where: DFeature["where"] = facing > 0.5 ? "face" : facing < -0.5 ? "far" : "edge";
    const side = where === "edge" ? sideOfNormal(nrm) : undefined;
    if (op.kind === "bore") {
      const at = view.projectLocal(op);
      out.push({ op: "bore", where, ...(side ? { side } : {}), X: at.X, Y: at.Y, d: op.d, depth: op.depth, sources: op.sources });
    } else {
      const a = view.projectLocal({ u: op.u0, v: op.v0, w: op.w0 });
      const b = view.projectLocal({ u: op.u1, v: op.v1, w: op.w1 });
      const rect = { x0: Math.min(a.X, b.X), y0: Math.min(a.Y, b.Y), x1: Math.max(a.X, b.X), y1: Math.max(a.Y, b.Y) };
      const ext = op.face === "t0" || op.face === "t1" ? op.w1 - op.w0 : op.face === "l1" || op.face === "l2" ? op.v1 - op.v0 : op.u1 - op.u0;
      out.push({
        op: "pocket",
        where,
        ...(side ? { side } : {}),
        X: r2((rect.x0 + rect.x1) / 2),
        Y: r2((rect.y0 + rect.y1) / 2),
        d: 0,
        depth: r2(ext),
        rect,
        sources: op.sources,
      });
    }
  }
  return out;
}

function matches(sel: Selector, g: { op: string; where: string; d: number; sources: OpSource[] }, part: Part): boolean {
  if (sel.source && !g.sources.some((s) => sel.source!.includes(s.kind))) return false;
  if (sel.ref !== undefined && !g.sources.some((s) => s.ref.startsWith(sel.ref!))) return false;
  if (sel.where && !sel.where.includes(g.where as never)) return false;
  if (sel.op && !sel.op.includes(g.op as never)) return false;
  if (sel.d !== undefined && Math.abs(sel.d - g.d) > 1e-6) return false;
  if (sel.role && !sel.role.includes(part.role)) return false;
  if (sel.part !== undefined && sel.part !== part.id) return false;
  return true;
}

/** Property cascade: for each setting, the first matching rule that sets it wins. */
export function rulesFor(rules: readonly Rule[], g: Parameters<typeof matches>[1], part: Part): GroupRules {
  const out: Partial<GroupRules> = {};
  for (const r of rules) {
    if (!matches(r.match, g, part)) continue;
    if (out.positions === undefined && r.positions !== undefined) out.positions = r.positions;
    if (out.tag === undefined && r.tag !== undefined) out.tag = r.tag;
    if (out.table === undefined && r.table !== undefined) out.table = r.table;
    if (out.hide === undefined && r.hide !== undefined) out.hide = r.hide;
    if (out.label === undefined && r.label !== undefined) out.label = r.label;
  }
  return {
    positions: out.positions ?? "all",
    tag: out.tag ?? true,
    table: out.table ?? false,
    hide: out.hide ?? false,
    ...(out.label !== undefined ? { label: out.label } : {}),
  };
}

const sourceKey = (s: OpSource[]): string => s.map((x) => `${x.kind}:${x.ref}`).join("+");

/**
 * Groups features that are dimensioned and labelled together: same sources,
 * operation, placement, diameter and depth. Groups are ordered by first
 * appearance in the part's operation list, so tags are stable.
 */
export function groupFeatures(features: DFeature[], part: Part, style: ResolvedStyle): FeatureGroup[] {
  const groups = new Map<string, FeatureGroup>();
  for (const f of features) {
    const key = [sourceKey(f.sources), f.op, f.where, f.side ?? "", f.d, f.depth].join("|");
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        tag: "",
        op: f.op,
        where: f.where,
        ...(f.side ? { side: f.side } : {}),
        d: f.d,
        depth: f.depth,
        sources: f.sources,
        features: [],
        patterns: [],
        singles: [],
        rules: { positions: "all", tag: true, table: false, hide: false },
      };
      groups.set(key, g);
    }
    g.features.push(f);
  }
  const out = [...groups.values()];
  let letter = 0;
  for (const g of out) {
    g.rules = rulesFor(style.rules, g, part);
    if (g.op === "bore") {
      const { patterns, singles } = findPatterns(g.features, style.dims.patternMin);
      g.patterns = patterns;
      g.singles = singles;
    } else {
      g.singles = g.features;
    }
    if (!g.rules.hide && g.rules.tag) g.tag = tagName(letter++);
  }
  return out;
}

export const tagName = (i: number): string =>
  i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));

/**
 * Finds rows (equal Y) and then columns (equal X) of at least `min`
 * features at a constant pitch. Everything else stays single.
 */
export function findPatterns(features: DFeature[], min: number): { patterns: Pattern[]; singles: DFeature[] } {
  const patterns: Pattern[] = [];
  let rest = [...features];
  for (const axis of ["x", "y"] as const) {
    const along = (f: DFeature): number => (axis === "x" ? f.X : f.Y);
    const across = (f: DFeature): number => (axis === "x" ? f.Y : f.X);
    const lines = new Map<number, DFeature[]>();
    for (const f of rest) {
      const k = r2(across(f));
      lines.set(k, [...(lines.get(k) ?? []), f]);
    }
    const used = new Set<DFeature>();
    for (const [at, line] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
      const sorted = [...line].sort((a, b) => along(a) - along(b));
      let i = 0;
      while (i < sorted.length - 1) {
        const pitch = r2(along(sorted[i + 1]!) - along(sorted[i]!));
        let j = i + 1;
        while (j + 1 < sorted.length && Math.abs(r2(along(sorted[j + 1]!) - along(sorted[j]!)) - pitch) < 0.011) j++;
        const count = j - i + 1;
        if (count >= min && pitch > 0) {
          patterns.push({ axis, at, start: along(sorted[i]!), pitch, count });
          for (let k = i; k <= j; k++) used.add(sorted[k]!);
          i = j + 1;
        } else {
          i++;
        }
      }
    }
    rest = rest.filter((f) => !used.has(f));
  }
  return { patterns, singles: rest };
}
