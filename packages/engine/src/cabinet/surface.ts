import { OPTION_BY_KEY } from "../catalog.ts";
import type { Diagnostic } from "../diagnostics.ts";
import type { Library } from "../library.ts";
import type { Part, PartRole } from "../part.ts";
import type { ResolvedCabinet } from "../resolve.ts";
import type { CabinetContext } from "./machining.ts";

/** Parts finished like the fronts. */
const FRONT_ROLES = new Set<PartRole>(["door", "drawer_front", "blind_panel", "appliance_front", "flap", "ceiling_filler"]);
/** Carcase parts that take the carcase finish. */
const CARCASE_ROLES = new Set<PartRole>(["side_left", "side_right", "bottom", "top", "rail_front", "rail_rear", "rail_bottom", "partition", "fixed_shelf", "shelf"]);

/**
 * Surface finishes (D67): fronts take `surface.front`, carcase parts
 * `surface.carcase`, a side that can be seen `surface.visible_side` (when
 * set). A part override or a free part's own `surface` wins. Backs, drawer
 * boxes, worktops and plinths have none.
 */
export function assignSurfaces(rc: ResolvedCabinet, library: Library, parts: Part[], context: CabinetContext, diagnostics: Diagnostic[]): void {
  const cab = rc.cabinet.id;
  const opt = (key: string): string | null => (rc.options.get(key)?.value as string | null | undefined) ?? null;
  const seen = (k: "left" | "right"): boolean => {
    const o = rc.options.get(`side.${k}`)?.value;
    return o === "visible" ? true : o === "hidden" ? false : (context.visible?.[k] ?? false);
  };
  /** An option key or a surface id. */
  const refOf = (ref: string): string | null => (OPTION_BY_KEY.get(ref)?.kind.type === "surface" ? opt(ref) : ref);
  const customDefs = new Map((rc.cabinet.construction?.parts ?? []).map((d) => [d.id, d]));
  for (const p of parts) {
    let surface: string | null = null;
    if (FRONT_ROLES.has(p.role)) surface = opt("surface.front");
    else if (p.role === "side_left" || p.role === "side_right") {
      const visible = seen(p.role === "side_left" ? "left" : "right");
      surface = (visible ? opt("surface.visible_side") : null) ?? opt("surface.carcase");
    } else if (CARCASE_ROLES.has(p.role)) surface = opt("surface.carcase");
    else if (p.role === "custom") {
      const def = customDefs.get(p.code) ?? customDefs.get(p.code.replace(/\d+$/, ""));
      if (def?.surface !== undefined) surface = def.surface === null ? null : refOf(def.surface);
      else if (def?.material === "material.front") surface = opt("surface.front");
      else if (def?.material === "material.carcase" || def?.material === "material.shelf") surface = opt("surface.carcase");
    }
    const override = rc.cabinet.parts[p.code]?.surface;
    if (override !== undefined) surface = override;
    if (surface === null) continue;
    if (!library.surfaces.has(surface)) {
      diagnostics.push({ severity: "error", code: "surface_unknown", params: { key: p.code, value: surface }, cabinet: cab, part: p.id });
      continue;
    }
    p.surface = surface;
  }
}
