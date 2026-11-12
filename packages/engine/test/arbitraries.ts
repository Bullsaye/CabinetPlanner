import fc from "fast-check";

/** Random cabinets for property tests: cabinet input as written in a file. */

const zone = fc.record(
  {
    type: fc.constantFrom("drawer", "door", "open", "appliance", "panel", "flap"),
    h: fc.option(fc.integer({ min: 60, max: 900 }), { nil: undefined }),
    doors: fc.option(fc.constantFrom(1, 2), { nil: undefined }),
    hinge: fc.option(fc.constantFrom("left", "right"), { nil: undefined }),
    front: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: ["type"] },
);

const options = fc.record({
  carcase_joint: fc.constantFrom("sides_over", "sides_between"),
  top: fc.constantFrom("auto", "full", "rails"),
  "rail.front": fc.constantFrom("flat", "upright", "none"),
  "rail.rear": fc.constantFrom("flat", "upright", "none"),
  "rail.bottom": fc.constantFrom("none", "none", "flat", "upright"),
  back_mount: fc.constantFrom("groove", "rebate", "surface", "none"),
  back_extent: fc.constantFrom("inside", "behind_horizontals"),
  joint_method: fc.constantFrom("dowel", "connector", "connector_dowel", "none"),
  dowel_pattern: fc.constantFrom("grid", "sequence"),
  joint_screws: fc.constantFrom("none", "between_dowels"),
  "hardware.fastener": fc.constantFrom("hafele-minifix-15", "hettich-rastex-15", "lamello-clamex-p14", "generic-confirmat-7x50"),
  system_holes: fc.constantFrom("full", "none"),
  corner: fc.constantFrom("none", "none", "blind_left", "blind_right"),
  interior: fc.constantFrom("shelves", "shelves", "hanging", "hanging_first", "hanging_last"),
  "hardware.handle": fc.constantFrom(null, "generic-knob", "generic-bar-128", "generic-bar-192"),
  "handle.door": fc.constantFrom("vertical", "horizontal"),
  "handle.drawer": fc.constantFrom("center", "top"),
  "hardware.hanger": fc.constantFrom(null, "hettich-sah-130"),
  "hardware.slide": fc.constantFrom("generic-undermount", "grass-dynapro-40", "grass-nova-pro-scala-40"),
  "hardware.hinge": fc.constantFrom("generic-hinge-110", "blum-cliptop-110-inserta", "hettich-sensys-8645i-flash"),
  "hardware.flap": fc.constantFrom("blum-aventos-hk-top", "hettich-lift-advanced-hk"),
  "hardware.leg": fc.constantFrom("generic-leg-100", "generic-leg-100-screwed", null),
  "bore.through": fc.constantFrom("one_side", "both_sides"),
  "bore.opposite": fc.constantFrom("both_sides", "through", "error"),
  door_hinge_side: fc.constantFrom("left", "right"),
});

const raw = fc.record({
  kind: fc.constantFrom("base", "wall", "tall"),
  W: fc.integer({ min: 150, max: 2800 }),
  H: fc.integer({ min: 150, max: 2600 }),
  D: fc.integer({ min: 150, max: 900 }),
  shelf_count: fc.integer({ min: 0, max: 6 }),
  door_count: fc.integer({ min: 0, max: 2 }),
  partition_count: fc.integer({ min: 0, max: 3 }),
  rail_w: fc.integer({ min: 30, max: 200 }),
  t_carcase: fc.constantFrom(undefined, undefined, 16, 19, 25),
  bottom_setback_rear: fc.constantFrom(0, 0, 0, 50, 120),
  front_gap: fc.constantFrom(3, 3, 0, 2, 4),
  options,
  fronts: fc.option(fc.array(zone, { minLength: 1, maxLength: 4 }), { nil: undefined, freq: 2 }),
});

type Raw = typeof raw extends fc.Arbitrary<infer T> ? T : never;

const cabinet = (i: Raw): Record<string, unknown> => {
  const { kind, options: opts, fronts, t_carcase, ...vars } = i;
  return { kind, vars: { ...vars, ...(t_carcase ? { t_carcase } : {}) }, options: opts, ...(fronts ? { fronts } : {}) };
};

/** Anything a file may say within the variable ranges: most of these are rejected with errors. */
export const anyCabinet: fc.Arbitrary<Record<string, unknown>> = raw.map(cabinet);

/**
 * Cabinets a shop would draw: sizes by kind, option combinations that belong
 * together, a front stack that fills the height. Most of these are accepted.
 */
export const practicalCabinet: fc.Arbitrary<Record<string, unknown>> = raw.map((r) => {
  const i = { ...r, options: { ...r.options } };
  i.W = 300 + (i.W % 900);
  i.H = i.kind === "tall" ? 1400 + (i.H % 1000) : i.kind === "wall" ? 300 + (i.H % 700) : 500 + (i.H % 500);
  i.D = i.kind === "wall" ? 280 + (i.D % 120) : 400 + (i.D % 250);
  i.rail_w = 60 + (i.rail_w % 80);
  if (i.fronts) i.fronts = i.fronts.map((f, k) => ({ ...f, h: k === 0 && f.h ? 120 + (f.h % 200) : undefined }));
  const o = i.options;
  if (o.carcase_joint === "sides_between") {
    o.back_extent = "inside";
    o["rail.front"] = "flat";
    o["rail.rear"] = "flat";
    if (o["rail.bottom"] === "upright") o["rail.bottom"] = "none";
  }
  if (o["rail.bottom"] !== "none") i.bottom_setback_rear = 120;
  if (i.W < 800 || i.door_count === 2 || i.fronts?.some((f) => f.doors === 2)) o.corner = "none";
  if (i.W < 400 * (i.partition_count + 1)) i.partition_count = 0;
  if (i.kind !== "wall") o["hardware.hanger"] = null;
  return cabinet(i);
});
