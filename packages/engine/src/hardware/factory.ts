import dowel from "../../library/hardware/dowel-8x35.json" with { type: "json" };
import hinge from "../../library/hardware/generic-hinge-110.json" with { type: "json" };
import shelfPin from "../../library/hardware/shelf-pin-5.json" with { type: "json" };
import { HardwareItem } from "./schema.ts";

/**
 * Factory hardware seed. Each item is a plain JSON file in
 * `packages/engine/library/hardware/` so it can be read, diffed and shared
 * like user items. Values are generic and marked untested.
 */
export const FACTORY_HARDWARE: readonly HardwareItem[] = [hinge, dowel, shelfPin].map((raw) =>
  HardwareItem.parse(raw),
);
