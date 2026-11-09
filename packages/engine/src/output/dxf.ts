import { z } from "zod";
import { MACHINE_VIEW, machinedFaces, otherFace, partView, type ViewSpec } from "../drawing/view.ts";
import { extractFeatures, type DFeature } from "../drawing/features.ts";
import type { Part } from "../part.ts";
import { LocalizedText } from "../text.ts";

/**
 * DXF export (DECISIONS.md D27): one ASCII DXF (R12, AC1009) per machined
 * side of a part, in the machine frame of the part sheet: machined face
 * up, front edge on the reference (Y 0), origin at the reference corner,
 * millimetres. No post-processing: the CAM (e.g. SCM Maestro) maps layer
 * names to its technologies. Layer names come from a profile, so a shop
 * matches them to its CAM setup without code.
 */
export const DxfProfileSchema = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  /**
   * Layer name templates. Placeholders: {d} Ø, {depth}, {z} distance of a
   * horizontal bore's axis below the top face, {edge} XM/XP/YM/YP (the
   * sheet edge a horizontal bore enters: X min/max, Y min/max), {t} part
   * thickness.
   */
  layers: z
    .object({
      outline: z.string().default("CONTOUR"),
      bore: z.string().default("DRILL_V_D{d}_Z{depth}"),
      through: z.string().default("DRILL_V_D{d}_THROUGH"),
      edgeBore: z.string().default("DRILL_H_D{d}_Z{depth}_{edge}"),
      pocket: z.string().default("POCKET_Z{depth}"),
    })
    .default({
      outline: "CONTOUR",
      bore: "DRILL_V_D{d}_Z{depth}",
      through: "DRILL_V_D{d}_THROUGH",
      edgeBore: "DRILL_H_D{d}_Z{depth}_{edge}",
      pocket: "POCKET_Z{depth}",
    }),
  /** Also write depth as entity thickness (group 39, negative = into the part). */
  thickness: z.boolean().default(true),
  /** Decimals in coordinates and layer names. */
  decimals: z.number().int().min(0).max(4).default(3),
});
export type DxfProfile = z.infer<typeof DxfProfileSchema>;

export const FACTORY_DXF_PROFILES: readonly DxfProfile[] = [
  DxfProfileSchema.parse({ id: "generic", name: { en: "Generic layers", de: "Allgemeine Layer" } }),
];

export interface DxfFile {
  /** e.g. "B01-SL.dxf", or "B01-DO1-side2.dxf" for the second side. */
  name: string;
  part: string;
  side: number;
  sides: number;
  content: string;
}

export interface DxfMeta {
  project?: string;
  revision?: number;
  /** ISO timestamp written into the header comment; pass a fixed one for byte-identical files. */
  timestamp?: string;
}

const fmtFactory = (decimals: number) => (x: number): string => {
  const fixed = (Math.round(x * 10 ** decimals) / 10 ** decimals).toFixed(decimals);
  // Only trailing zeros of the fraction go: with 0 decimals "720" must stay "720".
  const s = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  return s === "-0" ? "0" : s;
};

function layerName(template: string, vals: Record<string, string>): string {
  // DXF layer names: no spaces or special characters; dots become "P" (5.5 → 5P5) for CAM safety.
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => vals[k] ?? "")
    .replace(/\./g, "P")
    .replace(/[^A-Za-z0-9_\-$]/g, "_")
    .toUpperCase();
}

/** All DXF files of one part: one per machined side. */
export function partDxf(
  part: Part,
  cabinet: { W: number; H: number; D: number },
  profile: DxfProfile = FACTORY_DXF_PROFILES[0]!,
  meta: DxfMeta = {},
  spec: ViewSpec = MACHINE_VIEW,
): DxfFile[] {
  const first = partView(part, spec, cabinet).face;
  const machined = machinedFaces(part);
  const faces: ("t0" | "t1")[] = machined.has("t0") && machined.has("t1") ? [first, otherFace(first)] : [first];
  return faces.map((face, i) => {
    const view = partView(part, spec, cabinet, face);
    // Edge features belong to the first side's program only.
    const feats = extractFeatures(view).filter((f) => f.where === "face" || (f.where === "edge" && i === 0));
    const contour = part.outline?.map(([u, v]) => {
      const q = view.projectLocal({ u, v, w: 0 });
      return [q.X, q.Y] as [number, number];
    });
    const content = writeDxf(part, view.width, view.height, feats, profile, {
      ...(contour ? { contour } : {}),
      ...meta,
      side: i + 1,
      sides: faces.length,
      face,
    });
    const name = faces.length > 1 ? `${part.id}-side${i + 1}.dxf` : `${part.id}.dxf`;
    return { name, part: part.id, side: i + 1, sides: faces.length, content };
  });
}

