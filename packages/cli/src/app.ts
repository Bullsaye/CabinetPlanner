import {
  bomCsv,
  bomTable,
  bomText,
  buildBom,
  buildProject,
  projectSheets,
  cutlistCsv,
  cutlistRows,
  cutlistTable,
  FileFormatError,
  formatNumber,
  drawAssembly,
  elevationSvg,
  floorPlanSvg,
  DxfProfileSchema,
  FACTORY_DXF_PROFILES,
  partDxf,
  zip,
  drawingText,
  drawPartSheets,
  stackSheets,
  FACTORY_STYLES,
  localName,
  resolveStyle,
  loadProject,
  loadShop,
  VARIABLE_BY_NAME,
  VARIABLES,
  type CutlistRow,
  type CutlistText,
  type Diagnostic,
  type ProjectResult,
  type Shop,
  type Source,
} from "@cabinet-planner/engine";
import { createTranslator, type Translator } from "@cabinet-planner/i18n";
import { parseArgs } from "node:util";

/**
 * The CLI as a function of (argv, io) so tests can run it without spawning
 * processes or touching the real file system.
 */
export interface Io {
  readFile(path: string): string;
  writeFile(path: string, content: string | Uint8Array): void;
  stdout(text: string): void;
  stderr(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
}

const USAGE = `Usage: cabinet-planner <command> <project.json> [options]

Commands:
  cutlist   Write the cutlist (CSV or a text table)
  bom       Write the bill of materials: board m² with waste, edgeband metres, hardware by
            article, prices and totals (CSV or a text table; --per-cabinet adds the cost per cabinet)
  resolve   Show every variable with its value and where it came from
  check     Validate the project and list errors and warnings
  ops       Show machining operations and hardware per part (part-local mm)
  drawing   Write an SVG drawing of one part (--part <id>, e.g. B01-SL)
  assembly  Write the assembly drawing of one cabinet: exploded view + part list (--cabinet <id>)
  room      Write the floor plan (or with --wall <id> that wall's elevation) as SVG
  dxf       Write CNC DXF files, one per machined part side (--out <dir> or --zip <file>;
            --cabinet / --part to limit; --profile <id> for the layer names)
  sheets    Write every drawing sheet as SVG: room plan and elevations, assembly drawings,
            part sheets (--out <dir> or --zip <file>; --cabinet to limit; --style)

Options:
  --shop <file>          Shop file with library, presets and shop defaults
  --lang <en|de>         Language for headers and messages (default: $LANG or en)
  --format <csv|table>   cutlist, bom: output format (default: csv)
  --group                cutlist: merge identical parts into one row with a quantity
  --per-cabinet          bom: add the cost share of every cabinet
  --delimiter <char>     CSV delimiter (default: ",")
  --out <file>           Write to a file instead of stdout
  --cabinet <id>         resolve, ops: only this cabinet; assembly: the cabinet to draw
  --part <id>            drawing: the part to draw
  --style <id>           drawing, sheets: machine (default), machine-iso, machine-chain, upright,
                         or a style from the shop/project library
  --sheet <n>            drawing: only sheet n of a part machined on both sides
                         (default: all sheets, stacked)
  -h, --help             Show this help
`;

export function run(argv: readonly string[], io: Io): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        shop: { type: "string" },
        lang: { type: "string" },
        format: { type: "string", default: "csv" },
        group: { type: "boolean", default: false },
        "per-cabinet": { type: "boolean", default: false },
        delimiter: { type: "string", default: "," },
        out: { type: "string" },
        cabinet: { type: "string" },
        part: { type: "string" },
        style: { type: "string" },
        sheet: { type: "string" },
        zip: { type: "string" },
        wall: { type: "string" },
        profile: { type: "string" },
        timestamp: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    io.stderr(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values: opts, positionals } = parsed;
  const [command, file] = positionals;
  if (opts.help || !command) {
    (opts.help ? io.stdout : io.stderr)(USAGE);
    return opts.help ? 0 : 2;
  }
  if (!["cutlist", "bom", "resolve", "check", "ops", "drawing", "assembly", "dxf", "sheets", "room"].includes(command) || !file) {
    io.stderr(USAGE);
    return 2;
  }
  if (opts.format !== "csv" && opts.format !== "table") {
    io.stderr(`--format must be csv or table\n`);
    return 2;
  }

