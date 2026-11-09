<script lang="ts">
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { sceneOf, type CabinetResult } from "@cabinet-planner/engine";
  import { store } from "../lib/store.svelte.ts";

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

  const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

  /** Run layout: floor units side by side, wall units side by side above. */
  function layout(cabs: CabinetResult[]): Map<string, THREE.Vector3> {
    const pos = new Map<string, THREE.Vector3>();
    let xf = 0;
    let xw = 0;
    for (const c of cabs) {
      const v = (n: string): number => c.resolved.values.get(n) ?? 0;
      const kind = c.resolved.cabinet.kind;
      if (kind === "wall") {
        pos.set(c.resolved.cabinet.id, new THREE.Vector3(xw, v("wall_bottom"), 0));
        xw += v("W");
      } else {
        pos.set(c.resolved.cabinet.id, new THREE.Vector3(xf, v("plinth_h"), 0));
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
    const cabs = store.result.cabinets;
    const pos = layout(cabs);

    // Floor.
    const grid = new THREE.GridHelper(8000, 80, edgeColor, edgeColor);
    (grid.material as THREE.Material).opacity = 0.18;
    (grid.material as THREE.Material).transparent = true;
    root.add(grid);

    for (const c of cabs) {
      const sc = sceneOf(c);
      const id = c.resolved.cabinet.id;
      const g = new THREE.Group();
      g.position.copy(pos.get(id)!);
      const selected = store.ui.selected === id;
      const centre = new THREE.Vector3(sc.size.W / 2, sc.size.H / 2, sc.size.D / 2);
      for (const p of sc.parts) {
        const isFront = p.role === "door" || p.role === "drawer_front";
        if (isFront && !store.ui.fronts) continue;
        const b = p.box;
        const pg = new THREE.Group();
        const isPart = store.ui.part === p.id;
        const base =
          p.role === "back" ? partColor.clone().offsetHSL(0, 0, -0.06) : isFront ? partColor.clone().lerp(accent, 0.12) : partColor;
        const color = isPart ? partColor.clone().lerp(accent, 0.45) : selected ? base.clone().lerp(accent, 0.1) : base;
        const geo = new THREE.BoxGeometry(b.dx, b.dy, b.dz);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }));
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
      root.add(g);
    }
    scene.add(root);
    if (!framed) frame();
  }

  function frame(): void {
    if (!root) return;
    // Frame the cabinets, not the floor grid (first child).
    const b = new THREE.Box3();
    root.children.slice(1).forEach((o) => b.expandByObject(o));
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3());
    const r = b.getSize(new THREE.Vector3()).length();
    camera.position.set(c.x + r * 0.7, c.y + r * 0.55, c.z + r * 1.55);
    controls.target.copy(c);
    controls.update();
    framed = true;
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
      if (store.ui.layer === "cabinet" || !store.ui.layer) store.ui.layer = "cabinet";
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
    store.ui.explode;
    store.ui.ops;
    store.ui.fronts;
    rebuild();
  });
</script>

<section class="panel view">
  <div class="bar">
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
  <canvas bind:this={canvas} onpointerdown={onDown} onpointerup={onUp}></canvas>
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
