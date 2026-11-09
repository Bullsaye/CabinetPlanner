import { z } from "zod";
import { LocalizedText } from "../text.ts";

const VarInput = z.union([z.number(), z.string().trim().min(1)]);
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid identifier");

/**
 * One drilling operation of a hardware item, relative to a placement.
 * `mount` names the part the operation goes into; what the mounts are and
 * how `a` and `b` are measured is defined per category (see DECISIONS.md D15):
 * - hinge, mount "door": face towards the carcase; `a` along the hinge edge
 *   from the hinge centre (up is positive), `b` from the hinge edge inwards.
 * - hinge, mount "side": inner face of the hinge side; `a` as above, `b`
 *   from the front edge of the side backwards.
 * - connector (D36), at a joint between a panel's end ("edge" part) and
 *   another panel's face ("face" part), relative to the connector position
 *   on the joint line: mount "face" into the face part, "edge" into the
 *   edge part's end, `a` along the joint (towards the front), `b` across
 *   from the edge part's mid-thickness; mount "edge_face" into the edge
 *   part's inner face, `b` from the joint plane. `op: groove` mills a slot
 *   `d` wide and `len` long instead of a bore (Lamello P-System).
 * - leg, mount "bottom"; rail, mount "end": see D31 / D30.
 * All values are expressions over the item params and cabinet variables;
 * connectors also see `t_edge` and `t_face` (the two panel thicknesses).
 */
export const DrillOp = z.object({
  mount: z.string().min(1),
  op: z.enum(["bore", "groove"]).default("bore"),
  /** Grooves: length along the joint. */
  len: VarInput.optional(),
  d: VarInput,
  depth: VarInput,
  a: VarInput,
  b: VarInput,
  /** Through the whole part (depth is ignored); how it is drilled follows option bore.through. */
  through: z.boolean().optional(),
  note: z.string().optional(),
});
export type DrillOp = z.infer<typeof DrillOp>;

/**
 * Drawer slide product data (category "slide"). Positions in mm.
 * - lengths: available nominal lengths (NL); the longest that fits wins.
 * - depthExtra: clear inside depth needed beyond NL (e.g. NL + 3).
 * - fixings: rail screw positions on the carcase side, measured backwards
 *   from the first fixing (`firstFixing` from the front edge), chosen by NL.
 * - axisMin: lowest rail screw axis above the carcase bottom's top face.
 * - axisToBox: rail screw axis above the drawer box underside.
 * - box: "wood" (drawer built from board; params inner_w, length) or
 *   "metal" (metal sides; params bottom_w, bottom_l, back_w and `heights`).
 */
export const SlideData = z.object({
  lengths: z.array(z.number().positive()).min(1),
  depthExtra: z.number().default(3),
  firstFixing: z.number().default(37),
  fixings: z.array(z.object({ upTo: z.number(), at: z.array(z.number()) })).min(1),
  axisMin: z.number().default(38),
  axisToBox: z.number().default(10),
  box: z.enum(["wood", "metal"]),
  /** Metal systems: side heights and matching back panel heights. */
  heights: z.array(z.object({ h: z.number(), back: z.number(), name: z.string().optional() })).default([]),
  /**
   * Holes in the back of the drawer front for the system's front fixing
   * (hooks, holders). Per side: `fromSide` from the carcase side's inner
   * face line inwards, lowest hole `fromBox` above the box underside, more
   * holes at `rows` offsets upwards. Without it, wooden drawers use shop
   * screws through the inner front (option drawer_front.fixing).
   */
  frontFixing: z
    .object({ d: z.number().positive(), depth: z.number().positive(), fromSide: z.number(), fromBox: z.number(), rows: z.array(z.number()).min(1) })
    .optional(),
});
export type SlideData = z.infer<typeof SlideData>;

export const HardwareItem = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: LocalizedText,
  category: z.enum(["hinge", "connector", "shelf_support", "slide", "handle", "leg", "rail", "hanger", "flap", "other"]),
  manufacturer: z.string().optional(),
  series: z.string().optional(),
  articles: z.array(z.object({ code: z.string().min(1), note: z.string().optional() })).default([]),
  /** Article chosen by a computed value (e.g. lift mechanism by power factor LF); first match wins. */
  variants: z
    .array(
      z.object({
        code: z.string().min(1),
        note: z.string().optional(),
        param: z.string().min(1),
        min: z.number().optional(),
        max: z.number().optional(),
        /** Further conditions that must hold too (e.g. gas spring by height and weight). */
        and: z.array(z.object({ param: z.string().min(1), min: z.number().optional(), max: z.number().optional() })).default([]),
      }),
    )
    .default([]),
  /**
   * untested: data entered but never machined; tested: the author machined
   * parts with it; verified: reviewed. Untested drilling data will warn
   * before CNC export.
   */
  trust: z.enum(["untested", "tested", "verified"]).default("untested"),
  /** Where the data comes from: datasheet, measurement, note. */
  source: z.string().optional(),
  /** Item parameters; may reference cabinet variables and placement context. */
  params: z.record(identifier, VarInput).default({}),
  drilling: z.array(DrillOp).default([]),
  slide: SlideData.optional(),
  /**
   * Ranges the manufacturer allows, checked per placement, e.g. the cup
   * boring distance a hinge can take or the door thickness. Outside → error.
   */
  limits: z
    .array(z.object({ name: z.string().min(1), value: VarInput, min: VarInput.optional(), max: VarInput.optional() }))
    .default([]),
  bom: z
    .object({
      perPlacement: z.number().positive().default(1),
      unit: z.string().default("pcs"),
      price: z.number().nonnegative().optional(),
    })
    .default({ perPlacement: 1, unit: "pcs" }),
});
export type HardwareItem = z.infer<typeof HardwareItem>;
