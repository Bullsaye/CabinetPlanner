/**
 * Editing one edge of a part (D75): its edgeband and a short production
 * remark ("45°"). Both live in the cabinet's part layer (`parts[code]`,
 * engine `PartOverride`: `edges` and `edgeNotes`). Used by the cutlist; any
 * other editor of part overrides can use the same functions and the
 * EdgeEditor component.
 */
export type EdgeKey = "l1" | "l2" | "w1" | "w2";
export const EDGE_KEYS: readonly EdgeKey[] = ["l1", "l2", "w1", "w2"];

type Doc = Record<string, any>;

/** Part code of a part id: "B01-SL" → "SL". */
export const partCode = (partId: string): string => partId.slice(partId.lastIndexOf("-") + 1);

function edit(cabinet: Doc, code: string, change: (o: Doc) => void): void {
  cabinet.parts ??= {};
  const o: Doc = { ...(cabinet.parts[code] ?? {}) };
  change(o);
  for (const k of ["edges", "edgeNotes"]) if (o[k] && !Object.keys(o[k]).length) delete o[k];
  if (Object.keys(o).length) cabinet.parts[code] = o;
  else delete cabinet.parts[code];
}

/**
 * Sets the edgeband of one edge: an edgeband id, null for a bare edge, or
 * undefined to drop the override (the edge is banded as the construction
 * says again).
 */
export function setPartEdge(cabinet: Doc, code: string, edge: EdgeKey, band: string | null | undefined): void {
  edit(cabinet, code, (o) => {
    const edges = { ...(o.edges ?? {}) };
    if (band === undefined) delete edges[edge];
    else edges[edge] = band;
    o.edges = edges;
  });
}

/** Sets the remark of one edge; empty text removes it. */
export function setPartEdgeNote(cabinet: Doc, code: string, edge: EdgeKey, text: string): void {
  edit(cabinet, code, (o) => {
    const notes = { ...(o.edgeNotes ?? {}) };
    const v = text.trim().slice(0, 40);
    if (v) notes[edge] = v;
    else delete notes[edge];
    o.edgeNotes = notes;
  });
}

/** The edgeband override of an edge as stored: an id, null (bare), or undefined (none). */
export const partEdgeOverride = (cabinet: Doc | undefined, code: string, edge: EdgeKey): string | null | undefined => cabinet?.parts?.[code]?.edges?.[edge];

/**
 * Colours that tell edgebands apart in edge pictures; the first is the
 * app's accent. Chosen to stay distinct for the common colour-vision
 * deficiencies and readable on light and dark surfaces.
 */
const BAND_COLOURS = ["var(--accent)", "#d9730d", "#1a9a6c", "#b3399b", "#8a6d00", "#0f8fa8"];

/** Colour of an edgeband code, stable for a list of codes (library order). */
export function bandColour(code: string, codes: readonly string[]): string {
  const i = codes.indexOf(code);
  return BAND_COLOURS[(i < 0 ? 0 : i) % BAND_COLOURS.length]!;
}
