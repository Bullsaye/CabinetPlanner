import { buildProject, loadProject, type Part, type ProjectResult } from "../src/index.ts";

/** Builds a one-cabinet project from partial input. */
export function buildOne(
  /** Cabinet input as written in a file (defaults may be left out). */
  cabinet: Record<string, unknown> = {},
  project: Record<string, unknown> = {},
): ProjectResult {
  return buildProject(
    loadProject({
      schemaVersion: 1,
      name: "test",
      ...project,
      cabinets: [{ id: "C1", type: "box", ...cabinet }],
    }),
  );
}

export function partsByCode(r: ProjectResult): Record<string, Part> {
  return Object.fromEntries(r.parts.map((p) => [p.code, p]));
}

/** L × W × T as a compact string for readable assertions. */
export const size = (p: Part | undefined): string => (p ? `${p.length} × ${p.width} × ${p.thickness}` : "missing");
