import { localName } from "../library.ts";
import type { Part } from "../part.ts";
import type { ProjectResult } from "../project.ts";
import { formatNumber, toCsv } from "./format.ts";

/**
 * Bill of materials (D61): what to order for a project, and what it costs
 * when the library items carry prices. Data only; column headers, section
 * names and units are passed in as functions like in the cutlist writer.
 *
 * - Board: net area from the finished sizes (non-rectangular parts, D43,
 *   count with their bounding rectangle: that is what is cut from the
 *   board), gross area = net × (1 + waste_pct / 100).
 * - Edgeband: finished length of every banded edge, plus edge_allowance
 *   per banded edge.
 * - Hardware and consumables: `CabinetResult.hardware` summed per library
 *   item and chosen article.
 *
 * waste_pct and edge_allowance are catalogue variables. Each part uses the
 * values of its cabinet; room parts (worktops, plinth panels) use the
 * project's.
 *
 * Quantities are rounded to 0.01 (m², m) first and a row's cost is that
 * quantity × unit price, rounded to 0.01, so every row can be checked with
 * a calculator; section totals are the sums of the row costs.
 */

export interface BomMaterialRow {
  material: string;
  thickness: number;
  /** Number of parts. */
  parts: number;
  /** m², finished sizes. */
  netArea: number;
  /** m², with the waste factor. */
  grossArea: number;
  pricePerM2?: number;
  cost?: number;
}

export interface BomEdgebandRow {
  edgeband: string;
  /** Number of banded edges. */
  edges: number;
  /** m, finished edge lengths. */
  netLength: number;
  /** m, with the allowance per edge. */
  length: number;
  pricePerM?: number;
  cost?: number;
}

export interface BomHardwareRow {
  item: string;
  /** Supplier article number(s): the chosen variant, else the item's articles. */
  article: string;
  category: string;
  qty: number;
  unit: string;
  /** Cut lengths for items cut to size (wardrobe rails), mm, ascending. */
  lengths: number[];
  price?: number;
  cost?: number;
}

/** Cost share of one cabinet ("ROOM": worktops and plinth panels). */
export interface BomCabinetRow {
  cabinet: string;
  name: string;
  /** m², finished sizes. */
  netArea: number;
  material: number;
  edgeband: number;
  hardware: number;
  total: number;
}

export interface BomTotals {
  material: number;
  edgeband: number;
  hardware: number;
  total: number;
  /** Rows without a price per section: the totals leave them out. */
  unpriced: { material: number; edgeband: number; hardware: number };
}

export interface Bom {
  materials: BomMaterialRow[];
  edgebands: BomEdgebandRow[];
  hardware: BomHardwareRow[];
  /**
   * Per cabinet, in project order, from unrounded quantities: the rows can
   * differ from the totals by rounding.
   */
  cabinets: BomCabinetRow[];
  totals: BomTotals;
}

