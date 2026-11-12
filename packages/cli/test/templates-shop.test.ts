import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLED, buildProject, loadProject, loadShop } from "@cabinet-planner/engine";

/** What a user of the app gets: every factory template with the example shop's defaults. */
describe("factory templates with the example shop", () => {
  const shop = loadShop(JSON.parse(readFileSync(new URL("../../../examples/shop.json", import.meta.url), "utf8")));
  it.each(BUNDLED.templates.map((t) => [t.id, t] as const))("%s builds without findings", (_, t) => {
    const r = buildProject(loadProject({ schemaVersion: 1, name: "T", cabinets: [{ id: "X1", type: "box", ...t.cabinet }] }), shop);
    expect(r.diagnostics.map((d) => `${d.severity}:${d.code}:${JSON.stringify(d.params)}`)).toEqual([]);
  });
});
