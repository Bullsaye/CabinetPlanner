import { drawAssembly } from "../drawing/assembly.ts";
import { drawPartSheets, partSheetCount, type PartDrawing } from "../drawing/render.ts";
import type { ResolvedStyle } from "../drawing/style.ts";
import { drawingText, type TranslatorLike } from "../drawing/text.ts";
import type { Part } from "../part.ts";
import type { ProjectResult } from "../project.ts";
import { elevationSvg, floorPlanSvg } from "../room/room-svg.ts";

/**
 * Every drawing sheet of a project (or of one cabinet) as separate SVGs, in
 * a fixed order, for a ZIP download or for printing one sheet per page:
 * floor plan and wall elevations, then per cabinet the assembly drawing and
 * its part sheets, then the room's own parts (worktops, plinth panels).
 */
export type SheetKind = "plan" | "elevation" | "assembly" | "part" | "room_part";

/** What a sheet shows, without drawing it: enough for a list to choose from. */
export interface SheetInfo {
  /** File name with folder, e.g. "B01/B01-SL.svg"; unique within a project. */
  name: string;
  kind: SheetKind;
  /** Cabinet id (assembly and part sheets). */
  cabinet?: string;
  /** Wall id (elevations). */
  wall?: string;
  /** Part id (part sheets); the part itself is in the project result. */
  part?: string;
  /** Parts machined on both faces have one sheet per side. */
  side?: { index: number; of: number };
  /** Part sheets: the part has machining or a contour (something to drill or rout). */
  machined?: boolean;
}

export interface Sheet extends SheetInfo {
  svg: string;
  /** Sheet size in mm. */
  page: { w: number; h: number };
}

/** Printed in the footer line of every sheet (PLAN.md: every output carries these). */
export interface SheetMeta {
  project: string;
  revision: number;
  /** ISO timestamp, e.g. "2026-03-01T09:30:00"; pass a fixed one for byte-identical sheets. */
  timestamp?: string;
}

export interface SheetOptions {
  /** Translator for all drawing text. */
  tr: TranslatorLike;
  /** Style of the part sheets. */
  style: ResolvedStyle;
  /** Display name of the style, printed on part sheets. */
  styleName?: string;
  /** Only this cabinet (no room sheets). */
  cabinet?: string;
  /** Embed the default stylesheet (default true: the files stand alone). */
  css?: boolean;
  /** Only the sheets with these names (the user's selection); the order stays the project's. */
  only?: ReadonlySet<string>;
  /** Footer line on every sheet: project, revision, timestamp, sheet name. */
  meta?: SheetMeta;
}

/** Sheet size in mm, read from a sheet's root element. */
export const sheetPage = (svg: string): { w: number; h: number } => {
  const m = /^<svg [^>]*\bwidth="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 0, h: 0 };
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Adds the footer line to a sheet, bottom right inside the margin. The text
 * carries its own colour so it reads in every stylesheet; hosts may restyle
 * the class.
 */
export function sheetFooter(svg: string, page: { w: number; h: number }, meta: SheetMeta, name: string, tr: TranslatorLike): string {
  const stamp = (meta.timestamp ?? "").replace("T", " ").replace(/^(\d{4}-\d\d-\d\d \d\d:\d\d).*$/, "$1");
  const line = [tr.t("assembly.project", { name: meta.project, rev: meta.revision }), stamp, name.replace(/\.svg$/, "")]
    .filter((x) => x !== "")
    .join(" · ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ");
  const text = `<text class="sheet-foot" x="${page.w - 10}" y="${page.h - 4}" font-size="2" text-anchor="end" fill="#7a828d">${esc(line)}</text>`;
  const at = svg.lastIndexOf("</svg>");
  return at < 0 ? svg : svg.slice(0, at) + text + svg.slice(at);
}

interface Entry extends SheetInfo {
  draw(): { svg: string; page: { w: number; h: number } };
}

function entries(result: ProjectResult, opts: SheetOptions): Entry[] {
  const css = opts.css ?? true;
  const text = drawingText(opts.tr, result.library);
  const partText = drawingText(opts.tr, result.library, opts.styleName);
  const out: Entry[] = [];
  const whole = (svg: string): { svg: string; page: { w: number; h: number } } => ({ svg, page: sheetPage(svg) });
  const partSheets = (folder: string, kind: "part" | "room_part", part: Part, cabinet: { W: number; H: number; D: number }): void => {
    const n = partSheetCount(part, opts.style);
    let drawn: PartDrawing[] | undefined;
    for (let i = 0; i < n; i++) {
      out.push({
        name: `${folder}/${part.id}${n > 1 ? `-${i + 1}` : ""}.svg`,
        kind,
        ...(kind === "part" ? { cabinet: folder } : {}),
        part: part.id,
        ...(n > 1 ? { side: { index: i + 1, of: n } } : {}),
        machined: part.operations.length > 0 || !!part.outline,
        draw: () => {
          drawn ??= drawPartSheets({ part, cabinet, style: opts.style, text: partText, css });
          return { svg: drawn[i]!.svg, page: drawn[i]!.page };
        },
      });
    }
  };

  const room = opts.cabinet === undefined ? result.room : undefined;
  if (room) {
    out.push({ name: "room/floor-plan.svg", kind: "plan", draw: () => whole(floorPlanSvg(room, result.project.name, text, css)) });
    for (const w of room.walls) {
      out.push({
        name: `room/elevation-${w.id}.svg`,
        kind: "elevation",
        wall: w.id,
        draw: () => whole(elevationSvg(room, w.id, result.cabinets, result.project.name, text, css)),
      });
    }
  }
  for (const c of result.cabinets) {
    const cab = c.resolved.cabinet;
    if ((opts.cabinet !== undefined && cab.id !== opts.cabinet) || c.parts.length === 0) continue;
    const v = (n: string): number => c.resolved.values.get(n)!;
    const size = { W: v("W"), H: v("H"), D: v("D") };
    out.push({
      name: `${cab.id}/${cab.id}-assembly.svg`,
      kind: "assembly",
      cabinet: cab.id,
      draw: () =>
        whole(
          drawAssembly({
            cabinet: { id: cab.id, ...(cab.name ? { name: cab.name } : {}), ...size },
            parts: c.parts,
            hardware: c.hardware,
            library: result.library,
            text,
            project: { name: result.project.name, revision: result.project.revision },
            css,
          }).svg,
        ),
    });
    for (const p of c.parts) partSheets(cab.id, "part", p, size);
  }
  for (const p of room?.parts ?? []) partSheets("room", "room_part", p, { W: p.box.dx, H: p.box.dy, D: p.box.dz });
  return out;
}

/** The sheets a project has, in order, without drawing them (cheap: for a list with checkboxes). */
export function sheetIndex(result: ProjectResult, opts: Pick<SheetOptions, "style" | "cabinet" | "tr">): SheetInfo[] {
  return entries(result, opts).map(({ draw: _draw, ...info }) => info);
}

export function projectSheets(result: ProjectResult, opts: SheetOptions): Sheet[] {
  return entries(result, opts)
    .filter((e) => !opts.only || opts.only.has(e.name))
    .map(({ draw, ...info }) => {
      const d = draw();
      return { ...info, svg: opts.meta ? sheetFooter(d.svg, d.page, opts.meta, info.name, opts.tr) : d.svg, page: d.page };
    });
}