const round2 = (x: number): number => {
  const r = Math.round((x + Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : r;
};
/** Plain code-unit order: the same on every machine and locale. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const CATEGORY_ORDER = ["connector", "hinge", "flap", "slide", "shelf_support", "handle", "rail", "hanger", "leg", "other"];

const EDGES = [
  ["l1", "length"],
  ["l2", "length"],
  ["w1", "width"],
  ["w2", "width"],
] as const;

/** Net area of a part in mm² (bounding rectangle for parts with an outline). */
export const partArea = (p: Pick<Part, "length" | "width">): number => p.length * p.width;

export function buildBom(result: ProjectResult): Bom {
  const { library } = result;
  const settings = new Map<string, { waste: number; allowance: number }>();
  const settingsOf = (values: ReadonlyMap<string, number>) => ({
    waste: values.get("waste_pct") ?? 0,
    allowance: values.get("edge_allowance") ?? 0,
  });
  for (const c of result.cabinets) settings.set(c.resolved.cabinet.id, settingsOf(c.resolved.values));
  const projectSettings = settingsOf(result.values);

  interface Share {
    area: number;
    material: number;
    edgeband: number;
    hardware: number;
  }
  const shares = new Map<string, Share>();
  const shareOf = (cabinet: string): Share => {
    let s = shares.get(cabinet);
    if (!s) shares.set(cabinet, (s = { area: 0, material: 0, edgeband: 0, hardware: 0 }));
    return s;
  };

  // mm² and mm while summing; converted once at the end.
  const mats = new Map<string, { parts: number; net: number; gross: number; thickness: number }>();
  const bands = new Map<string, { edges: number; net: number; gross: number }>();
  for (const p of result.parts) {
    const set = settings.get(p.cabinet) ?? projectSettings;
    const share = shareOf(p.cabinet);
    const area = partArea(p);
    const gross = area * (1 + set.waste / 100);
    let m = mats.get(p.material);
    if (!m) mats.set(p.material, (m = { parts: 0, net: 0, gross: 0, thickness: library.materials.get(p.material)?.thickness ?? p.thickness }));
    m.parts++;
    m.net += area;
    m.gross += gross;
    share.area += area;
    share.material += (gross / 1e6) * (library.materials.get(p.material)?.pricePerM2 ?? 0);
    for (const [edge, along] of EDGES) {
      const id = p.edges[edge];
      if (id === null) continue;
      let b = bands.get(id);
      if (!b) bands.set(id, (b = { edges: 0, net: 0, gross: 0 }));
      b.edges++;
      b.net += p[along];
      b.gross += p[along] + set.allowance;
      share.edgeband += ((p[along] + set.allowance) / 1e3) * (library.edgebands.get(id)?.pricePerM ?? 0);
    }
  }

  const materials: BomMaterialRow[] = [...mats.entries()]
    .sort((a, b) => byText(a[0], b[0]))
    .map(([material, m]) => {
      const price = library.materials.get(material)?.pricePerM2;
      const grossArea = round2(m.gross / 1e6);
      return {
        material,
        thickness: m.thickness,
        parts: m.parts,
        netArea: round2(m.net / 1e6),
        grossArea,
        ...(price !== undefined ? { pricePerM2: price, cost: round2(grossArea * price) } : {}),
      };
    });

  const edgebands: BomEdgebandRow[] = [...bands.entries()]
    .sort((a, b) => byText(a[0], b[0]))
    .map(([edgeband, b]) => {
      const price = library.edgebands.get(edgeband)?.pricePerM;
      const length = round2(b.gross / 1e3);
      return {
        edgeband,
        edges: b.edges,
        netLength: round2(b.net / 1e3),
        length,
        ...(price !== undefined ? { pricePerM: price, cost: round2(length * price) } : {}),
      };
    });

  const hw = new Map<string, BomHardwareRow>();
  for (const c of result.cabinets) {
    for (const u of c.hardware) {
      const item = library.hardware.get(u.item);
      const article = u.article ?? item?.articles.map((a) => a.code).join(", ") ?? "";
      const key = JSON.stringify([u.item, u.article ?? "", u.unit]);
      let row = hw.get(key);
      if (!row) {
        hw.set(key, (row = { item: u.item, article, category: item?.category ?? "other", qty: 0, unit: u.unit, lengths: [] }));
        if (item?.bom.price !== undefined) row.price = item.bom.price;
      }
      row.qty += u.qty;
      row.lengths.push(...(u.lengths ?? []));
      shareOf(c.resolved.cabinet.id).hardware += u.qty * (item?.bom.price ?? 0);
    }
  }
  const categoryRank = (c: string): number => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const hardware = [...hw.values()]
    .map((r) => ({
      ...r,
      qty: round2(r.qty),
      lengths: [...r.lengths].sort((a, b) => a - b),
      ...(r.price !== undefined ? { cost: round2(round2(r.qty) * r.price) } : {}),
    }))
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || byText(a.item, b.item) || byText(a.article, b.article));

  const names = new Map(result.cabinets.map((c) => [c.resolved.cabinet.id, c.resolved.cabinet.name ?? ""]));
  const order = [...result.cabinets.map((c) => c.resolved.cabinet.id), ...[...shares.keys()].filter((id) => !names.has(id))];
  const cabinets: BomCabinetRow[] = order
    .filter((id) => shares.has(id))
    .map((id) => {
      const s = shares.get(id)!;
      const material = round2(s.material);
      const edgeband = round2(s.edgeband);
      const hardwareCost = round2(s.hardware);
      return {
        cabinet: id,
        name: names.get(id) ?? "",
        netArea: round2(s.area / 1e6),
        material,
        edgeband,
        hardware: hardwareCost,
        total: round2(material + edgeband + hardwareCost),
      };
    });

  const sum = (rows: readonly { cost?: number }[]): number => round2(rows.reduce((a, r) => a + (r.cost ?? 0), 0));
  const unpriced = (rows: readonly { cost?: number }[]): number => rows.filter((r) => r.cost === undefined).length;
  const material = sum(materials);
  const edgeband = sum(edgebands);
  const hardwareTotal = sum(hardware);
  return {
    materials,
    edgebands,
    hardware,
    cabinets,
    totals: {
      material,
      edgeband,
      hardware: hardwareTotal,
      total: round2(material + edgeband + hardwareTotal),
      unpriced: { material: unpriced(materials), edgeband: unpriced(edgebands), hardware: unpriced(hardware) },
    },
  };
}

// ---------------------------------------------------------------------------
// Writers

export type BomSection = "material" | "edgeband" | "hardware" | "cabinet" | "total";

export type BomColumn = "section" | "item" | "name" | "article" | "count" | "net" | "qty" | "unit" | "price" | "cost" | "note";

export const BOM_COLUMNS: readonly BomColumn[] = ["section", "item", "name", "article", "count", "net", "qty", "unit", "price", "cost", "note"];

export interface BomText {
  /** Locale used for library names. */
  locale: string;
  header: (col: BomColumn) => string;
  section: (section: BomSection) => string;
  /** Unit name: "m2", "m", or a hardware item's unit ("pcs", "set", …). */
  unit: (unit: string) => string;
  /** Name of a total row: a section, or "all". */
  total: (of: "material" | "edgeband" | "hardware" | "all") => string;
  /** Note on a total that leaves out `n` rows without a price. */
  unpriced: (n: number) => string;
}

/** Anything that translates keys: the i18n Translator fits this shape. */
export interface BomTranslator {
  locale: string;
  t(key: string, params?: Record<string, string | number>): string;
  has(key: string): boolean;
}

/** Message keys the BOM writer reads (`bom.*`, `unit.*`). */
export function bomText(tr: BomTranslator): BomText {
  return {
    locale: tr.locale,
    header: (col) => tr.t(`bom.col.${col}`),
    section: (s) => tr.t(`bom.section.${s}`),
    unit: (u) => (tr.has(`unit.${u}`) ? tr.t(`unit.${u}`) : u),
    total: (of) => tr.t(`bom.total.${of}`),
    unpriced: (n) => tr.t("bom.unpriced", { n }),
  };
}

/** Cut lengths as "2× 562 mm, 1× 762 mm". */
export function formatLengths(lengths: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const l of lengths) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].map(([l, n]) => `${n}× ${formatNumber(l)} mm`).join(", ");
}

