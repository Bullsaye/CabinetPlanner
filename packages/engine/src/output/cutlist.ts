import { localName, type Library } from "../library.ts";
import type { Part, PartRole } from "../part.ts";
import { formatNumber, toCsv } from "./format.ts";
import type { LocalizedText } from "../text.ts";

/**
 * Cutlist rows, independent of format and language. Text that depends on
 * the language (role names, column headers) is passed in as functions, so
 * the engine stays free of UI strings.
 */
export interface CutlistRow {
  /** Part id, or the first id of a group when grouping. */
  part: string;
  /** All part ids in this row (one unless grouped). */
  parts: string[];
  cabinet: string;
  role: PartRole;
  /** Free parts: the name their author gave them (shown in place of the role). */
  label?: LocalizedText;
  material: string;
  /** Surface finish id, "" for none (D53). */
  surface: string;
  length: number;
  width: number;
  thickness: number;
  cutLength: number;
  cutWidth: number;
  qty: number;
  grain: boolean;
  /** Edgeband codes per edge, "" for none: [l1, l2, w1, w2]. */
  edges: [string, string, string, string];
  /** Remark per edge for production, "" for none: [l1, l2, w1, w2] (D60). */
  edgeNotes: [string, string, string, string];
  note: string;
  /** Not a rectangle: cut from the bounding size to the part's outline (D43). */
  outline: boolean;
}

export interface CutlistOptions {
  /** Merge identical parts of the same cabinet into one row with a quantity. */
  group?: boolean;
}

export function cutlistRows(parts: readonly Part[], library: Library, opts: CutlistOptions = {}): CutlistRow[] {
  const code = (id: string | null): string => (id === null ? "" : (library.edgebands.get(id)?.code ?? id));
  const rows: CutlistRow[] = parts.map((p) => ({
    part: p.id,
    parts: [p.id],
    cabinet: p.cabinet,
    role: p.role,
    ...(p.label !== undefined ? { label: p.label } : {}),
    material: p.material,
    surface: p.surface ?? "",
    length: p.length,
    width: p.width,
    thickness: p.thickness,
    cutLength: p.cutLength,
    cutWidth: p.cutWidth,
    qty: 1,
    grain: p.grain,
    edges: [code(p.edges.l1), code(p.edges.l2), code(p.edges.w1), code(p.edges.w2)],
    edgeNotes: [p.edgeNotes?.l1 ?? "", p.edgeNotes?.l2 ?? "", p.edgeNotes?.w1 ?? "", p.edgeNotes?.w2 ?? ""],
    note: p.note ?? "",
    outline: !!p.outline,
  }));
  if (!opts.group) return rows;
  // Shaped parts only group with parts of the same shape (D43).
  const shape = new Map(parts.map((p) => [p.id, p.outline ? JSON.stringify(p.outline) : ""]));

  // Group by everything that matters for cutting and banding. Left and right
  // sides of the same size collapse into one row with qty 2.
  const groups = new Map<string, CutlistRow>();
  for (const r of rows) {
    const key = JSON.stringify([
      r.cabinet,
      r.material,
      r.surface,
      r.length,
      r.width,
      r.thickness,
      r.cutLength,
      r.cutWidth,
      r.grain,
      r.edges,
      r.edgeNotes,
      r.note,
      shape.get(r.part),
      groupRole(r.role),
      r.label ?? "",
    ]);
    const g = groups.get(key);
    if (g) {
      g.qty++;
      g.parts.push(r.part);
    } else {
      groups.set(key, { ...r, parts: [r.part] });
    }
  }
  return [...groups.values()];
}

/** Roles that may share a row when sizes match. */
const groupRole = (role: PartRole): string =>
  role === "side_left" || role === "side_right" ? "side" : role === "rail_front" || role === "rail_rear" ? "rail" : role;

export type CutlistColumn =
  | "part"
  | "cabinet"
  | "role"
  | "material"
  | "surface"
  | "length"
  | "width"
  | "thickness"
  | "cut_length"
  | "cut_width"
  | "qty"
  | "grain"
  | "edge_l1"
  | "edge_l2"
  | "edge_w1"
  | "edge_w2"
  | "note"
  | "edge_note_l1"
  | "edge_note_l2"
  | "edge_note_w1"
  | "edge_note_w2";

