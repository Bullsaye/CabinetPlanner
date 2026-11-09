import {
  buildProject,
  cutlistCsv,
  cutlistRows,
  cutlistTable,
  FileFormatError,
  formatNumber,
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
  writeFile(path: string, content: string): void;
  stdout(text: string): void;
  stderr(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
}

const USAGE = `Usage: cabinet-planner <command> <project.json> [options]

Commands:
  cutlist   Write the cutlist (CSV or a text table)
  resolve   Show every variable with its value and where it came from
  check     Validate the project and list errors and warnings

Options:
  --shop <file>          Shop file with library, presets and shop defaults
  --lang <en|de>         Language for headers and messages (default: $LANG or en)
  --format <csv|table>   cutlist output format (default: csv)
  --group                Merge identical parts into one row with a quantity
  --delimiter <char>     CSV delimiter (default: ",")
  --out <file>           Write to a file instead of stdout
  --cabinet <id>         resolve: only this cabinet
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
        delimiter: { type: "string", default: "," },
        out: { type: "string" },
        cabinet: { type: "string" },
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
  if (!["cutlist", "resolve", "check"].includes(command) || !file) {
    io.stderr(USAGE);
    return 2;
  }
  if (opts.format !== "csv" && opts.format !== "table") {
    io.stderr(`--format must be csv or table\n`);
    return 2;
  }

  const tr = createTranslator(opts.lang ?? io.env["LANG"] ?? "en");

  let result: ProjectResult;
  try {
    const project = loadProject(readJson(io, file));
    const shop: Shop | undefined = opts.shop ? loadShop(readJson(io, opts.shop)) : undefined;
    result = buildProject(project, shop);
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
      return result.ok ? 0 : 1;
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
