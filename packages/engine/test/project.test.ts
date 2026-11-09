import { describe, expect, it } from "vitest";
import { buildProject, cutlistRows, FileFormatError, loadProject, loadShop, SCHEMA_VERSION } from "../src/index.ts";
import { buildOne } from "./helpers.ts";

describe("project files", () => {
  it("fills defaults for a minimal project", () => {
    const p = loadProject({ schemaVersion: 1, name: "x" });
    expect(p).toMatchObject({ kind: "project", revision: 1, cabinets: [], vars: {}, presets: [] });
  });

  it("rejects missing, newer or malformed versions", () => {
    expect(() => loadProject({ name: "x" })).toThrow(FileFormatError);
    expect(() => loadProject({ schemaVersion: SCHEMA_VERSION + 1, name: "x" })).toThrow(/newer/);
    expect(() => loadProject([])).toThrow(FileFormatError);
  });

  it("reports schema problems with paths", () => {
    try {
      loadProject({ schemaVersion: 1, name: "x", cabinets: [{ id: "B-01", type: "box" }] });
      expect.unreachable();
    } catch (e) {
      expect((e as FileFormatError).issues[0]!.path).toBe("cabinets.0.id");
    }
  });

  it("rejects duplicate cabinet ids", () => {
    expect(() =>
      loadProject({
        schemaVersion: 1,
        name: "x",
        cabinets: [
          { id: "B01", type: "box" },
          { id: "B01", type: "box" },
        ],
      }),
    ).toThrow(/duplicate cabinet id/);
  });

  it("loads a shop file", () => {
    const s = loadShop({ schemaVersion: 1, kind: "shop" });
    expect(s.defaults).toEqual({ presets: [], vars: {}, options: {} });
  });

  it("keeps errors per cabinet so other cabinets still build", () => {
    const r = buildProject(
      loadProject({
        schemaVersion: 1,
        name: "x",
        cabinets: [
          { id: "A", type: "box", vars: { W: "oops +" } },
          { id: "B", type: "box" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.cabinets[0]!.parts).toEqual([]);
    expect(r.cabinets[1]!.parts.length).toBeGreaterThan(0);
  });
});

describe("cutlist rows", () => {
  it("groups identical parts and keeps their ids", () => {
    const r = buildOne({ vars: { W: 800, door_count: 2, shelf_count: 2 } });
    const rows = cutlistRows(r.parts, r.library, { group: true });
    const sides = rows.find((x) => x.role === "side_left")!;
    expect(sides.qty).toBe(2);
    expect(sides.parts).toEqual(["C1-SL", "C1-SR"]);
    expect(rows.find((x) => x.role === "door")!.qty).toBe(2);
    expect(rows.find((x) => x.role === "shelf")!.qty).toBe(2);
    // Rails differ in banding, so they stay separate.
    expect(rows.filter((x) => x.role.startsWith("rail")).map((x) => x.qty)).toEqual([1, 1]);
  });
});