/** Order as on a shop list (D53): what, how many, size, board, finish, cut size, edges, remark. */
export const DEFAULT_COLUMNS: readonly CutlistColumn[] = [
  "part",
  "cabinet",
  "role",
  "qty",
  "length",
  "width",
  "thickness",
  "material",
  "surface",
  "cut_length",
  "cut_width",
  "grain",
  "edge_l1",
  "edge_l2",
  "edge_w1",
  "edge_w2",
  "note",
];

/** The edge remark columns (D60), written after the standard ones when a list has remarks. */
export const EDGE_NOTE_COLUMNS: readonly CutlistColumn[] = ["edge_note_l1", "edge_note_l2", "edge_note_w1", "edge_note_w2"];

/**
 * Columns for a list: the standard ones, plus the four edge remark columns
 * at the end when any row has a remark. The first columns never move, so a
 * saw import mapped by position keeps working; lists without remarks are
 * exactly as before.
 */
export const cutlistColumns = (rows: readonly CutlistRow[]): readonly CutlistColumn[] =>
  rows.some((r) => r.edgeNotes.some((n) => n !== "")) ? [...DEFAULT_COLUMNS, ...EDGE_NOTE_COLUMNS] : DEFAULT_COLUMNS;

export interface CutlistText {
  /** Column header text. */
  header: (col: CutlistColumn) => string;
  /** Localized role name; receives the row so grouped sides can read "Side L/R". */
  role: (row: CutlistRow) => string;
  /** Locale used for library names. */
  locale: string;
  /**
   * Remark for parts that are not rectangles (D43), printed in the note
   * column: the sizes are the bounding rectangle, the contour is on the
   * part sheet and in the DXF.
   */
  shaped?: string;
}

export function cutlistTable(
  rows: readonly CutlistRow[],
  library: Library,
  text: CutlistText,
  columns: readonly CutlistColumn[] = cutlistColumns(rows),
): string[][] {
  const cell = (r: CutlistRow, c: CutlistColumn): string => {
    switch (c) {
      case "part":
        return r.parts.length > 1 ? r.parts.join(" ") : r.part;
      case "cabinet":
        return r.cabinet;
      case "role":
        return text.role(r);
      case "material": {
        const m = library.materials.get(r.material);
        return m ? localName(m.name, text.locale) : r.material;
      }
      case "surface": {
        const s = library.surfaces.get(r.surface);
        return s ? localName(s.name, text.locale) : r.surface;
      }
      case "length":
        return formatNumber(r.length);
      case "width":
        return formatNumber(r.width);
      case "thickness":
        return formatNumber(r.thickness);
      case "cut_length":
        return formatNumber(r.cutLength);
      case "cut_width":
        return formatNumber(r.cutWidth);
      case "qty":
        return String(r.qty);
      case "grain":
        return r.grain ? "L" : "";
      case "edge_l1":
        return r.edges[0];
      case "edge_l2":
        return r.edges[1];
      case "edge_w1":
        return r.edges[2];
      case "edge_w2":
        return r.edges[3];
      case "note":
        return [r.note, r.outline ? (text.shaped ?? "") : ""].filter((s) => s !== "").join("; ");
      case "edge_note_l1":
        return r.edgeNotes[0];
      case "edge_note_l2":
        return r.edgeNotes[1];
      case "edge_note_w1":
        return r.edgeNotes[2];
      case "edge_note_w2":
        return r.edgeNotes[3];
    }
  };
  return [columns.map(text.header), ...rows.map((r) => columns.map((c) => cell(r, c)))];
}

/** CSV with LF line endings; byte-identical for identical input. */
export function cutlistCsv(
  rows: readonly CutlistRow[],
  library: Library,
  text: CutlistText,
  opts: { delimiter?: string; columns?: readonly CutlistColumn[] } = {},
): string {
  return toCsv(cutlistTable(rows, library, text, opts.columns), opts.delimiter ?? ",");
}