  const tr = createTranslator(opts.lang ?? io.env["LANG"] ?? "en");

  let result: ProjectResult;
  let shopFile: Shop | undefined;
  try {
    const project = loadProject(readJson(io, file));
    shopFile = opts.shop ? loadShop(readJson(io, opts.shop)) : undefined;
    result = buildProject(project, shopFile);
  } catch (e) {
    if (e instanceof FileFormatError || e instanceof SyntaxError || isFsError(e)) {
      io.stderr(`${(e as Error).message}\n`);
      return 1;
    }
    throw e;
  }

  const emit = (text: string): void => {
    if (opts.out) {
      io.writeFile(opts.out, text);
      io.stderr(tr.t("cli.written", { file: opts.out }) + "\n");
    } else {
      io.stdout(text);
    }
  };

  switch (command) {
    case "check": {
      printDiagnostics(result.diagnostics, tr, io);
      if (result.project.cabinets.length === 0) io.stderr(tr.t("cli.no_cabinets") + "\n");
      return result.diagnostics.some((d) => d.severity === "error") ? 1 : 0;
    }
    case "resolve": {
      const cabinets = result.cabinets.filter((c) => !opts.cabinet || c.resolved.cabinet.id === opts.cabinet);
      const out: string[] = [];
      for (const c of cabinets) {
        out.push(`# ${c.resolved.cabinet.id}${c.resolved.cabinet.name ? " · " + c.resolved.cabinet.name : ""}`);
        const rows: string[][] = [
          [tr.t("cli.col.variable"), "", tr.t("cli.col.value"), tr.t("cli.col.expression"), tr.t("cli.col.source")],
        ];
        // Catalogue order first, then user-defined variables alphabetically.
        const names = [
          ...VARIABLES.map((d) => d.name),
          ...[...c.resolved.vars.keys()].filter((n) => !VARIABLE_BY_NAME.has(n)).sort(),
        ];
        for (const name of names) {
          const v = c.resolved.vars.get(name)!;
          rows.push([
            name,
            tr.has(`var.${name}`) ? tr.t(`var.${name}`) : "",
            v.value === undefined ? "?" : formatNumber(v.value),
            typeof v.input === "string" ? v.input : "",
            sourceLabel(v.source, tr),
          ]);
        }
        for (const o of c.resolved.options.values()) {
          rows.push([o.key, tr.t(`option.${o.key}`), String(o.value), "", sourceLabel(o.source, tr)]);
        }
        out.push(alignTable(rows));
      }
      emit(out.join("\n"));
      printDiagnostics(result.diagnostics, tr, io);
      return result.ok ? 0 : 1;
    }
    case "ops": {
      const cabinets = result.cabinets.filter((c) => !opts.cabinet || c.resolved.cabinet.id === opts.cabinet);
      const out: string[] = [];
      const f = (x: number): string => formatNumber(x);
      for (const c of cabinets) {
        out.push(`# ${c.resolved.cabinet.id}${c.resolved.cabinet.name ? " · " + c.resolved.cabinet.name : ""}`);
        const rows: string[][] = [
          [
            tr.t("col.part"),
            tr.t("cli.col.op"),
            tr.t("cli.col.face"),
            "u",
            "v",
            "w",
            tr.t("cli.col.diameter"),
            tr.t("cli.col.depth"),
            tr.t("cli.col.size"),
            tr.t("cli.col.from"),
          ],
        ];
        for (const p of c.parts) {
          for (const o of p.operations) {
            const from = o.sources.map((s) => `${s.kind}:${s.ref}`).join(" + ");
            if (o.kind === "bore") {
              rows.push([p.id, tr.t("cli.op.bore"), o.face, f(o.u), f(o.v), f(o.w), f(o.d), f(o.depth), "", from]);
            } else {
              rows.push([
                p.id,
                tr.t("cli.op.pocket"),
                o.face,
                f(o.u0),
                f(o.v0),
                f(o.w0),
                "",
                "",
                `${f(o.u1 - o.u0)} × ${f(o.v1 - o.v0)} × ${f(o.w1 - o.w0)}`,
                from,
              ]);
            }
          }
        }
        out.push(alignTable(rows));
        if (c.hardware.length) {
          out.push(`## ${tr.t("cli.hardware")}`);
          const hw: string[][] = [[tr.t("cli.col.item"), "", tr.t("cli.col.qty")]];
          for (const h of c.hardware) {
            const item = result.library.hardware.get(h.item);
            hw.push([h.item, item ? localName(item.name, tr.locale) : "", `${h.qty} ${tr.has(`unit.${h.unit}`) ? tr.t(`unit.${h.unit}`) : h.unit}`]);
          }
          out.push(alignTable(hw));
        }
      }
      emit(out.join("\n"));
      printDiagnostics(result.diagnostics, tr, io);
      return result.ok ? 0 : 1;
    }
    case "room": {
      const room = result.room;
      if (!room) {
        io.stderr(tr.t("cli.no_room") + "\n");
        return 1;
      }
      const text = drawingText(tr, result.library);
      if (opts.wall) {
        if (!room.walls.some((w) => w.id === opts.wall)) {
          io.stderr(tr.t("diag.room_unknown_wall", { wall: opts.wall }) + "\n");
          return 1;
        }
        emit(elevationSvg(room, opts.wall, result.cabinets, result.project.name, text));
      } else {
        emit(floorPlanSvg(room, result.project.name, text));
      }
      printDiagnostics(result.diagnostics, tr, io);
      return 0;
    }
    case "dxf": {
      if (!result.ok) {
        printDiagnostics(result.diagnostics, tr, io);
        io.stderr(tr.t("cli.errors_block_output") + "\n");
        return 1;
      }
      if (!opts.out && !opts.zip) {
        io.stderr("dxf needs --out <dir> or --zip <file>\n");
        return 2;
      }
      const profiles = [...FACTORY_DXF_PROFILES, ...(shopFile?.library.dxfProfiles ?? []), ...result.project.library.dxfProfiles];
      const profile = [...profiles].reverse().find((p) => p.id === (opts.profile ?? "generic"));
      if (!profile) {
        io.stderr(`unknown DXF profile "${opts.profile}"\n`);
        return 2;
      }
      const meta = {
        project: result.project.name,
        revision: result.project.revision,
        ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
      };
      const files = result.cabinets
        .filter((c) => !opts.cabinet || c.resolved.cabinet.id === opts.cabinet)
        .flatMap((c) => {
          const v = (n: string): number => c.resolved.values.get(n)!;
          return c.parts
            .filter((p) => !opts.part || p.id === opts.part)
            .flatMap((p) => partDxf(p, { W: v("W"), H: v("H"), D: v("D") }, DxfProfileSchema.parse(profile), meta));
        });
      if (opts.zip) {
        io.writeFile(opts.zip, zip(files.map((f) => ({ name: f.name, data: f.content }))));
        io.stderr(tr.t("cli.written", { file: `${opts.zip} (${files.length} DXF)` }) + "\n");
      } else {
        for (const f of files) io.writeFile(`${opts.out}/${f.name}`, f.content);
        io.stderr(tr.t("cli.written", { file: `${files.length} DXF → ${opts.out}` }) + "\n");
      }
      printDiagnostics(result.diagnostics, tr, io);
      return 0;
    }
    case "assembly": {
      const c = result.cabinets.find((x) => x.resolved.cabinet.id === opts.cabinet) ?? (opts.cabinet ? undefined : result.cabinets[0]);
      if (!c) {
        io.stderr(tr.t("cli.cabinet_not_found", { cabinet: opts.cabinet ?? "" }) + "\n");
        return 1;
      }
      if (c.parts.length === 0) {
        printDiagnostics(result.diagnostics, tr, io);
        io.stderr(tr.t("cli.errors_block_output") + "\n");
        return 1;
      }
      const v = (n: string): number => c.resolved.values.get(n)!;
      const cab = c.resolved.cabinet;
      emit(
        drawAssembly({
          cabinet: { id: cab.id, ...(cab.name ? { name: cab.name } : {}), W: v("W"), H: v("H"), D: v("D") },
          parts: c.parts,
          hardware: c.hardware,
          library: result.library,
          text: drawingText(tr, result.library),
          project: { name: result.project.name, revision: result.project.revision },
        }).svg,
      );
      printDiagnostics(result.diagnostics, tr, io);
      return result.ok ? 0 : 1;
    }
    case "drawing": {
      const part = result.parts.find((p) => p.id === opts.part);
      if (!part) {
        io.stderr(tr.t("cli.part_not_found", { part: opts.part ?? "" }) + "\n");
        printDiagnostics(result.diagnostics, tr, io);
        return opts.part ? 1 : 2;
      }
      const styles = [...(shopFile?.library.drawingStyles ?? []), ...result.project.library.drawingStyles];
      let style;
      try {
        style = resolveStyle(opts.style ?? "machine", styles);
      } catch (e) {
        io.stderr(`${(e as Error).message}\n`);
        return 2;
      }
      const styleInput = [...FACTORY_STYLES, ...styles].reverse().find((x) => x.id === style.id)!;
      const cab = result.cabinets.find((c) => c.resolved.cabinet.id === part.cabinet)!;
      const v = (n: string): number => cab.resolved.values.get(n)!;
      const sheets = drawPartSheets({
        part,
        cabinet: { W: v("W"), H: v("H"), D: v("D") },
        style,
        text: drawingText(tr, result.library, localName(styleInput.name, tr.locale)),
      });
      if (opts.sheet !== undefined) {
        const n = Number(opts.sheet);
        const one = sheets[n - 1];
        if (!one) {
          io.stderr(`--sheet must be 1${sheets.length > 1 ? `–${sheets.length}` : ""}\n`);
          return 2;
        }
        emit(one.svg);
      } else {
        emit(stackSheets(sheets));
      }
      printDiagnostics(result.diagnostics, tr, io);
      return result.ok ? 0 : 1;
    }
    case "bom": {
      if (!result.ok) {
        printDiagnostics(result.diagnostics, tr, io);
        io.stderr(tr.t("cli.errors_block_output") + "\n");
        return 1;
      }
      const bom = buildBom(result);
      const text = bomText(tr);
      const tableOpts = { cabinets: opts["per-cabinet"] };
      emit(
        opts.format === "csv"
          ? bomCsv(bom, result, text, { ...tableOpts, delimiter: opts.delimiter })
          : alignTable(bomTable(bom, result, text, tableOpts)),
      );
      printDiagnostics(result.diagnostics, tr, io);
      return 0;
    }
    case "sheets": {
      if (!opts.out && !opts.zip) {
        io.stderr("sheets needs --out <dir> or --zip <file>\n");
        return 2;
      }
      if (opts.cabinet && !result.cabinets.some((c) => c.resolved.cabinet.id === opts.cabinet)) {
        io.stderr(tr.t("cli.cabinet_not_found", { cabinet: opts.cabinet }) + "\n");
        return 1;
      }
      const styles = [...(shopFile?.library.drawingStyles ?? []), ...result.project.library.drawingStyles];
      let style;
      try {
        style = resolveStyle(opts.style ?? "machine", styles);
      } catch (e) {
        io.stderr(`${(e as Error).message}\n`);
        return 2;
      }
      const styleInput = [...FACTORY_STYLES, ...styles].reverse().find((x) => x.id === style.id)!;
      const sheets = projectSheets(result, {
        tr,
        style,
        styleName: localName(styleInput.name, tr.locale),
        ...(opts.cabinet ? { cabinet: opts.cabinet } : {}),
      });
      const count = tr.t("cli.sheets", { n: sheets.length });
      if (opts.zip) {
        io.writeFile(opts.zip, zip(sheets.map((s) => ({ name: s.name, data: s.svg }))));
        io.stderr(tr.t("cli.written", { file: `${opts.zip} (${count})` }) + "\n");
      } else {
        for (const s of sheets) io.writeFile(`${opts.out}/${s.name}`, s.svg);
        io.stderr(tr.t("cli.written", { file: `${count} → ${opts.out}` }) + "\n");
      }
      printDiagnostics(result.diagnostics, tr, io);
      return result.ok ? 0 : 1;
    }
    case "cutlist": {
      if (!result.ok) {
        printDiagnostics(result.diagnostics, tr, io);
        io.stderr(tr.t("cli.errors_block_output") + "\n");
        return 1;
      }
      const rows = cutlistRows(result.parts, result.library, { group: opts.group });
      const text = cutlistText(tr);
      emit(
        opts.format === "csv"
          ? cutlistCsv(rows, result.library, text, { delimiter: opts.delimiter })
          : alignTable(cutlistTable(rows, result.library, text)),
      );
      printDiagnostics(result.diagnostics, tr, io);
      return 0;
    }
  }
  return 2;
}

