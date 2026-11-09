import { z } from "zod";
import { buildBox } from "./cabinet/box.ts";
import { machineBox, type HandlePlacement, type HardwareUse } from "./cabinet/machining.ts";
import { hasErrors, type Diagnostic } from "./diagnostics.ts";
import { buildLibrary, FACTORY_LIBRARY, type Library } from "./library.ts";
import { ROLE_ORDER, type Part } from "./part.ts";
import { presetRegistry, resolveCabinet, type ResolvedCabinet } from "./resolve.ts";
import { ProjectSchema, SCHEMA_VERSION, ShopSchema, type Project, type Shop } from "./schema.ts";

export class FileFormatError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(kind: string, issues: { path: string; message: string }[]) {
    super(`invalid ${kind} file:\n` + issues.map((i) => `  ${i.path || "(root)"}: ${i.message}`).join("\n"));
    this.name = "FileFormatError";
    this.issues = issues;
  }
}

/**
 * Migrations from version N to N+1, keyed by N. Empty while there is only
 * version 1; every schema change adds one entry and a test with an old file.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

/** Lifts a raw document to the current schema version. */
export function migrate(raw: unknown, kind: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new FileFormatError(kind, [{ path: "", message: "expected a JSON object" }]);
  }
  let doc = raw as Record<string, unknown>;
  let version = doc["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new FileFormatError(kind, [{ path: "schemaVersion", message: "missing or not an integer" }]);
  }
  if (version > SCHEMA_VERSION) {
    throw new FileFormatError(kind, [
      { path: "schemaVersion", message: `version ${version} is newer than this engine supports (${SCHEMA_VERSION})` },
    ]);
  }
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new FileFormatError(kind, [{ path: "schemaVersion", message: `no migration from ${version}` }]);
    doc = { ...step(doc), schemaVersion: version + 1 };
    version++;
  }
  return doc;
}

const toIssues = (e: z.ZodError): { path: string; message: string }[] =>
  e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

export function loadProject(raw: unknown): Project {
  const r = ProjectSchema.safeParse(migrate(raw, "project"));
  if (!r.success) throw new FileFormatError("project", toIssues(r.error));
  return r.data;
}

export function loadShop(raw: unknown): Shop {
  const r = ShopSchema.safeParse(migrate(raw, "shop"));
  if (!r.success) throw new FileFormatError("shop", toIssues(r.error));
  return r.data;
}

export interface CabinetResult {
  resolved: ResolvedCabinet;
  parts: Part[];
  /** Hardware and consumables, aggregated per library item. */
  hardware: HardwareUse[];
  /** Handles and knobs with their hole positions (cabinet coordinates). */
  handles: HandlePlacement[];
  diagnostics: Diagnostic[];
}

export interface ProjectResult {
  project: Project;
  library: Library;
  cabinets: CabinetResult[];
  /** All parts of all cabinets, in project order then role order. */
  parts: Part[];
  diagnostics: Diagnostic[];
  ok: boolean;
}

/**
 * The whole pipeline: presets → variables → rules → parts. A pure function
 * of its inputs; every output writer reads the result of this.
 */
export function buildProject(project: Project, shop?: Shop): ProjectResult {
  const library = buildLibrary(FACTORY_LIBRARY, shop?.library ?? {}, project.library);
  const presets = presetRegistry(shop, project);
  // A shop file wins over an inline `shop` block in the project.
  const shopLayer = shop?.defaults ?? project.shop;

  const cabinets: CabinetResult[] = [];
  for (const cabinet of project.cabinets) {
    const resolved = resolveCabinet(project, cabinet, { library, presets, shop: shopLayer });
    const diagnostics = [...resolved.diagnostics];
    let parts: Part[] = [];
    let hardware: HardwareUse[] = [];
    let handles: HandlePlacement[] = [];
    if (!hasErrors(diagnostics)) {
      const built = buildBox(resolved, library);
      parts = sortParts(built.parts);
      diagnostics.push(...built.diagnostics);
      // Machining needs sound geometry; skip it when the parts are already wrong.
      if (!hasErrors(built.diagnostics)) {
        const machined = machineBox(resolved, library, parts, built.layout);
        diagnostics.push(...machined.diagnostics);
        hardware = machined.hardware;
        handles = machined.handles;
      }
    }
    cabinets.push({ resolved, parts, hardware, handles, diagnostics });
  }
  const diagnostics = cabinets.flatMap((c) => c.diagnostics);
  return {
    project,
    library,
    cabinets,
    parts: cabinets.flatMap((c) => c.parts),
    diagnostics,
    ok: !hasErrors(diagnostics),
  };
}

function sortParts(parts: Part[]): Part[] {
  return [...parts].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.index ?? 0) - (b.index ?? 0),
  );
}