function writeDxf(
  part: Part,
  width: number,
  height: number,
  feats: DFeature[],
  profile: DxfProfile,
  meta: DxfMeta & { side: number; sides: number; face: string; contour?: [number, number][] },
): string {
  const f = fmtFactory(profile.decimals);
  const L = profile.layers;
  const t = part.thickness;
  const out: string[] = [];
  const g = (code: number, value: string | number): void => {
    out.push(String(code), typeof value === "number" ? f(value) : value);
  };
  const entities: string[] = [];
  const layers = new Set<string>();
  const e = (code: number, value: string | number): void => {
    entities.push(String(code), typeof value === "number" ? f(value) : value);
  };
  const vals = (o: Record<string, number | string>): Record<string, string> =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? f(v) : v]));

  /** Closed polyline; a third value is the bulge of the segment to the next vertex (tan of a quarter of the arc angle). */
  const poly = (layer: string, pts: ([number, number] | [number, number, number])[], thickness?: number): void => {
    layers.add(layer);
    e(0, "POLYLINE");
    e(8, layer);
    e(66, "1");
    e(10, 0);
    e(20, 0);
    e(30, 0);
    if (thickness !== undefined && profile.thickness) e(39, -thickness);
    e(70, "1");
    for (const [x, y, bulge] of pts) {
      e(0, "VERTEX");
      e(8, layer);
      e(10, x);
      e(20, y);
      e(30, 0);
      if (bulge) e(42, bulge.toFixed(6));
    }
    e(0, "SEQEND");
    e(8, layer);
  };

  // Outline (panel thickness as entity thickness).
  poly(
    L.outline,
    meta.contour ?? [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    t,
  );

  for (const ft of feats) {
    if (ft.op === "pocket" && ft.rect) {
      const layer = layerName(L.pocket, vals({ depth: ft.depth, t }));
      const r = ft.rect;
      const rad = Math.min(ft.r ?? 0, (r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2);
      if (rad > 0) {
        // Counter-clockwise; quarter arcs at the corners (bulge tan(22.5°)).
        const b = Math.tan(Math.PI / 8);
        poly(layer, [
          [r.x0 + rad, r.y0],
          [r.x1 - rad, r.y0, b],
          [r.x1, r.y0 + rad],
          [r.x1, r.y1 - rad, b],
          [r.x1 - rad, r.y1],
          [r.x0 + rad, r.y1, b],
          [r.x0, r.y1 - rad],
          [r.x0, r.y0 + rad, b],
        ], ft.depth);
      } else {
        poly(layer, [
          [r.x0, r.y0],
          [r.x1, r.y0],
          [r.x1, r.y1],
          [r.x0, r.y1],
        ], ft.depth);
      }
      continue;
    }
    if (ft.where === "face") {
      const layer = ft.through
        ? layerName(L.through, vals({ d: ft.d, depth: t, t }))
        : layerName(L.bore, vals({ d: ft.d, depth: ft.depth, t }));
      layers.add(layer);
      e(0, "CIRCLE");
      e(8, layer);
      e(10, ft.X);
      e(20, ft.Y);
      e(30, 0);
      if (profile.thickness) e(39, -(ft.through ? t : ft.depth));
      e(40, ft.d / 2);
      continue;
    }
    // Horizontal bore: a line from the edge inwards, length = depth.
    const dir = ft.side === "left" ? [1, 0] : ft.side === "right" ? [-1, 0] : ft.side === "bottom" ? [0, 1] : [0, -1];
    const edge = ft.side === "left" ? "XM" : ft.side === "right" ? "XP" : ft.side === "bottom" ? "YM" : "YP";
    // Distance of the bore axis below the top face (the sheet shows the machined face up).
    const layer = layerName(L.edgeBore, vals({ d: ft.d, depth: ft.depth, edge, z: ft.zFromFace ?? t / 2, t }));
    layers.add(layer);
    e(0, "LINE");
    e(8, layer);
    e(10, ft.X);
    e(20, ft.Y);
    e(30, 0);
    e(11, ft.X + dir[0]! * ft.depth);
    e(21, ft.Y + dir[1]! * ft.depth);
    e(31, 0);
  }

  // Header comment, header, layer table, entities.
  // One line only: a line break in a project name would end the comment and corrupt the file.
  const comment = `Cabinet Planner · ${meta.project ?? ""} rev ${meta.revision ?? ""} · ${part.id} · side ${meta.side}/${meta.sides} (${meta.face} up) · ${f(width)} x ${f(height)} x ${f(t)} mm${meta.timestamp ? ` · ${meta.timestamp}` : ""}`;
  g(999, comment.replace(/[\u0000-\u001f\u007f]+/g, " "));
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$EXTMIN");
  g(10, 0);
  g(20, 0);
  g(30, -t);
  g(9, "$EXTMAX");
  g(10, width);
  g(20, height);
  g(30, 0);
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, String(layers.size));
  for (const name of [...layers].sort()) {
    g(0, "LAYER");
    g(2, name);
    g(70, "0");
    g(62, "7");
    g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  out.push(...entities);
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
