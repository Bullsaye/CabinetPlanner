import { z } from "zod";
import { LocalizedText } from "../text.ts";
import { ASSEMBLY_VIEW_UPRIGHT, MACHINE_VIEW, type ViewSpec } from "./view.ts";

/**
 * Drawing styles (DECISIONS.md D20). A style says how parts are laid out
 * and dimensioned. Styles are data: shops copy a factory style, change
 * settings and add rules. Rules are how the app gets "taught": each user
 * correction in the drawing becomes a rule with a selector for the features
 * it applies to (see docs/DRAWINGS.md).
 */
const Dir = z.enum(["left", "right", "bottom", "top", "rear", "front"]);
const Side = z.enum(["bottom", "top", "left", "right"]);
const ViewSpecSchema = z.object({
  face: z.enum(["machined", "inner", "outer", "t0", "t1"]),
  anchors: z.array(z.object({ edge: Dir, side: Side })).min(1),
});

const Role = z.enum([
  "side_left",
  "side_right",
  "bottom",
  "top",
  "rail_front",
  "rail_rear",
  "back",
  "shelf",
  "partition",
  "fixed_shelf",
  "door",
  "blind_panel",
  "appliance_front",
  "worktop",
  "plinth",
  "drawer_front",
  "drawer_side_left",
  "drawer_side_right",
  "drawer_inner",
  "drawer_back",
  "drawer_bottom",
]);

/** Which features a rule applies to; every given field must match. */
export const Selector = z.object({
  /** Source kinds: system, joint, hardware, back. */
  source: z.array(z.enum(["system", "joint", "hardware", "back"])).optional(),
  /** Source reference starts with this, e.g. "SL-" or "grass-". */
  ref: z.string().optional(),
  /** Where the feature sits relative to the view. */
  where: z.array(z.enum(["face", "far", "edge"])).optional(),
  op: z.array(z.enum(["bore", "pocket"])).optional(),
  d: z.number().optional(),
  role: z.array(Role).optional(),
  part: z.string().optional(),
});
export type Selector = z.infer<typeof Selector>;

/**
 * What to do with matching features. Unset fields fall through to later
 * rules (a property cascade), so a taught rule only changes what it names.
 */
export const Rule = z.object({
  match: Selector.default({}),
  /** Positions put on the dimension axes: all, first/last of patterns, none. */
  positions: z.enum(["all", "pattern", "none"]).optional(),
  /** Tag the group with a letter and list it in the legend. */
  tag: z.boolean().optional(),
  /** List every hole of the group in the coordinate table. */
  table: z.boolean().optional(),
  /** Do not draw the features at all. */
  hide: z.boolean().optional(),
  /** Free legend text instead of the generated description. */
  label: z.string().optional(),
  /** Note why the rule exists, e.g. who taught it. */
  note: z.string().optional(),
});
export type Rule = z.infer<typeof Rule>;

export const DrawingStyleSchema = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  /** Inherit everything from another style; `rules` are prepended to its rules. */
  extends: z.string().optional(),
  view: z
    .object({
      default: ViewSpecSchema,
      /** Per-role views, e.g. horizontal parts flipped in the assembly view. */
      roles: z.record(z.string(), ViewSpecSchema).default({}),
    })
    .optional(),
  dims: z
    .object({
      /** running: every position from the origin (ISO parallel/running). chain: from feature to feature. */
      mode: z.enum(["running", "chain"]).optional(),
      /** horizontal: all numbers upright (easiest to read). aligned: ISO, along the dimension line. */
      text: z.enum(["horizontal", "aligned"]).optional(),
      /** Overall length and width. */
      overall: z.boolean().optional(),
      /** Maximum decimals shown. */
      decimals: z.number().int().min(0).max(2).optional(),
      /** Text height on paper in mm (ISO: 2.5 min. for dimensions). */
      textHeight: z.number().min(1.8).max(7).optional(),
      /** Dimension line ends: oblique ticks (ISO alternative), arrows or dots. */
      terminator: z.enum(["tick", "arrow", "dot"]).optional(),
      /** Minimum holes in a row for a pattern note. */
      patternMin: z.number().int().min(2).max(50).optional(),
    })
    .optional(),
  show: z
    .object({
      tags: z.boolean().optional(),
      legend: z.boolean().optional(),
      table: z.boolean().optional(),
      edgeNames: z.boolean().optional(),
      centreMarks: z.boolean().optional(),
      /** One sheet per machined side when both faces have machining. */
      bothSides: z.boolean().optional(),
    })
    .optional(),
  paper: z
    .object({
      size: z.enum(["A4", "A3"]).optional(),
      /** auto: portrait for parts taller than wide. */
      orientation: z.enum(["auto", "landscape", "portrait"]).optional(),
      /** Scale denominator, or "auto" for the largest standard scale that fits. */
      scale: z.union([z.literal("auto"), z.number().positive()]).optional(),
    })
    .optional(),
  rules: z.array(Rule).default([]),
});
export type DrawingStyleInput = z.infer<typeof DrawingStyleSchema>;

