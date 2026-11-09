import { drawAssembly } from "../drawing/assembly.ts";
import { drawPartSheets } from "../drawing/render.ts";
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
export interface Sheet {
  /** File name with folder, e.g. "B01/B01-SL.svg"; unique within a project. */
  name: string;
  svg: string;
  /** Sheet size in mm. */
  page: { w: number; h: number };
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
}

const pageOf = (svg: string): { w: number; h: number } => {
  const m = /^<svg [^>]*\bwidth="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 0, h: 0 };
};

export function projectSheets(result: ProjectResult, opts: SheetOptions): Sheet[] {
  const css = opts.css ?? true;
  const text = drawingText(opts.tr, result.library);
  const partText = drawingText(opts.tr, result.library, opts.styleName);
  const sheets: Sheet[] = [];
  const add = (name: string, svg: string): void => void sheets.push({ name, svg, page: pageOf(svg) });
  const partSheets = (folder: string, part: Part, cabinet: { W: number; H: number; D: number }): void => {
    const drawn = drawPartSheets({ part, cabinet, style: opts.style, text: partText, css });
    drawn.forEach((s, i) => sheets.push({ name: `${folder}/${part.id}${drawn.length > 1 ? `-${i + 1}` : ""}.svg`, svg: s.svg, page: s.page }));
  };

  const room = opts.cabinet === undefined ? result.room : undefined;
  if (room) {
    add("room/floor-plan.svg", floorPlanSvg(room, result.project.name, text, css));
    for (const w of room.walls) add(`room/elevation-${w.id}.svg`, elevationSvg(room, w.id, result.cabinets, result.project.name, text, css));
  }
  for (const c of result.cabinets) {
    const cab = c.resolved.cabinet;
    if ((opts.cabinet !== undefined && cab.id !== opts.cabinet) || c.parts.length === 0) continue;
    const v = (n: string): number => c.resolved.values.get(n)!;
    const size = { W: v("W"), H: v("H"), D: v("D") };
    add(
      `${cab.id}/${cab.id}-assembly.svg`,
      drawAssembly({
        cabinet: { id: cab.id, ...(cab.name ? { name: cab.name } : {}), ...size },
        parts: c.parts,
        hardware: c.hardware,
        library: result.library,
        text,
        project: { name: result.project.name, revision: result.project.revision },
        css,
      }).svg,
    );
    for (const p of c.parts) partSheets(cab.id, p, size);
  }
  for (const p of room?.parts ?? []) partSheets("room", p, { W: p.box.dx, H: p.box.dy, D: p.box.dz });
  return sheets;
}
