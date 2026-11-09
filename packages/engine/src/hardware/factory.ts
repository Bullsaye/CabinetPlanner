import blumClipTop from "../../library/hardware/blum-cliptop-110-inserta.json" with { type: "json" };
import genericSlide from "../../library/hardware/generic-undermount.json" with { type: "json" };
import grassDynapro from "../../library/hardware/grass-dynapro-40.json" with { type: "json" };
import grassNovaPro from "../../library/hardware/grass-nova-pro-scala-40.json" with { type: "json" };
import dowel from "../../library/hardware/dowel-8x35.json" with { type: "json" };
import hinge from "../../library/hardware/generic-hinge-110.json" with { type: "json" };
import grassTiomosK3 from "../../library/hardware/grass-tiomos-110-k3-screw.json" with { type: "json" };
import grassTiomos from "../../library/hardware/grass-tiomos-110-screw.json" with { type: "json" };
import hettichDuplo from "../../library/hardware/hettich-duplo-5.json" with { type: "json" };
import hettichSensysFlash from "../../library/hardware/hettich-sensys-8645i-flash.json" with { type: "json" };
import hettichSensysScrew from "../../library/hardware/hettich-sensys-8645i-screw.json" with { type: "json" };
import shelfPin from "../../library/hardware/shelf-pin-5.json" with { type: "json" };
import { HardwareItem } from "./schema.ts";

/**
 * Factory hardware library. Each item is a plain JSON file in
 * `packages/engine/library/hardware/` so it can be read, diffed and shared
 * like user items. Every file there must be listed here (a test checks it).
 * Brand items carry their sources; all are `untested` until machined.
 */
const RAW: readonly unknown[] = [
  hinge,
  dowel,
  shelfPin,
  hettichSensysScrew,
  hettichSensysFlash,
  hettichDuplo,
  blumClipTop,
  grassTiomos,
  grassTiomosK3,
  genericSlide,
  grassDynapro,
  grassNovaPro,
];

export const FACTORY_HARDWARE: readonly HardwareItem[] = RAW.map((raw) => HardwareItem.parse(raw));
