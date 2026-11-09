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
export * from "./presets.ts";
export * from "./templates.ts";
export * from "./part.ts";
export * from "./project.ts";
export { buildBox, gridPositions, layoutFronts, type BoxLayout, type PlacedFront } from "./cabinet/box.ts";
export { machineBox, dowelPositions, type Fitting, type HandlePlacement, type HardwareUse } from "./cabinet/machining.ts";
export * from "./ops.ts";
export * from "./text.ts";
export { HardwareItem, DrillOp } from "./hardware/schema.ts";
export { FACTORY_HARDWARE } from "./hardware/factory.ts";
export * from "./output/format.ts";
export * from "./output/cutlist.ts";
export * from "./output/scene.ts";
export * from "./output/dxf.ts";
export * from "./output/zip.ts";
export * from "./room/room.ts";
export * from "./room/room-svg.ts";
export * from "./drawing/index.ts";
