import blumClipTop from "../../library/hardware/blum-cliptop-110-inserta.json" with { type: "json" };
import genericSlide from "../../library/hardware/generic-undermount.json" with { type: "json" };
import grassDynapro from "../../library/hardware/grass-dynapro-40.json" with { type: "json" };
import grassNovaPro from "../../library/hardware/grass-nova-pro-scala-40.json" with { type: "json" };
import bar128 from "../../library/hardware/generic-bar-128.json" with { type: "json" };
import bar160 from "../../library/hardware/generic-bar-160.json" with { type: "json" };
import bar192 from "../../library/hardware/generic-bar-192.json" with { type: "json" };
import knob from "../../library/hardware/generic-knob.json" with { type: "json" };
import dowel from "../../library/hardware/dowel-8x35.json" with { type: "json" };
import hinge from "../../library/hardware/generic-hinge-110.json" with { type: "json" };
import grassTiomosK3 from "../../library/hardware/grass-tiomos-110-k3-screw.json" with { type: "json" };
import grassTiomos from "../../library/hardware/grass-tiomos-110-screw.json" with { type: "json" };
import hettichDuplo from "../../library/hardware/hettich-duplo-5.json" with { type: "json" };
import hettichSensysFlash from "../../library/hardware/hettich-sensys-8645i-flash.json" with { type: "json" };
import hettichSensysScrew from "../../library/hardware/hettich-sensys-8645i-screw.json" with { type: "json" };
import leg100 from "../../library/hardware/generic-leg-100.json" with { type: "json" };
import leg100Screwed from "../../library/hardware/generic-leg-100-screwed.json" with { type: "json" };
import leg150 from "../../library/hardware/generic-leg-150.json" with { type: "json" };
import leg60 from "../../library/hardware/generic-leg-60.json" with { type: "json" };
import rail from "../../library/hardware/generic-wardrobe-rail.json" with { type: "json" };
import minifix from "../../library/hardware/hafele-minifix-15.json" with { type: "json" };
import rastex from "../../library/hardware/hettich-rastex-15.json" with { type: "json" };
import clamex from "../../library/hardware/lamello-clamex-p14.json" with { type: "json" };
import confirmat from "../../library/hardware/generic-confirmat-7x50.json" with { type: "json" };
import cabinetScrew from "../../library/hardware/generic-cabinet-connector-screw.json" with { type: "json" };
import sah130 from "../../library/hardware/hettich-sah-130.json" with { type: "json" };
import aventosHk from "../../library/hardware/blum-aventos-hk-top.json" with { type: "json" };
import chipScrew from "../../library/hardware/generic-chipboard-screw-4x50.json" with { type: "json" };
import liftHk from "../../library/hardware/hettich-lift-advanced-hk.json" with { type: "json" };
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
  bar128,
  bar160,
  bar192,
  knob,
  leg100,
  leg100Screwed,
  leg150,
  leg60,
  rail,
  minifix,
  rastex,
  clamex,
  confirmat,
  cabinetScrew,
  sah130,
  aventosHk,
  chipScrew,
  liftHk,
];

export const FACTORY_HARDWARE: readonly HardwareItem[] = RAW.map((raw) => HardwareItem.parse(raw));
