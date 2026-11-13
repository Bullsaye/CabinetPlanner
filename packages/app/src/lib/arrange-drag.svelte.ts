/**
 * One drag of a cabinet along the walls (D69), shared by the floor plan and
 * the room 3D view: both hand in the pointer as a plan point (D28) and draw
 * what comes back. The rules are those of `arrange.ts`; this part holds the
 * drag's state, writes the project and keeps the drag one undo step.
 */
import type { CabinetPlacement, WallLayout } from "@cabinet-planner/engine";
import { applyMove, insertion, itemsOf, levelOf, nearestWall, onWall, simulate, snapX, withInserted, type Anchor, type ArrItem, type Level, type Vec2 } from "./arrange.ts";
import { store } from "./store.svelte.ts";

type Doc = { id: string; place?: Record<string, any>; [k: string]: any };

/** A cabinet-sized place on a wall: from `x` along it, `depth` into the room. */
export interface DragBox {
  wall: string;
  x: number;
  W: number;
  depth: number;
}
/** What to draw for the drag at the pointer's place. */
export interface DragShow {
  /** The dragged cabinet under the pointer. */
  ghost: DragBox;
  /** Fixed position: the x it would get. */
  label?: number;
  /** Fixed position: the edge (along the wall) it snapped to. */
  guide?: number;
  /** Run, when the project is not rebuilt during the drag: cabinets that would move. */
  preview: { id: string; from: DragBox; to: DragBox }[];
}

/**
 * How the others make room while dragging: the project is changed and
 * rebuilt at once when that is quick (the view itself shows the result,
 * worktops and dimensions included). A large kitchen takes longer than a
 * frame or two: then the places are worked out here (arrange.simulate) and
 * drawn over the view, and the project changes once, on drop.
 */
const LIVE_MAX_MS = 60;
let buildMs = 0;
function rebuild(): void {
  const t0 = performance.now();
  void store.result;
  buildMs = performance.now() - t0;
}

const docs = (): Doc[] => (store.project.cabinets ?? []) as Doc[];
const key = (wall: string, anchor: unknown): string => `${wall}|${JSON.stringify(anchor)}`;

export class ArrangeDrag {
  started = false;
  readonly level: Level;
  readonly free: boolean;
  readonly W: number;
  readonly depth: number;
  /** The wall the cabinet is on (follows the pointer). */
  wall: string;
  /** From the cabinet's left side to the pointer, along the wall. */
  private grab: number;
  private snapshot = "";
  private others: ArrItem[] = [];
  /** Run: the place shown, the place written to the project, and where it was grabbed. */
  private applied = "";
  private written = "";
  private initial = "";
  /** Free: the position last written. */
  private x: number | undefined;
  private preview: DragShow["preview"] = [];

  private constructor(
    readonly id: string,
    q: CabinetPlacement,
    w: WallLayout,
    at: Vec2,
    /** Time the view needs on top of a build to show a change (ms), for the decision to rebuild live. */
    private extraMs: () => number,
    /** How far in front of its wall the cabinet is held (3D view; 0 in the plan). */
    private out: number,
  ) {
    this.wall = w.id;
    this.grab = onWall(w, at).u - q.x;
    this.W = q.W;
    this.depth = q.depth;
    this.level = levelOf(q.kind);
    this.free = docs().find((c) => c.id === id)?.place?.x !== undefined;
  }

  /** A drag of cabinet `id`, grabbed at plan point `at`; undefined when it stands on no wall. */
  static grab(id: string, at: Vec2, extraMs: () => number = () => 0, out = 0): ArrangeDrag | undefined {
    const layout = store.result?.room;
    const q = layout?.placements.find((p) => p.cabinet === id);
    const w = q && layout?.walls.find((x) => x.id === q.wall);
    return q && w ? new ArrangeDrag(id, q, w, at, extraMs, out) : undefined;
  }

