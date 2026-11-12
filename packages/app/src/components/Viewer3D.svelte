<script lang="ts">
  import { untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { sceneOf, type CabinetPlacement, type CabinetResult, type HandlePlacement, type Scene, type ScenePart } from "@cabinet-planner/engine";
  import { rayToPlan, type Vec2 } from "../lib/arrange.ts";
  import { ArrangeDrag, type DragBox, type DragShow } from "../lib/arrange-drag.svelte.ts";
  import { fittingSolids, type P3, type Tone } from "../lib/fitting-solids.ts";
  import { store } from "../lib/store.svelte.ts";
  import { view3d, type SectionAxis } from "../lib/view3d.svelte.ts";
  import ViewModeSwitch from "./ViewModeSwitch.svelte";

  /** `single`: only the selected cabinet, standing alone without the room (D68). */
  let { single = false }: { single?: boolean } = $props();
  const t = $derived(store.tr.t);
  let canvas: HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let root: THREE.Group | undefined;
  let meshes: THREE.Mesh[] = [];
  let failed = $state(false);
  let framed = false;
  /** What the camera was last fitted to: the room, or the cabinets shown when there is none. */
  let framedFor = "";
  const frameKey = (): string =>
    single ? `one:${store.ui.selected}` : store.result?.room ? "room" : `run:${store.result?.cabinets.map((c) => c.resolved.cabinet.id).join(",")}`;

  const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  const FRONT_ROLES = ["door", "drawer_front", "blind_panel", "appliance_front", "flap", "ceiling_filler"];
  /** Fittings: light steel, zinc die-cast, dark plastic. */
  const TONES: Record<Tone, THREE.Color> = { steel: new THREE.Color("#a9b1ba"), zinc: new THREE.Color("#868e98"), dark: new THREE.Color("#3a3f46") };

  // --- Section plane (D74) ---------------------------------------------------
  // One plane for the cabinets, worktops and plinth panels; walls and floor stay whole.
  // With a cabinet selected the plane lies in that cabinet's frame (from the front:
  // parallel to its front, wherever its wall runs) and the slider spans that
  // cabinet; without one, the room's axes and all cabinets shown.
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  /** Extent the slider spans, in the frame `sectionFrame` maps to the scene. */
  let bounds = new THREE.Box3();
  let sectionFrame = new THREE.Matrix4();
  function applySection(): void {
    const a = view3d.axis;
    if (bounds.isEmpty()) return;
    const c = bounds.min[a] + (bounds.max[a] - bounds.min[a]) * Math.min(1, Math.max(0, view3d.pos));
    // Kept: the half below the cut (towards the wall, the floor, the left); flipped: the other one.
    clipPlane.normal.copy(AX[a]).multiplyScalar(view3d.flip ? 1 : -1);
    clipPlane.constant = view3d.flip ? -c : c;
    clipPlane.applyMatrix4(sectionFrame);
  }
  /** Cut parts must not look hollow from behind: both faces are drawn while the section is on. */
  function cut<M extends THREE.Material>(m: M): M {
    if (view3d.section) {
      m.clippingPlanes = [clipPlane];
      if (!(m instanceof THREE.LineBasicMaterial)) m.side = THREE.DoubleSide;
    }
    return m;
  }

  const wallBasis = (w: { d: readonly [number, number]; n: readonly [number, number]; start: readonly [number, number] }): THREE.Matrix4 => {
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(w.d[0], 0, -w.d[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(w.n[0], 0, -w.n[1]));
    return m.setPosition(w.start[0], 0, -w.start[1]);
  };

  /**
   * Cabinet placement as a matrix from cabinet coordinates to the scene.
   * With a room: on its wall (plan X → scene X, plan Y north → scene −Z).
   * Without: a simple run, floor units and wall units side by side.
   */
  function layout(cabs: CabinetResult[]): Map<string, THREE.Matrix4> {
    const room = store.result?.room;
    if (single) {
      const one = new Map<string, THREE.Matrix4>();
      for (const c of cabs) {
        const up = c.resolved.cabinet.kind === "wall" ? 0 : (c.resolved.values.get("plinth_h") ?? 0);
        one.set(c.resolved.cabinet.id, new THREE.Matrix4().makeTranslation(0, up, 0));
      }
      return one;
    }
    if (room) {
      const out = new Map<string, THREE.Matrix4>();
      for (const q of room.placements) {
        const d = new THREE.Vector3(q.d[0], 0, -q.d[1]);
        const n = new THREE.Vector3(q.n[0], 0, -q.n[1]);
        const m = new THREE.Matrix4().makeBasis(d, new THREE.Vector3(0, 1, 0), n);
        m.setPosition(q.origin[0], q.baseY, -q.origin[1]);
        out.set(q.cabinet, m);
      }
      return out;
    }
    const pos = new Map<string, THREE.Matrix4>();
    let xf = 0;
    let xw = 0;
    for (const c of cabs) {
      const v = (n: string): number => c.resolved.values.get(n) ?? 0;
      const kind = c.resolved.cabinet.kind;
      if (kind === "wall") {
        pos.set(c.resolved.cabinet.id, new THREE.Matrix4().makeTranslation(xw, v("wall_bottom"), 0));
        xw += v("W");
      } else {
        pos.set(c.resolved.cabinet.id, new THREE.Matrix4().makeTranslation(xf, v("plinth_h"), 0));
        xf += v("W");
      }
    }
    return pos;
  }

  /** Frees what a rebuilt scene leaves behind. */
  function dispose(o: THREE.Object3D): void {
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
      else mat?.dispose();
    });
  }

  /** Time the last rebuild of the scene took: a drag rebuilds live only when that is quick. */
  let sceneMs = 0;
  /** Part ids in the scene, with their names for the hide action. */
  let partNames = new Map<string, { code: string; role: string }>();
  /** Changes with every rebuild, for what is derived from the scene. */
  let builtAt = $state(0);

  /**
   * Scene descriptions per built cabinet: a result is immutable, so a rebuild
   * for a view setting (selection, explode, section) does not derive them again.
   */
  const scenes = new WeakMap<CabinetResult, Scene>();
  function sceneFor(c: CabinetResult): Scene {
    let sc = scenes.get(c);
    if (!sc) scenes.set(c, (sc = sceneOf(c, store.result?.library)));
    return sc;
  }

  function rebuild(): void {
    if (!renderer || !store.result) return;
    const t0 = performance.now();
    if (root) {
      scene.remove(root);
      dispose(root);
    }
    root = new THREE.Group();
    meshes = [];
    partNames = new Map();
    const partColor = new THREE.Color(css("--part"));
    const edgeColor = new THREE.Color(css("--part-edge"));
    const accent = new THREE.Color(css("--accent"));
    const drill = new THREE.Color(css("--drill"));
    const pocket = new THREE.Color(css("--pocket"));
    scene.background = new THREE.Color(css("--view"));
    const cabs = single ? store.result.cabinets.filter((c) => c.resolved.cabinet.id === store.ui.selected) : store.result.cabinets;
    const pos = layout(cabs);
    const hidden = new Set(view3d.hidden);

    // Floor.
    const grid = new THREE.GridHelper(8000, 80, edgeColor, edgeColor);
    (grid.material as THREE.Material).opacity = 0.18;
    (grid.material as THREE.Material).transparent = true;
    root.add(grid);
    if (!single) addRoom(root);

    // Fittings and bore marks: thousands of small solids, drawn as instances of a unit cylinder and a unit box.
    const inst = { cyl: [] as { m: THREE.Matrix4; c: THREE.Color }[], box: [] as { m: THREE.Matrix4; c: THREE.Color }[], hole: [] as { m: THREE.Matrix4; c: THREE.Color }[] };
    const v3 = (p: P3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);
    const cylMatrix = (a: THREE.Vector3, b: THREE.Vector3, d: number): THREE.Matrix4 => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(AX.y, dir.normalize()), new THREE.Vector3(d, len, d));
    };
    const boxMatrix = (a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 => {
      const lo = a.clone().min(b);
      const hi = a.clone().max(b);
      return new THREE.Matrix4().compose(lo.clone().add(hi).multiplyScalar(0.5), new THREE.Quaternion(), hi.sub(lo));
    };

    bounds = new THREE.Box3();
    sectionFrame = new THREE.Matrix4();
    /** All cabinets shown, in the scene's frame: the section's extent when none is selected. */
    const all = new THREE.Box3();
    for (const c of cabs) {
      const sc = sceneFor(c);
      const id = c.resolved.cabinet.id;
      const g = new THREE.Group();
      const m = pos.get(id);
      if (!m) continue;
      g.matrixAutoUpdate = false;
      g.matrix.copy(m);
      g.userData.cabinetGroup = id;
      const selected = store.ui.selected === id;
      const exploding = store.ui.explode && selected;
      const centre = new THREE.Vector3(sc.size.W / 2, sc.size.H / 2, sc.size.D / 2);
      /** Parts drawn, and how far each is moved by the exploded view. */
      const shown = new Map<string, THREE.Vector3>();
      const zero = new THREE.Vector3();
      for (const p of sc.parts) {
        partNames.set(p.id, { code: p.code, role: p.role });
        const isFront = FRONT_ROLES.includes(p.role);
        if (isFront && !store.ui.fronts) continue;
        if (hidden.has(p.id)) continue;
        const b = p.box;
        const pg = new THREE.Group();
        const isPart = store.ui.part === p.id || store.ui.highlight.includes(p.id);
        const base =
          p.color ? new THREE.Color(p.color) : p.role === "back" ? partColor.clone().offsetHSL(0, 0, -0.06) : isFront ? partColor.clone().lerp(accent, 0.12) : partColor;
        const color = isPart ? partColor.clone().lerp(accent, 0.45) : selected ? base.clone().lerp(accent, 0.1) : base;
        const geo = p.outline ? outlineGeometry(p.outline, b) : new THREE.BoxGeometry(b.dx, b.dy, b.dz);
        const mesh = new THREE.Mesh(geo, cut(new THREE.MeshLambertMaterial({ color, flatShading: true, side: p.outline ? THREE.DoubleSide : THREE.FrontSide })));
        mesh.userData = { cabinet: id, part: p.id };
        pg.add(mesh);
        pg.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), cut(new THREE.LineBasicMaterial({ color: isPart || selected ? accent : edgeColor }))));
        pg.position.set(b.x + b.dx / 2, b.y + b.dy / 2, b.z + b.dz / 2);
        const home = pg.position.clone();
        if (exploding) {
          const off = pg.position.clone().sub(centre);
          const drawerPart = p.role.startsWith("drawer_") && p.role !== "drawer_front";
          const k = p.role === "back" ? 0.9 : isFront ? 1.4 : drawerPart ? 0.2 : 0.45;
          const pull = p.role === "back" ? -120 : isFront ? 260 : drawerPart ? 160 : 0;
          pg.position.add(new THREE.Vector3(off.x * k, off.y * k * 0.6, off.z * k + pull));
        }
        const moved = exploding ? pg.position.clone().sub(home) : zero;
        shown.set(p.id, moved);
        const partBase = exploding ? m.clone().multiply(new THREE.Matrix4().makeTranslation(moved.x, moved.y, moved.z)) : m;
        if (store.ui.ops && selected) {
          for (const o of p.bores) {
            const len = Math.min(o.depth, 3) + 0.4;
            const dir = AX[o.dir.axis].clone().multiplyScalar(o.dir.sign);
            const at = new THREE.Vector3(o.at.x, o.at.y, o.at.z);
            inst.hole.push({ m: partBase.clone().multiply(cylMatrix(at.clone().addScaledVector(dir, -0.4), at.clone().addScaledVector(dir, len - 0.4), o.d)), c: drill });
            // A hole through the part shows on the far face too (D23); halves drilled from both faces each have their own mark.
            const through = b[`d${o.dir.axis}`];
            if ((o as { through?: boolean }).through || o.depth >= through - 0.01) {
              const far = at.clone().addScaledVector(dir, through);
              inst.hole.push({ m: partBase.clone().multiply(cylMatrix(far.clone().addScaledVector(dir, 0.4), far.clone().addScaledVector(dir, 0.4 - len), o.d)), c: drill });
            }
          }
          const pm = cut(new THREE.MeshBasicMaterial({ color: pocket }));
          for (const q of p.pockets) {
            const pk = new THREE.Mesh(new THREE.BoxGeometry(q.dx + 0.6, q.dy + 0.6, q.dz + 0.6), pm);
            pk.position.set(q.x + q.dx / 2, q.y + q.dy / 2, q.z + q.dz / 2).sub(home);
            pg.add(pk);
          }
        }
        // Handles and knobs on this front, attached so they follow explode.
        for (const h of sc.handles.filter((x) => x.part === p.id)) addHandle(pg, h, home);
        g.add(pg);
        meshes.push(mesh);
      }
      // Fittings (D74): where the engine drilled for them; each follows its part when exploded or hidden.
      if (store.ui.fittings) {
        for (const f of sc.fittings) {
          for (const s of fittingSolids(f)) {
            if (s.need.some((id) => !shown.has(id))) continue;
            // A rail has no part of its own: it stays out of the exploded view.
            const moved = s.follow ? shown.get(s.follow) : exploding ? undefined : zero;
            if (!moved) continue;
            const base = moved === zero ? m : m.clone().multiply(new THREE.Matrix4().makeTranslation(moved.x, moved.y, moved.z));
            const local = s.shape === "cyl" ? cylMatrix(v3(s.a), v3(s.b), s.d ?? 1) : boxMatrix(v3(s.a), v3(s.b));
            inst[s.shape].push({ m: base.clone().multiply(local), c: TONES[s.tone] });
          }
        }
      }
      root.add(g);
      g.updateMatrixWorld(true);
      all.expandByObject(g);
      if (selected) {
        // The selected cabinet's own extent, in cabinet coordinates (D2).
        for (const p of sc.parts) bounds.union(new THREE.Box3(new THREE.Vector3(p.box.x, p.box.y, p.box.z), new THREE.Vector3(p.box.x + p.box.dx, p.box.y + p.box.dy, p.box.z + p.box.dz)));
        sectionFrame = m.clone();
      }
    }
    if (bounds.isEmpty()) bounds = all;
    const instanced = (geo: THREE.BufferGeometry, list: { m: THREE.Matrix4; c: THREE.Color }[], mat: THREE.Material): void => {
      if (!list.length) {
        geo.dispose();
        mat.dispose();
        return;
      }
      const im = new THREE.InstancedMesh(geo, cut(mat), list.length);
      list.forEach((x, i) => {
        im.setMatrixAt(i, x.m);
        im.setColorAt(i, x.c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      root!.add(im);
    };
    instanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 14), inst.cyl, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    instanced(new THREE.BoxGeometry(1, 1, 1), inst.box, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    instanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 14), inst.hole, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    stats = { fittings: inst.cyl.length + inst.box.length, holes: inst.hole.length, builds: stats.builds + 1 };
    builtAt = t0;
    scene.add(root);
    applySection();
    // Without a room the extent follows the cabinets: fit again when they change.
    if (!framed || framedFor !== frameKey()) frame();
    sceneMs = performance.now() - t0;
  }
  let stats = { fittings: 0, holes: 0, builds: 0 };

  /** Walls as see-through boxes around their openings, plus the floor. */
  function addRoom(parent: THREE.Group): void {
    const room = store.result?.room;
    if (!room) return;
    const wallMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--shade-side")), transparent: true, opacity: 0.35, depthWrite: false });
    const edge = new THREE.LineBasicMaterial({ color: new THREE.Color(css("--part-edge")), transparent: true, opacity: 0.6 });
    // Walls drawn: all, only those a cabinet stands on, or none; openings and slopes follow their wall.
    const used = new Set(room.placements.map((q) => q.wall));
    const wallShown = (id: string): boolean => store.ui.walls === "all" || (store.ui.walls !== "none" && used.has(id));
    for (const w of room.walls) {
      if (!wallShown(w.id)) continue;
      const ops = room.openings.filter((o) => o.wall === w.id).sort((a, b) => a.x - b.x);
      // Rectangles (along, up) of solid wall around the openings.
      const pieces: [number, number, number, number][] = [];
      let x = 0;
      for (const o of ops) {
        if (o.x > x) pieces.push([x, 0, o.x, w.height]);
        if (o.sill > 0) pieces.push([o.x, 0, o.x + o.width, o.sill]);
        if (o.sill + o.height < w.height) pieces.push([o.x, o.sill + o.height, o.x + o.width, w.height]);
        x = Math.max(x, o.x + o.width);
      }
      if (x < w.length) pieces.push([x, 0, w.length, w.height]);
      const basis = wallBasis(w);
      for (const [a0, y0, a1, y1] of pieces) {
        const geo = new THREE.BoxGeometry(a1 - a0, y1 - y0, w.thickness);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set((a0 + a1) / 2, (y0 + y1) / 2, -w.thickness / 2);
        mesh.applyMatrix4(basis);
        parent.add(mesh);
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge);
        lines.position.copy(mesh.position);
        lines.quaternion.copy(mesh.quaternion);
        parent.add(lines);
      }
    }
    // Worktops: slabs on top of the base runs.
    const cutEdge = cut(edge.clone());
    const topMat = cut(new THREE.MeshLambertMaterial({ color: new THREE.Color("#c8b48f"), flatShading: true }));
    for (const wt of store.ui.worktops ? room.worktops : []) {
      const w = room.walls.find((x) => x.id === wt.wall);
      if (!w) continue;
      const basis = wallBasis(w);
      const geo = new THREE.BoxGeometry(wt.x1 - wt.x0, wt.t, wt.depth);
      const mesh = new THREE.Mesh(geo, topMat);
      mesh.position.set((wt.x0 + wt.x1) / 2, wt.y + wt.t / 2, wt.depth / 2);
      mesh.applyMatrix4(basis);
      parent.add(mesh);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), cutEdge);
      lines.position.copy(mesh.position);
      lines.quaternion.copy(mesh.quaternion);
      parent.add(lines);
      // Cutouts: dark insets on the top face.
      const cutMat = cut(new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--drill")) }));
      for (const c of wt.cutouts) {
        const cm = new THREE.Mesh(new THREE.BoxGeometry(c.u1 - c.u0, 2, c.v1 - c.v0), cutMat);
        cm.position.set(wt.x0 + (c.u0 + c.u1) / 2, wt.y + wt.t - 0.5, (c.v0 + c.v1) / 2);
        cm.applyMatrix4(basis);
        parent.add(cm);
      }
    }
    // Roof slopes (D44): from the knee line on their wall up to the flat ceiling.
    const roofMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--shade-top")), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    for (const s of room.ceiling.slopes) {
      const w = room.walls.find((x) => x.id === s.wall);
      if (!w || !wallShown(w.id)) continue;
      const dist = (room.ceiling.height - s.knee) / s.rise;
      const p3 = (x: number, y: number, h: number) => new THREE.Vector3(x, h, -y);
      const a = p3(w.start[0], w.start[1], s.knee);
      const b = p3(w.end[0], w.end[1], s.knee);
      const c = p3(w.end[0] + w.n[0] * dist, w.end[1] + w.n[1] * dist, room.ceiling.height);
      const d = p3(w.start[0] + w.n[0] * dist, w.start[1] + w.n[1] * dist, room.ceiling.height);
      const geo = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
      geo.computeVertexNormals();
      parent.add(new THREE.Mesh(geo, roofMat));
      parent.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge));
    }
    // Plinth panels.
    const plMat = cut(new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--shade-side")), flatShading: true }));
    for (const p of store.ui.plinths ? room.plinths : []) {
      const w = room.walls.find((x) => x.id === p.wall);
      if (!w) continue;
      const geo = new THREE.BoxGeometry(p.x1 - p.x0, p.h, p.t);
      const mesh = new THREE.Mesh(geo, plMat);
      mesh.position.set((p.x0 + p.x1) / 2, p.y + p.h / 2, p.front - p.t / 2);
      mesh.applyMatrix4(wallBasis(w));
      parent.add(mesh);
    }
    if (room.closed) {
      const shape = new THREE.Shape(room.walls.map((w) => new THREE.Vector2(w.start[0], w.start[1])));
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--surface-2")), side: THREE.DoubleSide }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.5;
      parent.add(floor);
    }
  }

  /**
   * Non-rectangular part: its contour extruded through the thickness, in
   * coordinates relative to the part's bounding-box centre (D43).
   */
  function outlineGeometry(o: NonNullable<ScenePart["outline"]>, b: { x: number; y: number; z: number; dx: number; dy: number; dz: number }): THREE.BufferGeometry {
    const axes = (["x", "y", "z"] as const).filter((a) => a !== o.normal);
    const [A, B] = axes as ["x" | "y" | "z", "x" | "y" | "z"];
    const shape = new THREE.Shape(o.points.map((q) => new THREE.Vector2(q[A], q[B])));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: o.thickness, bevelEnabled: false });
    const unit = (a: "x" | "y" | "z") => new THREE.Vector3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0);
    const m = new THREE.Matrix4().makeBasis(unit(A), unit(B), unit(o.normal));
    const centre = new THREE.Vector3(b.x + b.dx / 2, b.y + b.dy / 2, b.z + b.dz / 2);
    const start = unit(o.normal).multiplyScalar(b[o.normal]);
    m.setPosition(start.sub(centre));
    geo.applyMatrix4(m);
    return geo;
  }

  const metal = (): THREE.Material =>
    cut(new THREE.MeshStandardMaterial({ color: new THREE.Color(css("--part-edge")), metalness: 0.55, roughness: 0.35 }));

  /** Bar on two posts, or a knob on one post, standing off the front's outer face. `home`: the part's centre in the cabinet. */
  function addHandle(pg: THREE.Group, h: HandlePlacement, home: THREE.Vector3): void {
    const m = metal();
    const pts = h.points.map((q) => new THREE.Vector3(q.x, q.y, q.z).sub(home));
    const off = h.standoff ?? 30;
    const postD = Math.max((h.barD ?? 12) * 0.75, 7);
    for (const q of pts) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(postD / 2, postD / 2, off, 16), m);
      post.quaternion.setFromUnitVectors(AX.y, AX.z);
      post.position.copy(q).add(new THREE.Vector3(0, 0, off / 2));
      pg.add(post);
    }
    if (pts.length >= 2) {
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const dir = b.clone().sub(a);
      const cc = dir.length();
      const len = Math.max(h.length ?? cc + 40, cc);
      const d = h.barD ?? 12;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, len, 20), m);
      bar.quaternion.setFromUnitVectors(AX.y, dir.normalize());
      bar.position.copy(a.clone().add(b).multiplyScalar(0.5)).add(new THREE.Vector3(0, 0, off));
      pg.add(bar);
    } else if (pts.length === 1) {
      const r = (h.size ?? 30) / 2;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m);
      knob.scale.set(1, 1, 0.7);
      knob.position.copy(pts[0]!).add(new THREE.Vector3(0, 0, off + r * 0.5));
      pg.add(knob);
    }
  }

  function frame(only?: string): void {
    if (!root) return;
    // Frame the cabinets, not the floor grid (first child); or just one cabinet.
    // Cabinet groups carry their placement as a fixed matrix: bring the world matrices up to date first.
    const b = new THREE.Box3();
    root.updateMatrixWorld(true);
    const objs = only ? root.children.filter((o) => o.userData.cabinetGroup === only) : root.children.slice(1);
    objs.forEach((o) => b.expandByObject(o));
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    // Upright screens (phone): step back so the width still fits.
    const r = b.getSize(new THREE.Vector3()).length() * Math.min(2, Math.max(1, 0.9 / (camera.aspect || 1)));
    camera.position.set(c.x + r * 0.7, c.y + r * 0.55, c.z + r * 1.55);
    controls.target.copy(c);
    controls.update();
    framed = true;
    framedFor = frameKey();
  }

  function resize(): void {
    if (!renderer) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  // --- Picking ---------------------------------------------------------------

  function rayAt(cx: number, cy: number): THREE.Raycaster {
    const r = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    return ray;
  }
  /** The part under the pointer: the nearest one that is not cut away by the section. */
  function pick(cx: number, cy: number): THREE.Intersection | undefined {
    return rayAt(cx, cy)
      .intersectObjects(meshes)
      .find((h) => !view3d.section || clipPlane.distanceToPoint(h.point) >= -0.01);
  }

  /**
   * A click on a part selects it and its cabinet; a click beside the cabinets
   * clears the selection (D74). The cabinet view keeps its cabinet: it shows
   * nothing else.
   */
  function click(e: PointerEvent): void {
    const hit = pick(e.clientX, e.clientY);
    if (hit) {
      store.ui.selected = hit.object.userData.cabinet;
      store.ui.part = hit.object.userData.part;
      store.ui.pane = "cabinet";
      return;
    }
    store.ui.part = null;
    if (!single) store.ui.selected = null;
  }

  // --- Hiding parts (D74) ------------------------------------------------------

  const selectedPart = $derived.by(() => {
    void builtAt;
    const id = store.ui.part;
    const p = id ? partNames.get(id) : undefined;
    return id && p && !view3d.hidden.includes(id) ? { id, name: `${t(`role.${p.role}`)} ${p.code}` } : undefined;
  });
  const hiddenCount = $derived.by(() => {
    void builtAt;
    return view3d.hidden.filter((id) => partNames.has(id)).length;
  });
  function hideSelected(): void {
    const id = selectedPart?.id;
    if (!id) return;
    view3d.hidden = [...view3d.hidden, id];
    store.ui.part = null;
  }

  // --- Moving cabinets (D69, D74) -----------------------------------------------
  // Ctrl+drag with the mouse, or press and hold, then drag, with a finger. The
  // pointer is projected onto the horizontal plane through the point that was
  // grabbed; the rest is the floor plan's drag (lib/arrange-drag).

  const HOLD_MS = 400;
  interface Move {
    pointerId: number;
    touch: boolean;
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    /** Height of the plane the pointer moves on. */
    height: number;
    mmPerPx: number;
    last: Vec2;
    place: CabinetPlacement;
    drag: ArrangeDrag;
    timer?: ReturnType<typeof setTimeout>;
  }
  let mv: Move | null = null;
  let moving = $state<{ id: string; touch: boolean; x?: string } | null>(null);
  /** Where a finger is held down on a cabinet, until the drag arms or the finger moves on. */
  let holding = $state<{ x: number; y: number } | null>(null);
  let dragGroup: THREE.Group | undefined;
  let raf = 0;

  function planAt(cx: number, cy: number, height: number): Vec2 | null {
    const { origin, direction } = rayAt(cx, cy).ray;
    return rayToPlan([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z], height);
  }

  function grab(e: PointerEvent): Move | undefined {
    const room = store.result?.room;
    const hit = pick(e.clientX, e.clientY);
    const id = hit?.object.userData.cabinet as string | undefined;
    const place = room?.placements.find((q) => q.cabinet === id);
    const hitAt = hit && planAt(e.clientX, e.clientY, hit.point.y);
    if (!hit || !id || !place || !hitAt) return undefined;
    const out = (hitAt[0] - place.origin[0]) * place.n[0] + (hitAt[1] - place.origin[1]) * place.n[1];
    const at = hitAt;
    // The cabinet is grabbed at its front or top, `out` in front of its wall: the drag knows, so a
    // cabinet in a corner does not jump to the other wall because its front is nearer to that one.
    const drag = ArrangeDrag.grab(id, at, () => sceneMs, Math.max(0, out));
    if (!drag) return undefined;
    const mmPerPx = (2 * hit.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(canvas.clientHeight, 1);
    return { pointerId: e.pointerId, touch: e.pointerType !== "mouse", sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, height: hit.point.y, mmPerPx, last: at, place, drag };
  }

  /** The drag proper starts: the camera stands still, the cabinet follows the pointer. */
  function arm(m: Move): void {
    controls.enabled = false;
    holding = null;
    m.drag.begin();
    moving = { id: m.drag.id, touch: m.touch };
    canvas.style.cursor = "grabbing";
    if (m.touch) navigator.vibrate?.(15);
    update(false);
  }

  function update(final: boolean): void {
    const m = mv;
    if (!m || !m.drag.started) return;
    m.last = planAt(m.cx, m.cy, m.height) ?? m.last;
    const show = m.drag.update(m.last, (m.touch ? 16 : 10) * m.mmPerPx, final);
    if (!show) return;
    moving = { id: m.drag.id, touch: m.touch, ...(show.label !== undefined ? { x: store.tr.number(Math.round(show.label * 10) / 10, 1) } : {}) };
    drawDrag(m, show);
  }

  /** The dragged cabinet as a box under the pointer, the snap edge, and the places the others would take. */
  function drawDrag(m: Move, show: DragShow): void {
    clearDrag();
    const room = store.result?.room;
    if (!room) return;
    dragGroup = new THREE.Group();
    const accent = new THREE.Color(css("--accent"));
    const boxAt = (b: DragBox, fill: boolean, q: { baseY: number; H: number }): void => {
      const w = room.walls.find((x) => x.id === b.wall);
      if (!w) return;
      const geo = new THREE.BoxGeometry(b.W, q.H, b.depth);
      const basis = wallBasis(w);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: accent, depthTest: false }));
      lines.position.set(b.x + b.W / 2, q.baseY + q.H / 2, b.depth / 2);
      lines.applyMatrix4(basis);
      lines.renderOrder = 3;
      dragGroup!.add(lines);
      if (fill) {
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false }));
        mesh.position.copy(lines.position);
        mesh.quaternion.copy(lines.quaternion);
        mesh.renderOrder = 2;
        dragGroup!.add(mesh);
      } else geo.dispose();
    };
    boxAt(show.ghost, true, m.place);
    for (const p of show.preview) {
      const q = room.placements.find((x) => x.cabinet === p.id);
      if (q && p.id !== m.drag.id) boxAt(p.to, false, q);
    }
    const w = room.walls.find((x) => x.id === show.ghost.wall);
    if (w && show.guide !== undefined) {
      // The edge it snapped to: an upright line pair on the wall and across the depth.
      const reach = Math.max(show.ghost.depth, 600) + 150;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(show.guide, 0, 0), new THREE.Vector3(show.guide, w.height, 0),
        new THREE.Vector3(show.guide, m.place.baseY, 0), new THREE.Vector3(show.guide, m.place.baseY, reach),
        new THREE.Vector3(show.guide, m.place.baseY + m.place.H, 0), new THREE.Vector3(show.guide, m.place.baseY + m.place.H, reach),
      ]);
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(css("--err")), depthTest: false }));
      line.applyMatrix4(wallBasis(w));
      line.renderOrder = 4;
      dragGroup.add(line);
    }
    scene.add(dragGroup);
  }
  function clearDrag(): void {
    if (!dragGroup) return;
    scene.remove(dragGroup);
    dispose(dragGroup);
    dragGroup = undefined;
  }

  function endMove(cancel: boolean): void {
    const m = mv;
    if (!m) return;
    mv = null;
    clearTimeout(m.timer);
    cancelAnimationFrame(raf);
    raf = 0;
    holding = null;
    moving = null;
    clearDrag();
    canvas.style.cursor = "";
    if (canvas.hasPointerCapture(m.pointerId) && !m.touch) canvas.releasePointerCapture(m.pointerId);
    controls.enabled = true;
    m.drag.finish(cancel);
  }

  let down: { x: number; y: number } | null = null;
  function onDown(e: PointerEvent): void {
    down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
    if (!e.isPrimary) {
      // A second finger zooms: no long press, and a drag under way is given up.
      if (mv && !mv.drag.started) endMove(true);
      return;
    }
    if (mv || single || !store.result?.room) return;
    if (e.pointerType === "mouse") {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
      const m = grab(e);
      if (!m) return;
      // Before the orbit controls see the pointer: Ctrl+drag would pan the camera.
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      mv = m;
    } else {
      const m = grab(e);
      if (!m) return;
      mv = m;
      holding = { x: e.clientX, y: e.clientY };
      m.timer = setTimeout(() => {
        if (mv === m && !m.drag.started) arm(m);
      }, HOLD_MS);
    }
  }
  function onMove(e: PointerEvent): void {
    const m = mv;
    if (!m || e.pointerId !== m.pointerId) return;
    m.cx = e.clientX;
    m.cy = e.clientY;
    if (!m.drag.started) {
      const far = Math.hypot(e.clientX - m.sx, e.clientY - m.sy);
      if (m.touch) {
        // The finger moved on before the hold was over: it orbits, as always.
        if (far > 10) endMove(true);
        return;
      }
      if (far < 5) return;
      arm(m);
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(false); });
  }
  function onUp(e: PointerEvent): void {
    const m = mv;
    if (m && e.pointerId === m.pointerId) {
      m.cx = e.clientX;
      m.cy = e.clientY;
      const moved = m.drag.started;
      if (moved) update(true);
      endMove(false);
      if (moved) {
        down = null;
        return;
      }
    }
    if (!down || !e.isPrimary || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    down = null;
    click(e);
  }
  function onCancel(e: PointerEvent): void {
    if (mv && e.pointerId === mv.pointerId) endMove(true);
    down = null;
  }

  function windowKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && mv) {
      e.preventDefault();
      endMove(true);
      return;
    }
    const el = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable))) return;
    if (e.key.toLowerCase() === "h" && selectedPart) {
      e.preventDefault();
      hideSelected();
    }
  }

  $effect(() => {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      failed = true;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 10, 50000);
    // Before the orbit controls, so a cabinet drag can keep the pointer from them.
    const noMenu = (e: Event): void => e.preventDefault();
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("contextmenu", noMenu);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, 1, 0.8);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(1, 0.3, -0.5);
    scene.add(fill);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer!.render(scene, camera);
    });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onTheme = (): void => rebuild();
    mq.addEventListener("change", onTheme);
    if (import.meta.env.DEV) {
      // For browser tests: where a cabinet is on screen, and what a frame costs.
      (window as unknown as Record<string, unknown>).__view3d = {
        // Screen point of the middle of a cabinet's front at `up` of its height, moved `along` its wall.
        screen: (id: string, up = 0.5, along = 0): { x: number; y: number } | null => {
          const q = store.result?.room?.placements.find((p) => p.cabinet === id);
          if (!q) return null;
          const r = canvas.getBoundingClientRect();
          const mid = (k: 0 | 1): number => q.origin[k] + q.d[k] * (q.W / 2 + along) + q.n[k] * q.depth;
          const p = new THREE.Vector3(mid(0), q.baseY + q.H * up, -mid(1)).project(camera);
          return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
        },
        look: (from: [number, number, number], to: [number, number, number]): void => {
          camera.position.set(...from);
          controls.target.set(...to);
          controls.update();
        },
        info: () => ({ cam: camera.position.toArray().map(Math.round), calls: renderer!.info.render.calls, triangles: renderer!.info.render.triangles, sceneMs, ...stats }),
      };
    }
    return () => {
      endMove(true);
      mq.removeEventListener("change", onTheme);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("contextmenu", noMenu);
      controls.dispose();
      ro.disconnect();
      renderer?.setAnimationLoop(null);
      if (root) dispose(root);
      renderer?.dispose();
      renderer = undefined;
    };
  });

  // Rebuild whenever the model or view settings change.
  $effect(() => {
    store.result;
    store.ui.selected;
    store.ui.part;
    store.ui.highlight;
    store.ui.explode;
    store.ui.ops;
    store.ui.fronts;
    store.ui.walls;
    store.ui.fittings;
    store.ui.worktops;
    store.ui.plinths;
    view3d.hidden;
    view3d.section;
    // Only what is listed above: the rebuild also reads the cut's place (applySection),
    // and moving the slider must not build the scene again.
    untrack(rebuild);
  });
  // The cut moves without rebuilding anything.
  $effect(() => {
    view3d.axis;
    view3d.pos;
    view3d.flip;
    applySection();
  });
  const inRoom = $derived(!single && !!store.result?.room);
