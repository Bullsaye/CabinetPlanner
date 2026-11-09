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
 * All values are expressions over the item params and cabinet variables.
 */
export const DrillOp = z.object({
  mount: z.string().min(1),
  d: VarInput,
  depth: VarInput,
  a: VarInput,
  b: VarInput,
  note: z.string().optional(),
});
export type DrillOp = z.infer<typeof DrillOp>;

export const HardwareItem = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: LocalizedText,
  category: z.enum(["hinge", "connector", "shelf_support", "slide", "leg", "other"]),
  manufacturer: z.string().optional(),
  series: z.string().optional(),
  articles: z.array(z.object({ code: z.string().min(1), note: z.string().optional() })).default([]),
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
  bom: z
    .object({
      perPlacement: z.number().positive().default(1),
      unit: z.string().default("pcs"),
      price: z.number().nonnegative().optional(),
    })
    .default({ perPlacement: 1, unit: "pcs" }),
});
export type HardwareItem = z.infer<typeof HardwareItem>;