/** A style with every setting filled, after inheritance. */
export interface ResolvedStyle {
  id: string;
  view: { default: ViewSpec; roles: Record<string, ViewSpec> };
  dims: {
    mode: "running" | "chain";
    text: "horizontal" | "aligned";
    overall: boolean;
    decimals: number;
    textHeight: number;
    patternMin: number;
    terminator: "tick" | "arrow" | "dot";
  };
  show: { tags: boolean; legend: boolean; table: boolean; edgeNames: boolean; centreMarks: boolean; bothSides: boolean };
  paper: { size: "A4" | "A3"; orientation: "auto" | "landscape" | "portrait"; scale: "auto" | number };
  rules: Rule[];
}

const BASE_RULES: Rule[] = [
  // System holes are dimensioned as patterns: row distance, first and last hole.
  { match: { source: ["system"] }, positions: "pattern", tag: true, table: false },
  { match: { source: ["back"] }, positions: "all", tag: true },
  { match: {}, positions: "all", tag: true, table: true },
];

// Flat parts look the same on every part sheet (machine view), so two sheets
// of the same part can never show it turned around.
const flatRoles = Object.fromEntries(
  ["bottom", "top", "rail_front", "rail_rear", "shelf"].map((r) => [r, MACHINE_VIEW]),
);

export const FACTORY_STYLES: readonly DrawingStyleInput[] = [
  {
    id: "machine",
    name: { en: "Machine sheet", de: "Maschinenblatt" },
    view: { default: MACHINE_VIEW, roles: {} },
    dims: { mode: "running", text: "horizontal", overall: true, decimals: 2, textHeight: 2.5, patternMin: 3, terminator: "tick" },
    show: { tags: true, legend: true, table: false, edgeNames: true, centreMarks: true, bothSides: true },
    paper: { size: "A4", orientation: "auto", scale: "auto" },
    rules: BASE_RULES,
  },
  {
    id: "machine-iso",
    name: { en: "Machine sheet, ISO running dimensions", de: "Maschinenblatt, ISO-Steigungsbemaßung" },
    extends: "machine",
    dims: { text: "aligned" },
    rules: [],
  },
  {
    id: "machine-chain",
    name: { en: "Machine sheet, chain dimensions", de: "Maschinenblatt, Kettenbemaßung" },
    extends: "machine",
    dims: { mode: "chain" },
    rules: [],
  },
  {
    id: "upright",
    name: { en: "Part sheet, sides upright", de: "Teileblatt, Seiten stehend" },
    extends: "machine",
    view: { default: ASSEMBLY_VIEW_UPRIGHT, roles: flatRoles },
    show: { table: true },
    rules: [],
  },
];

export function parseStyle(raw: unknown): DrawingStyleInput {
  return DrawingStyleSchema.parse(raw);
}

/**
 * Resolves a style by id through its `extends` chain. Later styles override
 * scalar settings; their rules come first (more specific wins).
 */
export function resolveStyle(id: string, styles: readonly DrawingStyleInput[] = FACTORY_STYLES): ResolvedStyle {
  const byId = new Map<string, DrawingStyleInput>();
  for (const s of FACTORY_STYLES) byId.set(s.id, s);
  for (const s of styles) byId.set(s.id, s);
  const chain: DrawingStyleInput[] = [];
  let cur = byId.get(id);
  if (!cur) throw new Error(`unknown drawing style "${id}"`);
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) throw new Error(`drawing style "${cur.id}" extends itself`);
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.extends ? byId.get(cur.extends) : undefined;
    if (chain[0]!.extends && !cur) throw new Error(`drawing style "${chain[0]!.id}" extends unknown "${chain[0]!.extends}"`);
  }
  const out: ResolvedStyle = {
    id,
    view: { default: MACHINE_VIEW, roles: {} },
    dims: { mode: "running", text: "horizontal", overall: true, decimals: 2, textHeight: 2.5, patternMin: 3, terminator: "tick" },
    show: { tags: true, legend: true, table: false, edgeNames: true, centreMarks: true, bothSides: true },
    paper: { size: "A4", orientation: "auto", scale: "auto" },
    rules: [],
  };
  for (const s of chain) {
    if (s.view) out.view = { default: s.view.default, roles: { ...s.view.roles } };
    Object.assign(out.dims, strip(s.dims));
    Object.assign(out.show, strip(s.show));
    Object.assign(out.paper, strip(s.paper));
    out.rules = [...s.rules, ...out.rules];
  }
  return out;
}

const strip = <T extends object>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
