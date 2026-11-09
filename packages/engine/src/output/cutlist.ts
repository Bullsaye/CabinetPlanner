import { localName, type Library } from "../library.ts";
import type { Part, PartRole } from "../part.ts";
import { formatNumber, toCsv } from "./format.ts";

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
  material: string;
  length: number;
  width: number;
  thickness: number;
  cutLength: number;
  cutWidth: number;
  qty: number;
  grain: boolean;
  /** Edgeband codes per edge, "" for none: [l1, l2, w1, w2]. */
  edges: [string, string, string, string];
  note: string;
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
    material: p.material,
    length: p.length,
    width: p.width,
    thickness: p.thickness,
    cutLength: p.cutLength,
    cutWidth: p.cutWidth,
    qty: 1,
    grain: p.grain,
    edges: [code(p.edges.l1), code(p.edges.l2), code(p.edges.w1), code(p.edges.w2)],
    note: p.note ?? "",
  }));
  if (!opts.group) return rows;

  // Group by everything that matters for cutting and banding. Left and right
  // sides of the same size collapse into one row with qty 2.
  const groups = new Map<string, CutlistRow>();
  for (const r of rows) {
    const key = JSON.stringify([
      r.cabinet,
      r.material,
      r.length,
      r.width,
      r.thickness,
      r.cutLength,
      r.cutWidth,
      r.grain,
      r.edges,
      r.note,
      groupRole(r.role),
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
  | "note";

export const DEFAULT_COLUMNS: readonly CutlistColumn[] = [
  "part",
  "cabinet",
  "role",
  "material",
  "length",
  "width",
  "thickness",
  "cut_length",
  "cut_width",
  "qty",
  "grain",
  "edge_l1",
  "edge_l2",
  "edge_w1",
  "edge_w2",
  "note",
];

export interface CutlistText {
  /** Column header text. */
  header: (col: CutlistColumn) => string;
  /** Localized role name; receives the row so grouped sides can read "Side L/R". */
  role: (row: CutlistRow) => string;
  /** Locale used for library names. */
  locale: string;
}

export function cutlistTable(
  rows: readonly CutlistRow[],
  library: Library,
  text: CutlistText,
  columns: readonly CutlistColumn[] = DEFAULT_COLUMNS,
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
        return r.note;
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