export function cutlistText(tr: Translator): CutlistText {
  return {
    locale: tr.locale,
    shaped: tr.t("cutlist.shaped"),
    header: (col) => tr.t(`col.${col}`),
    role: (row: CutlistRow) => {
      if (row.qty > 1 && (row.role === "side_left" || row.role === "side_right")) {
        const roles = new Set(row.parts.map((p) => p.slice(p.lastIndexOf("-") + 1)));
        if (roles.has("SL") && roles.has("SR")) return tr.t("role.side_pair");
      }
      if (row.qty > 1 && (row.role === "rail_front" || row.role === "rail_rear")) {
        const roles = new Set(row.parts.map((p) => p.slice(p.lastIndexOf("-") + 1)));
        if (roles.has("RF") && roles.has("RR")) return tr.t("role.rail_pair");
      }
      return tr.t(`role.${row.role}`);
    },
  };
}

function sourceLabel(s: Source, tr: Translator): string {
  return tr.t(`layer.${s.layer}`) + (s.preset ? ` · ${s.preset}` : "");
}

function printDiagnostics(diags: readonly Diagnostic[], tr: Translator, io: Io): void {
  for (const d of diags) {
    const where = [d.cabinet, d.part ?? d.variable].filter(Boolean).join(" ");
    io.stderr(`${tr.t(`severity.${d.severity}`)}${where ? ` [${where}]` : ""}: ${tr.t(`diag.${d.code}`, d.params)}\n`);
  }
  const errors = diags.filter((d) => d.severity === "error").length;
  const warnings = diags.length - errors;
  if (diags.length > 0) io.stderr(tr.t("cli.summary", { errors, warnings }) + "\n");
}

/** Plain text table with columns padded to equal width. */
export function alignTable(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  rows.forEach((r) => r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, [...c].length))));
  return (
    rows
      .map((r) =>
        r
          .map((c, i) => c + " ".repeat(widths[i]! - [...c].length))
          .join("  ")
          .trimEnd(),
      )
      .join("\n") + "\n"
  );
}

function readJson(io: Io, path: string): unknown {
  const text = io.readFile(path);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SyntaxError(`${path}: ${(e as Error).message}`);
  }
}

const isFsError = (e: unknown): boolean =>
  typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string";