export interface BomTableOptions {
  /** Append the cost share per cabinet. */
  cabinets?: boolean;
  columns?: readonly BomColumn[];
}

/** Header row plus one row per material, edgeband, hardware item and total. */
export function bomTable(bom: Bom, result: Pick<ProjectResult, "library">, text: BomText, opts: BomTableOptions = {}): string[][] {
  const { library } = result;
  const columns = opts.columns ?? BOM_COLUMNS;
  const money = (x: number | undefined): string => (x === undefined ? "" : formatNumber(x));
  type Cells = Partial<Record<BomColumn, string>>;
  const rows: Cells[] = [];

  for (const m of bom.materials) {
    const item = library.materials.get(m.material);
    rows.push({
      section: text.section("material"),
      item: m.material,
      name: item ? localName(item.name, text.locale) : m.material,
      count: String(m.parts),
      net: formatNumber(m.netArea),
      qty: formatNumber(m.grossArea),
      unit: text.unit("m2"),
      price: money(m.pricePerM2),
      cost: money(m.cost),
    });
  }
  for (const b of bom.edgebands) {
    const item = library.edgebands.get(b.edgeband);
    rows.push({
      section: text.section("edgeband"),
      item: b.edgeband,
      name: item ? localName(item.name, text.locale) : b.edgeband,
      count: String(b.edges),
      net: formatNumber(b.netLength),
      qty: formatNumber(b.length),
      unit: text.unit("m"),
      price: money(b.pricePerM),
      cost: money(b.cost),
    });
  }
  for (const h of bom.hardware) {
    const item = library.hardware.get(h.item);
    rows.push({
      section: text.section("hardware"),
      item: h.item,
      name: item ? localName(item.name, text.locale) : h.item,
      article: h.article,
      qty: formatNumber(h.qty),
      unit: text.unit(h.unit),
      price: money(h.price),
      cost: money(h.cost),
      note: formatLengths(h.lengths),
    });
  }
  // A sum is only printed when at least one of its rows has a price.
  const t = bom.totals;
  const count = { material: bom.materials.length, edgeband: bom.edgebands.length, hardware: bom.hardware.length };
  const missingAll = t.unpriced.material + t.unpriced.edgeband + t.unpriced.hardware;
  const anyPrice = missingAll < count.material + count.edgeband + count.hardware;
  if (opts.cabinets) {
    for (const c of bom.cabinets) {
      rows.push({
        section: text.section("cabinet"),
        item: c.cabinet,
        name: c.name,
        net: formatNumber(c.netArea),
        unit: text.unit("m2"),
        cost: anyPrice ? money(c.total) : "",
      });
    }
  }
  const total = (of: "material" | "edgeband" | "hardware" | "all", cost: number, missing: number, priced: boolean): Cells => ({
    section: text.section("total"),
    name: text.total(of),
    cost: priced ? money(cost) : "",
    note: missing > 0 ? text.unpriced(missing) : "",
  });
  rows.push(
    total("material", t.material, t.unpriced.material, t.unpriced.material < count.material),
    total("edgeband", t.edgeband, t.unpriced.edgeband, t.unpriced.edgeband < count.edgeband),
    total("hardware", t.hardware, t.unpriced.hardware, t.unpriced.hardware < count.hardware),
    total("all", t.total, missingAll, anyPrice),
  );
  return [columns.map(text.header), ...rows.map((r) => columns.map((c) => r[c] ?? ""))];
}

/** CSV with LF line endings; byte-identical for identical input. */
export function bomCsv(bom: Bom, result: Pick<ProjectResult, "library">, text: BomText, opts: BomTableOptions & { delimiter?: string } = {}): string {
  return toCsv(bomTable(bom, result, text, opts), opts.delimiter ?? ",");
}
