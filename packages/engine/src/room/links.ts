import type { CabinetResult } from "../project.ts";
import type { Diagnostic } from "../diagnostics.ts";
import { evaluateItemParams } from "../hardware/evaluate.ts";
import type { Library } from "../library.ts";
import { addThroughBore, boreWouldCollide, type ThroughMode } from "../ops.ts";
import { roundMm } from "../part.ts";
import type { CabinetPlacement, RoomLayout } from "./room.ts";

/**
 * Neighbours in the room (D37). A carcase side is hidden when another unit
 * of the same height band stands against it, or when it meets a wall or
 * the units of the adjoining wall in a corner; otherwise it is visible.
 */
export interface Neighbours {
  left?: CabinetPlacement;
  right?: CabinetPlacement;
  visible: { left: boolean; right: boolean };
}

const band = (a: CabinetPlacement, b: CabinetPlacement): boolean => a.baseY < b.baseY + b.H - 1 && b.baseY < a.baseY + a.H - 1;

export function neighbours(room: RoomLayout): Map<string, Neighbours> {
  const out = new Map<string, Neighbours>();
  const walls = new Map(room.walls.map((w) => [w.id, w]));
  for (const q of room.placements) {
    const wall = walls.get(q.wall)!;
    const same = room.placements.filter((r) => r !== q && r.wall === q.wall && band(q, r));
    const left = same.find((r) => Math.abs(r.x + r.W - q.x) < 1);
    const right = same.find((r) => Math.abs(q.x + q.W - r.x) < 1);
    // Corner: units of the previous / next wall standing in front of this end.
    const prev = room.walls[wall.index - 1];
    const next = room.walls[wall.index + 1];
    const cornerLeft =
      !!prev && prev.turn === "right" && room.placements.some((r) => r.wall === prev.id && band(q, r) && r.x + r.W >= prev.length - 1 && r.depth >= q.x - 1);
    const cornerRight =
      !!next && wall.turn === "right" && room.placements.some((r) => r.wall === next.id && band(q, r) && r.x <= q.depth + 1 && r.depth >= wall.length - q.x - q.W - 1);
    out.set(q.cabinet, {
      ...(left ? { left } : {}),
      ...(right ? { right } : {}),
      visible: {
        left: !left && q.x > 1 && !cornerLeft,
        right: !right && q.x + q.W < wall.length - 1 && !cornerRight,
      },
    });
  }
  return out;
}

/**
 * Screws between neighbouring cabinets (option cabinet_link, D37): through
 * holes in the right side of one and the left side of the next, at the same
 * heights, `link_offset_front` behind the carcase front and spread between
 * `link_offset_end` from the shared top and bottom, at most
 * `link_max_spacing` apart. A position blocked in either side moves up in
 * pitch steps. Settings come from the left cabinet of each pair.
 */
export function linkCabinets(room: RoomLayout, cabinets: readonly CabinetResult[], library: Library): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(cabinets.map((c) => [c.resolved.cabinet.id, c]));
  for (const [id, n] of neighbours(room)) {
    if (!n.right) continue;
    const a = byId.get(id);
    const b = byId.get(n.right.cabinet);
    const qa = room.placements.find((p) => p.cabinet === id)!;
    const qb = n.right;
    if (!a || !b || a.resolved.options.get("cabinet_link")?.value !== "screws") continue;
    const sr = a.parts.find((p) => p.role === "side_right");
    const sl = b.parts.find((p) => p.role === "side_left");
    if (!sr || !sl) continue;
    const v = (n: string): number => a.resolved.values.get(n)!;
    const item = library.hardware.get(a.resolved.options.get("hardware.link")?.value as string);
    if (!item) continue;
    const params = evaluateItemParams(item, a.resolved.values, { cabinet: id });
    const d = params.values.get("d") ?? 5;
    // Shared height band in room coordinates, and the shallower carcase front.
    const y0 = Math.max(qa.baseY, qb.baseY) + v("link_offset_end");
    const y1 = Math.min(qa.baseY + qa.H, qb.baseY + qb.H) - v("link_offset_end");
    const zFront = Math.min(qa.carcaseD, qb.carcaseD) - v("link_offset_front");
    if (y1 < y0) continue;
    const n0 = Math.max(2, Math.ceil((y1 - y0) / v("link_max_spacing") - 1e-9) + 1);
    const ys = Array.from({ length: n0 }, (_, i) => y0 + ((y1 - y0) * i) / (n0 - 1));
    const mode = a.resolved.options.get("bore.through")!.value as ThroughMode;
    const overlap = v("through_overlap");
    const minWall = v("bore_min_wall");
    const pitch = v("sys_pitch");
    let placed = 0;
    for (const yRoom of ys) {
      let y = yRoom;
      const free = (yy: number): boolean => {
        const pa = { x: sr.box.x, y: yy - qa.baseY, z: zFront };
        const pb = { x: sl.box.x + sl.box.dx, y: yy - qb.baseY, z: zFront };
        if (pa.y < sr.box.y || pa.y > sr.box.y + sr.box.dy || pb.y < sl.box.y || pb.y > sl.box.y + sl.box.dy) return false;
        return !boreWouldCollide(sr, pa, "+x", d, sr.thickness, minWall) && !boreWouldCollide(sl, pb, "-x", d, sl.thickness, minWall);
      };
      for (let k = 1; k <= 3 && !free(y); k++) y = yRoom + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * pitch;
      if (!free(y)) continue;
      const src = { kind: "hardware" as const, ref: item.id };
      addThroughBore(sr, { x: sr.box.x, y: roundMm(y - qa.baseY), z: zFront }, "+x", d, mode, overlap, src);
      addThroughBore(sl, { x: sl.box.x + sl.box.dx, y: roundMm(y - qb.baseY), z: zFront }, "-x", d, mode, overlap, src);
      placed++;
    }
    if (placed) {
      const use = a.hardware.find((h) => h.item === item.id);
      if (use) use.qty += placed * item.bom.perPlacement;
      else a.hardware.push({ item: item.id, qty: placed * item.bom.perPlacement, unit: item.bom.unit });
      a.hardware.sort((x, y) => x.item.localeCompare(y.item));
    } else {
      diagnostics.push({ severity: "warning", code: "cabinet_link_blocked", params: { a: id, b: qb.cabinet }, cabinet: id });
    }
  }
  return diagnostics;
}