  /** The drag proper starts (the pointer moved far enough, or a long press armed it). */
  begin(): void {
    const layout = store.result?.room;
    // What was edited before the drag stays its own undo step; the drag becomes one.
    store.record();
    store.historyHold = true;
    this.snapshot = JSON.stringify($state.snapshot(store.project));
    this.started = true;
    store.ui.selected = this.id;
    if (!this.free && layout) {
      this.others = itemsOf(docs(), layout.placements).filter((it) => it.id !== this.id);
      const q = layout.placements.find((p) => p.cabinet === this.id)!;
      this.initial = this.applied = this.written = key(this.wall, insertion(layout.walls, this.others, this.wall, this.level, q.x).anchor);
    }
  }

  /**
   * Follows the pointer (plan point `p`): the ghost always, the project when
   * the place changes. `tol`: snapping distance in mm. `final`: the drop.
   */
  update(p: Vec2, tol: number, final: boolean): DragShow | undefined {
    const layout = store.result?.room;
    if (!this.started || !layout) return undefined;
    const wallOf = (id: string): WallLayout | undefined => layout.walls.find((w) => w.id === id);
    const w = wallOf(nearestWall(layout.walls, p, this.wall, undefined, undefined, this.out)) ?? wallOf(this.wall);
    if (!w) return undefined;
    this.wall = w.id;
    const left = onWall(w, p).u - this.grab;
    const cost = buildMs + this.extraMs();
    if (this.free) {
      const others = layout.placements.filter((q) => q.wall === w.id && levelOf(q.kind) === this.level && q.cabinet !== this.id);
      const s = snapX(left, this.W, w.length, others, layout.openings.filter((o) => o.wall === w.id), tol);
      // A free position changes with every frame: live only when a build fits into one.
      if ((final || cost <= LIVE_MAX_MS / 3) && (this.x !== s.x || layout.placements.find((q) => q.cabinet === this.id)?.wall !== w.id)) {
        this.x = s.x;
        applyMove(docs(), this.id, w.id, null, s.x);
        rebuild();
      }
      return { ghost: { wall: w.id, x: s.x, W: this.W, depth: this.depth }, label: s.x, ...(s.edge !== undefined ? { guide: s.edge } : {}), preview: [] };
    }
    const ins = insertion(layout.walls, this.others, w.id, this.level, left);
    const k = key(w.id, ins.anchor);
    const live = final || cost <= LIVE_MAX_MS;
    if (live ? k !== this.written : k !== this.applied) {
      this.applied = k;
      if (live) {
        this.written = k;
        this.preview = [];
        applyMove(docs(), this.id, w.id, ins.anchor);
        rebuild();
      } else this.preview = k === this.written ? [] : this.previewOf(w.id, ins.anchor);
    }
    return { ghost: { wall: w.id, x: Math.min(Math.max(0, w.length - this.W), Math.max(0, left)), W: this.W, depth: this.depth }, preview: this.preview };
  }

  /** Where the cabinets of the dragged one's level would stand, for those that move. */
  private previewOf(wall: string, anchor: Anchor): DragShow["preview"] {
    const layout = store.result?.room;
    if (!layout) return [];
    const list = withInserted(this.others, { id: this.id, level: this.level, wall, W: this.W, depth: this.depth }, anchor);
    const pos = simulate(layout.walls, list);
    const out: DragShow["preview"] = [];
    for (const it of list) {
      const now = layout.placements.find((q) => q.cabinet === it.id);
      const x = pos.get(it.id);
      if (!now || x === undefined || (now.wall === it.wall && Math.abs(now.x - x) < 0.01)) continue;
      out.push({ id: it.id, from: { wall: now.wall, x: now.x, W: now.W, depth: now.depth }, to: { wall: it.wall, x, W: it.W, depth: it.depth } });
    }
    return out;
  }

  /** Ends the drag: one undo step, or exactly the state before it when cancelled or dropped where it was grabbed. */
  finish(cancel: boolean): void {
    if (!this.started) return;
    this.started = false;
    if ((cancel || (!this.free && this.written === this.initial)) && JSON.stringify($state.snapshot(store.project)) !== this.snapshot) {
      store.project = JSON.parse(this.snapshot);
    }
    store.historyHold = false;
    store.record();
  }
}
