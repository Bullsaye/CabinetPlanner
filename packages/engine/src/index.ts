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
export * from "./part.ts";
export * from "./project.ts";
export { buildBox, gridPositions, type BoxLayout } from "./cabinet/box.ts";
export { machineBox, dowelPositions, type HardwareUse } from "./cabinet/machining.ts";
export * from "./ops.ts";
export * from "./text.ts";
export { HardwareItem, DrillOp } from "./hardware/schema.ts";
export { FACTORY_HARDWARE } from "./hardware/factory.ts";
export * from "./output/format.ts";
export * from "./output/cutlist.ts";
