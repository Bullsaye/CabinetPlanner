/**
 * Cabinet Planner engine. Pure TypeScript: no DOM, no Node APIs, no UI text.
 * Runs unchanged in the app, the CLI and tests.
 */
export * from "./expr/index.ts";
export * from "./diagnostics.ts";
export * from "./graph.ts";
export * from "./catalog.ts";
export * from "./library.ts";
export * from "./schema.ts";
export * from "./resolve.ts";
export * from "./packs.ts";
export * from "./bundled.ts";
export * from "./templates.ts";
export * from "./part.ts";
export * from "./project.ts";
export { buildBox, gridPositions, layoutFronts, type BoxLayout, type PlacedFront } from "./cabinet/box.ts";
export { machineBox, dowelPositions, type Fitting, type HandlePlacement, type HardwareUse } from "./cabinet/machining.ts";
export * from "./ops.ts";
export * from "./text.ts";
export { HardwareItem, DrillOp } from "./hardware/schema.ts";
export * from "./output/format.ts";
export * from "./output/cutlist.ts";
export * from "./output/bom.ts";
export * from "./output/scene.ts";
export * from "./output/fittings.ts";
export * from "./output/frontview.ts";
export * from "./output/dxf.ts";
export * from "./output/zip.ts";
export * from "./output/sheets.ts";
export * from "./output/paper.ts";
export * from "./output/pdf.ts";
export { deflate, inflate } from "./output/deflate.ts";
export { readFont, type FontFile } from "./output/font.ts";
export * from "./room/room.ts";
export * from "./room/room-svg.ts";
export * from "./room/links.ts";
export * from "./drawing/index.ts";