</script>

<svelte:window onkeydown={windowKey} />

<section class="panel view">
  <div class="bar">
    <ViewModeSwitch />
    {#if inRoom}
      <select id="walls-shown" aria-label={t("ui.walls_show")} title={t("ui.walls_show")} bind:value={store.ui.walls}>
        {#each ["all", "used", "none"] as w}<option value={w}>{t(`ui.walls_show.${w}`)}</option>{/each}
      </select>
    {/if}
    <button aria-pressed={store.ui.explode} onclick={() => (store.ui.explode = !store.ui.explode)}>{t("ui.explode")}</button>
    <button aria-pressed={store.ui.ops} onclick={() => (store.ui.ops = !store.ui.ops)}>{t("ui.machining")}</button>
    <button aria-pressed={store.ui.fronts} onclick={() => (store.ui.fronts = !store.ui.fronts)}>{t("ui.fronts")}</button>
    <button id="v3d-fittings" title={t("ui.fittings_hint")} aria-pressed={store.ui.fittings} onclick={() => (store.ui.fittings = !store.ui.fittings)}>{t("ui.fittings")}</button>
    {#if inRoom}
      <button id="v3d-worktops" aria-pressed={store.ui.worktops} onclick={() => (store.ui.worktops = !store.ui.worktops)}>{t("ui.worktops")}</button>
      <button id="v3d-plinths" aria-pressed={store.ui.plinths} onclick={() => (store.ui.plinths = !store.ui.plinths)}>{t("ui.plinths")}</button>
    {/if}
    <button id="v3d-section" title={t("ui.section_hint")} aria-pressed={view3d.section} onclick={() => (view3d.section = !view3d.section)}>{t("ui.section")}</button>
    <span class="sp"></span>
    {#if store.cabinet}
      {@const v = (n: string) => store.cabinet!.resolved.values.get(n)}
      <span class="mono muted dims">{store.cabinet.resolved.cabinet.id} · W {v("W")} · H {v("H")} · D {v("D")}</span>
    {/if}
    {#if store.ui.selected}<button onclick={() => frame(store.ui.selected)}>{t("ui.fit_cabinet")}</button>{/if}
    <button onclick={() => frame()}>{t("ui.fit")}</button>
  </div>
  {#if failed}
    <p class="muted fail">{t("ui.no_webgl")}</p>
  {/if}
  <div class="stage">
    <canvas bind:this={canvas}></canvas>
    <div class="tools">
      {#if view3d.section}
        <div class="tool cutter" role="group" aria-label={t("ui.section")}>
          <select id="v3d-section-axis" aria-label={t("ui.section_axis")} title={t("ui.section_axis")} value={view3d.axis} onchange={(e) => (view3d.axis = (e.target as HTMLSelectElement).value as SectionAxis)}>
            {#each ["z", "x", "y"] as a}<option value={a}>{t(`ui.section_axis.${a}`)}</option>{/each}
          </select>
          <input id="v3d-section-pos" type="range" min="0" max="1" step="0.005" aria-label={t("ui.section_pos")} title={t("ui.section_pos")} value={view3d.pos} oninput={(e) => (view3d.pos = Number((e.target as HTMLInputElement).value))} />
          <button id="v3d-section-flip" aria-pressed={view3d.flip} aria-label={t("ui.section_flip")} title={t("ui.section_flip")} onclick={() => (view3d.flip = !view3d.flip)}>⇄</button>
        </div>
      {/if}
      {#if selectedPart}
        <button id="v3d-hide" class="tool" title={t("ui.part_hide_hint")} onclick={hideSelected}>{t("ui.part_hide", { part: selectedPart.name })}</button>
      {/if}
      {#if hiddenCount}
        <button id="v3d-hidden" class="tool chip" onclick={() => (view3d.hidden = [])}>{t("ui.parts_hidden", { n: hiddenCount })} · <u>{t("ui.parts_show_all")}</u></button>
      {/if}
    </div>
    {#if moving}
      <div class="moving" role="status">{t(moving.touch ? "ui.move3d_moving_touch" : "ui.move3d_moving", { id: moving.id })}{#if moving.x}<b class="mono">{t("ui.move3d_pos", { x: moving.x })}</b>{/if}</div>
    {/if}
    {#if holding}<span class="hold" style:left={`${holding.x}px`} style:top={`${holding.y}px`}></span>{/if}
    <span class="hint">{t(single ? "ui.view_hint_single" : inRoom ? "ui.view_hint_room" : "ui.view_hint")}</span>
  </div>
</section>

<style>
  .view { position: relative; display: flex; flex-direction: column; overflow: hidden; height: 100%; min-height: 460px; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); align-items: center; }
  .sp { flex: 1; }
  .dims { font-size: 12px; }
  .stage { position: relative; flex: 1; min-height: 400px; display: flex; }
  canvas { display: block; width: 100%; flex: 1; min-height: 400px; background: var(--view); touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .hint { position: absolute; left: 10px; right: 10px; bottom: 8px; font-size: 11px; color: var(--muted); pointer-events: none; }
  .fail { padding: 16px; }
  /* Actions on what is shown lie over the drawing, where the eye is. */
  .tools { position: absolute; left: 8px; top: 8px; right: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; pointer-events: none; }
  .tool { pointer-events: auto; background: var(--surface); box-shadow: 0 1px 4px rgb(0 0 0 / 0.14); }
  .tool.chip { border-radius: 999px; padding-inline: 12px; }
  .cutter { display: flex; gap: 6px; align-items: center; padding: 4px 6px; border: 1px solid var(--line); border-radius: 8px; max-width: 100%; }
  .cutter input[type="range"] { width: min(240px, 40vw); min-height: 32px; accent-color: var(--accent); }
  .moving { position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 6px 12px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 13px; pointer-events: none; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25); text-align: center; }
  .moving b { margin-left: 10px; }
  /* A ring closes around the finger while it is held: when it is full, the cabinet is picked up. */
  .hold { position: fixed; width: 76px; height: 76px; margin: -38px 0 0 -38px; border-radius: 50%; border: 3px solid var(--accent); pointer-events: none; animation: hold 0.4s linear forwards; }
  @keyframes hold {
    from { transform: scale(1.5); opacity: 0.15; }
    to { transform: scale(0.75); opacity: 1; }
  }
</style>
