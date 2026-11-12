<script lang="ts">
  import { longPress } from "../lib/longpress.ts";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { sceneOf, type CabinetResult, type HandlePlacement, type ScenePart } from "@cabinet-planner/engine";
  import { store } from "../lib/store.svelte.ts";
  import ViewModeSwitch from "./ViewModeSwitch.svelte";

  /** `single`: only the selected cabinet, standing alone without the room (D54). */
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

  function rebuild(): void {
    if (!renderer || !store.result) return;
    if (root) scene.remove(root);
    root = new THREE.Group();
    meshes = [];
    const partColor = new THREE.Color(css("--part"));
    const edgeColor = new THREE.Color(css("--part-edge"));
    const accent = new THREE.Color(css("--accent"));
    const drill = new THREE.Color(css("--drill"));
    const pocket = new THREE.Color(css("--pocket"));
    scene.background = new THREE.Color(css("--view"));
    const cabs = single ? store.result.cabinets.filter((c) => c.resolved.cabinet.id === store.ui.selected) : store.result.cabinets;
    const pos = layout(cabs);

    // Floor.
    const grid = new THREE.GridHelper(8000, 80, edgeColor, edgeColor);
    (grid.material as THREE.Material).opacity = 0.18;
    (grid.material as THREE.Material).transparent = true;
    root.add(grid);
    if (!single) addRoom(root);

    for (const c of cabs) {
      const sc = sceneOf(c, store.result.library);
      const id = c.resolved.cabinet.id;
      const g = new THREE.Group();
      const m = pos.get(id);
      if (!m) continue;
      g.matrixAutoUpdate = false;
      g.matrix.copy(m);
      const selected = store.ui.selected === id;
      const centre = new THREE.Vector3(sc.size.W / 2, sc.size.H / 2, sc.size.D / 2);
      for (const p of sc.parts) {
        const isFront = ["door", "drawer_front", "blind_panel", "appliance_front", "flap", "ceiling_filler"].includes(p.role);
        if (isFront && !store.ui.fronts) continue;
        const b = p.box;
        const pg = new THREE.Group();
        const isPart = store.ui.part === p.id || store.ui.highlight.includes(p.id);
        const base =
          p.color ? new THREE.Color(p.color) : p.role === "back" ? partColor.clone().offsetHSL(0, 0, -0.06) : isFront ? partColor.clone().lerp(accent, 0.12) : partColor;
        const color = isPart ? partColor.clone().lerp(accent, 0.45) : selected ? base.clone().lerp(accent, 0.1) : base;
        const geo = p.outline ? outlineGeometry(p.outline, b) : new THREE.BoxGeometry(b.dx, b.dy, b.dz);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true, side: p.outline ? THREE.DoubleSide : THREE.FrontSide }));
        mesh.userData = { cabinet: id, part: p.id };
        pg.add(mesh);
        pg.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: isPart || selected ? accent : edgeColor })));
        pg.position.set(b.x + b.dx / 2, b.y + b.dy / 2, b.z + b.dz / 2);
        if (store.ui.ops && selected) {
          const bm = new THREE.MeshBasicMaterial({ color: drill });
          for (const o of p.bores) {
            const len = Math.min(o.depth, 3) + 0.4;
            const cyl = new THREE.Mesh(new THREE.CylinderGeometry(o.d / 2, o.d / 2, len, 16), bm);
            const dir = AX[o.dir.axis].clone().multiplyScalar(o.dir.sign);
            cyl.quaternion.setFromUnitVectors(AX.y, dir);
            cyl.position.copy(new THREE.Vector3(o.at.x, o.at.y, o.at.z).addScaledVector(dir, len / 2 - 0.4)).sub(pg.position);
            pg.add(cyl);
          }
          const pm = new THREE.MeshBasicMaterial({ color: pocket });
          for (const q of p.pockets) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(q.dx + 0.6, q.dy + 0.6, q.dz + 0.6), pm);
            m.position.set(q.x + q.dx / 2, q.y + q.dy / 2, q.z + q.dz / 2).sub(pg.position);
            pg.add(m);
          }
        }
        // Handles and knobs on this front, attached so they follow explode.
        for (const h of sc.handles.filter((x) => x.part === p.id)) addHandle(pg, h);
        if (store.ui.explode && selected) {
          const off = pg.position.clone().sub(centre);
          const drawerPart = p.role.startsWith("drawer_") && p.role !== "drawer_front";
          const k = p.role === "back" ? 0.9 : isFront ? 1.4 : drawerPart ? 0.2 : 0.45;
          const pull = p.role === "back" ? -120 : isFront ? 260 : drawerPart ? 160 : 0;
          pg.position.add(new THREE.Vector3(off.x * k, off.y * k * 0.6, off.z * k + pull));
        }
        g.add(pg);
        meshes.push(mesh);
      }
      // Wardrobe rails and adjustable legs (hidden while exploding the selected cabinet).
      if (!(store.ui.explode && selected)) {
        const m = metal();
        const legMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--drill")) });
        for (const f of c.fittings) {
          if (f.kind === "rail" && f.length) {
            const rail = new THREE.Mesh(new THREE.CylinderGeometry(f.d / 2, f.d / 2, f.length, 20), m);
            rail.quaternion.setFromUnitVectors(AX.y, AX.x);
            rail.position.set(f.x + f.length / 2, f.y, f.z);
            g.add(rail);
          } else if (f.kind === "leg" && f.h) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(f.d * 0.3, f.d / 2, f.h, 16), legMat);
            leg.position.set(f.x, f.y - f.h / 2, f.z);
            g.add(leg);
          }
        }
      }
      root.add(g);
    }
    scene.add(root);
    // Without a room the extent follows the cabinets: fit again when they change.
    if (!framed || framedFor !== frameKey()) frame();
  }

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
      const d = new THREE.Vector3(w.d[0], 0, -w.d[1]);
      const n = new THREE.Vector3(w.n[0], 0, -w.n[1]);
      const basis = new THREE.Matrix4().makeBasis(d, new THREE.Vector3(0, 1, 0), n);
      basis.setPosition(w.start[0], 0, -w.start[1]);
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
    const topMat = new THREE.MeshLambertMaterial({ color: new THREE.Color("#c8b48f"), flatShading: true });
    for (const wt of room.worktops) {
      const w = room.walls.find((x) => x.id === wt.wall);
      if (!w) continue;
      const d = new THREE.Vector3(w.d[0], 0, -w.d[1]);
      const n = new THREE.Vector3(w.n[0], 0, -w.n[1]);
      const basis = new THREE.Matrix4().makeBasis(d, new THREE.Vector3(0, 1, 0), n);
      basis.setPosition(w.start[0], 0, -w.start[1]);
      const geo = new THREE.BoxGeometry(wt.x1 - wt.x0, wt.t, wt.depth);
      const mesh = new THREE.Mesh(geo, topMat);
      mesh.position.set((wt.x0 + wt.x1) / 2, wt.y + wt.t / 2, wt.depth / 2);
      mesh.applyMatrix4(basis);
      parent.add(mesh);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge);
      lines.position.copy(mesh.position);
      lines.quaternion.copy(mesh.quaternion);
      parent.add(lines);
      // Cutouts: dark insets on the top face.
      const cutMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--drill")) });
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
    const plMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(css("--shade-side")), flatShading: true });
    for (const p of room.plinths) {
      const w = room.walls.find((x) => x.id === p.wall);
      if (!w) continue;
      const d = new THREE.Vector3(w.d[0], 0, -w.d[1]);
      const n = new THREE.Vector3(w.n[0], 0, -w.n[1]);
      const basis = new THREE.Matrix4().makeBasis(d, new THREE.Vector3(0, 1, 0), n);
      basis.setPosition(w.start[0], 0, -w.start[1]);
      const geo = new THREE.BoxGeometry(p.x1 - p.x0, p.h, p.t);
      const mesh = new THREE.Mesh(geo, plMat);
      mesh.position.set((p.x0 + p.x1) / 2, p.y + p.h / 2, p.front - p.t / 2);
      mesh.applyMatrix4(basis);
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
    new THREE.MeshStandardMaterial({ color: new THREE.Color(css("--part-edge")), metalness: 0.55, roughness: 0.35 });

  /** Bar on two posts, or a knob on one post, standing off the front's outer face. */
  function addHandle(pg: THREE.Group, h: HandlePlacement): void {
    const m = metal();
    const pts = h.points.map((q) => new THREE.Vector3(q.x, q.y, q.z).sub(pg.position));
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

  function frame(): void {
    if (!root) return;
    // Frame the cabinets, not the floor grid (first child).
    // Cabinet groups carry their placement as a fixed matrix: bring the world matrices up to date first.
    root.updateMatrixWorld(true);
    const b = new THREE.Box3();
    root.children.slice(1).forEach((o) => b.expandByObject(o));
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

  let down: { x: number; y: number } | null = null;
  function onDown(e: PointerEvent): void {
    down = { x: e.clientX, y: e.clientY };
  }
  function onUp(e: PointerEvent): void {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes)[0];
    if (hit) {
      store.ui.selected = hit.object.userData.cabinet;
      store.ui.part = hit.object.userData.part;
      store.ui.pane = "cabinet";
    }
  }

  /** Double-click (touch: long press) on a part: its parameters in the construction editor (D59). */
  function paramsAt(e: { clientX: number; clientY: number }): void {
    const r = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    // The first click of a double-click rebuilt the meshes (selection); they are placed with the next frame.
    scene.updateMatrixWorld();
    const part = ray.intersectObjects(meshes)[0]?.object.userData.part as string | undefined;
    if (part) store.openPartParams(part);
  }

  $effect(() => {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      failed = true;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 10, 50000);
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
    return () => {
      mq.removeEventListener("change", onTheme);
      ro.disconnect();
      renderer?.setAnimationLoop(null);
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
    rebuild();
  });
</script>

<section class="panel view">
  <div class="bar">
    <ViewModeSwitch />
    {#if !single && store.result?.room}
      <select id="walls-shown" aria-label={t("ui.walls_show")} title={t("ui.walls_show")} bind:value={store.ui.walls}>
        {#each ["all", "used", "none"] as w}<option value={w}>{t(`ui.walls_show.${w}`)}</option>{/each}
      </select>
    {/if}
    <button aria-pressed={store.ui.explode} onclick={() => (store.ui.explode = !store.ui.explode)}>{t("ui.explode")}</button>
    <button aria-pressed={store.ui.ops} onclick={() => (store.ui.ops = !store.ui.ops)}>{t("ui.machining")}</button>
    <button aria-pressed={store.ui.fronts} onclick={() => (store.ui.fronts = !store.ui.fronts)}>{t("ui.fronts")}</button>
    <span class="sp"></span>
    {#if store.cabinet}
      {@const v = (n: string) => store.cabinet!.resolved.values.get(n)}
      <span class="mono muted dims">{store.cabinet.resolved.cabinet.id} · W {v("W")} · H {v("H")} · D {v("D")}</span>
    {/if}
    <button onclick={frame}>{t("ui.fit")}</button>
  </div>
  {#if failed}
    <p class="muted fail">{t("ui.no_webgl")}</p>
  {/if}
  <canvas bind:this={canvas} onpointerdown={onDown} onpointerup={onUp} ondblclick={paramsAt} use:longPress={paramsAt}></canvas>
  <span class="hint">{t("ui.view_hint")}</span>
</section>

<style>
  .view { position: relative; display: flex; flex-direction: column; overflow: hidden; height: 100%; min-height: 460px; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); align-items: center; }
  .sp { flex: 1; }
  .dims { font-size: 12px; }
  canvas { display: block; width: 100%; flex: 1; min-height: 400px; background: var(--view); touch-action: none; }
  .hint { position: absolute; left: 10px; bottom: 8px; font-size: 11px; color: var(--muted); pointer-events: none; }
  .fail { padding: 16px; }
</style>
