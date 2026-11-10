<script lang="ts">
  import { formatNumber, layoutFronts, localName } from "@cabinet-planner/engine";
  import { parseInput, store } from "../lib/store.svelte.ts";

  type Zone = { type: string; h?: number | string; doors?: number; hinge?: "left" | "right"; front?: boolean; shelves?: number; handle?: string | null };
  type Section = { w?: number | string; fronts?: Zone[]; interior?: "shelves" | "hanging"; shelves?: number | string; construction?: unknown };
  const TYPES = ["door", "drawer", "flap", "open", "appliance", "panel"] as const;

  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const res = $derived(store.cabinet?.resolved);
  const v = (n: string): number => res?.values.get(n) ?? 0;
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  /** Handle items for a zone's own handle (D48). */
  const handleItems = $derived([...(store.result?.library.hardware.values() ?? [])].filter((h) => h.category === "handle"));
  const handleValue = (z: Zone): string => (z.handle === undefined ? "" : z.handle === null ? "none" : z.handle);
  function setHandle(i: number, v: string): void {
    edit((l) => {
      if (v === "") delete l[i]!.handle;
      else l[i]!.handle = v === "none" ? null : v;
    });
  }

  /** Sections (D46): each has its own stack; without them the cabinet's stack spans the width. */
  const sections = $derived<Section[] | undefined>((c?.sections as Section[] | undefined)?.length ? (c!.sections as Section[]) : undefined);
  let sel = $state(0);
  const cur = $derived(sections ? Math.min(sel, sections.length - 1) : 0);
  const defaultSectionStack = (): Zone[] => [{ type: "door", doors: 1 }];

  /** The stack as edited: the selected section's, the cabinet's own, or one door zone made from door_count. */
  const zones = $derived<Zone[]>(
    sections
      ? (sections[cur]?.fronts ?? defaultSectionStack())
      : ((c?.fronts as Zone[] | undefined) ?? (v("door_count") > 0 ? [{ type: "door", doors: v("door_count") }] : [])),
  );
  function edit(f: (list: Zone[]) => void): void {
    if (!c) return;
    if (sections) {
      const s = (c.sections as Section[])[cur]!;
      if (!s.fronts) s.fronts = clone(zones);
      f(s.fronts);
      return;
    }
    if (!c.fronts) c.fronts = clone(zones);
    f(c.fronts as Zone[]);
  }

  // --- Sections -------------------------------------------------------------
  function split(): void {
    if (!c) return;
    const stack = clone(zones).map((z) => (z.type === "door" ? { ...z, doors: 1 } : z));
    c.sections = [{ fronts: clone(stack) }, { fronts: clone(stack) }];
    delete c.fronts;
    if (c.vars?.partition_count !== undefined) delete c.vars.partition_count;
    sel = 0;
  }
  function addSection(): void {
    if (!c || !sections) return;
    (c.sections as Section[]).push({ fronts: clone(zones) });
    sel = (c.sections as Section[]).length - 1;
  }
  function removeSection(): void {
    if (!c || !sections) return;
    const list = c.sections as Section[];
    if (list.length <= 2) {
      // Back to one stack across the cabinet: keep the selected section's fronts.
      c.fronts = clone(zones);
      delete c.sections;
    } else list.splice(cur, 1);
    sel = 0;
  }
  function setSection(key: "w" | "interior" | "shelves", value: string | number | undefined): void {
    if (!c || !sections) return;
    const s = (c.sections as Section[])[cur]!;
    if (value === undefined || value === "") delete s[key];
    else (s as Record<string, unknown>)[key] = value;
  }

  // --- Placed fronts per column, in the front view ----------------------------
  const W = $derived(v("W"));
  const H = $derived(v("H"));
  const T = $derived(v("t_carcase"));
  const gl = $derived(v("front_gap_left"));
  const gr = $derived(v("front_gap_right"));
  const gm = $derived(v("front_gap_middle"));
  /** Section clear widths as the engine shares them (fixed widths first, the rest equally). */
  const widths = $derived.by(() => {
    if (!sections) return [];
    const n = sections.length;
    const LW = W - 2 * T - (n - 1) * T;
    const fixed = sections.map((s) => (typeof s.w === "number" ? s.w : undefined));
    const rest = fixed.filter((x) => x === undefined).length;
    const share = rest ? (LW - fixed.reduce<number>((a, x) => a + (x ?? 0), 0)) / rest : 0;
    return fixed.map((x) => x ?? share);
  });
  const columns = $derived.by(() => {
    if (!res) return [];
    const stacks: { zones: Zone[]; fx0: number; fx1: number; doorDefault: number; hingeDefault: "left" | "right"; k: number }[] = [];
    if (!sections) {
      stacks.push({ zones, fx0: gl, fx1: W - gr, doorDefault: v("door_count"), hingeDefault: (res.options.get("door_hinge_side")?.value as "left" | "right") ?? "left", k: 0 });
    } else {
      let x = T;
      sections.forEach((s, k) => {
        const w = widths[k]!;
        const last = k === sections.length - 1;
        stacks.push({
          zones: s.fronts ?? defaultSectionStack(),
          fx0: k === 0 ? gl : x - T / 2 + gm / 2,
          fx1: last ? W - gr : x + w + T / 2 - gm / 2,
          doorDefault: 1,
          hingeDefault: k === 0 ? "left" : last ? "right" : ((res.options.get("door_hinge_side")?.value as "left" | "right") ?? "left"),
          k,
        });
        x += w + T;
      });
    }
    return stacks.map((st) => {
      let placed: ReturnType<typeof layoutFronts>["fronts"] = [];
      try {
        placed = layoutFronts(clone(st.zones) as never, H, { top: v("front_gap_top"), bottom: v("front_gap_bottom"), between: v("front_gap") }, st.doorDefault, res.values, { cabinet: c?.id ?? "" }).fronts;
      } catch {
        placed = [];
      }
      return { ...st, placed };
    });
  });

  /** Door mode of a zone: one door hinged left or right, or a pair. */
  const hingeDefault = $derived(columns[sections ? cur : 0]?.hingeDefault ?? "left");
  const doorMode = (z: Zone, def = hingeDefault, doors = sections ? 1 : v("door_count")): "left" | "right" | "pair" =>
    (z.doors ?? doors) >= 2 ? "pair" : (z.hinge ?? def);
  function setDoorMode(i: number, m: "left" | "right" | "pair"): void {
    edit((l) => {
      const z = l[i]!;
      if (m === "pair") {
        z.doors = 2;
        delete z.hinge;
      } else {
        z.doors = 1;
        z.hinge = m;
      }
    });
  }

  const LAYOUTS: { id: string; zones: Zone[] }[] = [
    { id: "door_left", zones: [{ type: "door", doors: 1, hinge: "left" }] },
    { id: "door_right", zones: [{ type: "door", doors: 1, hinge: "right" }] },
    { id: "doors_pair", zones: [{ type: "door", doors: 2 }] },
    { id: "drawer_door", zones: [{ type: "drawer", h: 150 }, { type: "door" }] },
    { id: "drawers_3", zones: [{ type: "drawer", h: 150 }, { type: "drawer", h: 150 }, { type: "drawer" }] },
    { id: "drawers_4", zones: [{ type: "drawer", h: 140 }, { type: "drawer", h: 140 }, { type: "drawer", h: 140 }, { type: "drawer" }] },
    { id: "flap", zones: [{ type: "flap" }] },
    { id: "open", zones: [] },
  ];
  function applyLayout(l: Zone[]): void {
    if (!c) return;
    if (sections) {
      (c.sections as Section[])[cur]!.fronts = clone(l);
      return;
    }
    c.fronts = clone(l);
    if (!l.length) c.vars = { ...(c.vars ?? {}), door_count: 0 };
    else if (c.vars?.door_count === 0) delete c.vars.door_count;
  }

  // Preview geometry (front view, paper Y down), with sloped corners (D47).
  const s = $derived(W && H ? Math.min(150 / W, 190 / H) : 1);
  const outline = $derived.by(() => {
    const pts: [number, number][] = [[0, 0], [W, 0]];
    const r = v("slope_right_drop");
    const l = v("slope_left_drop");
    const rr = r > 0 ? r / Math.tan((v("slope_right_angle") * Math.PI) / 180) : 0;
    const lr = l > 0 ? l / Math.tan((v("slope_left_angle") * Math.PI) / 180) : 0;
    pts.push([W, H - r], [W - rr, H], [lr, H], [0, H - l]);
    return pts.map(([x, y]) => `${x * s},${(H - y) * s}`).join(" ");
  });
  function rects(col: (typeof columns)[number], i: number): { x: number; w: number; hinge?: "left" | "right" }[] {
    const z = col.zones[i];
    const p = col.placed[i];
    if (!z || !p) return [];
    const X0 = col.fx0;
    const X1 = col.fx1;
    if (z.type === "door" && doorMode(z, col.hingeDefault, col.doorDefault) === "pair") {
      const dw = (X1 - X0 - gm) / 2;
      return [{ x: X0, w: dw, hinge: "left" }, { x: X0 + dw + gm, w: dw, hinge: "right" }];
    }
    return [{ x: X0, w: X1 - X0, ...(z.type === "door" ? { hinge: doorMode(z, col.hingeDefault, col.doorDefault) as "left" | "right" } : {}) }];
  }
</script>

{#if c}
  <div class="fb">
    <div class="sections" role="group" aria-label={t("ui.sections")}>
      {#if sections}
        {#each sections as _, k}
          <button class="tab" aria-pressed={k === cur} onclick={() => (sel = k)}>{t("ui.section_n", { n: k + 1 })}</button>
        {/each}
        <button class="quiet small-btn" onclick={addSection} disabled={sections.length >= 6}>{t("ui.add_section")}</button>
        <button class="quiet small-btn" onclick={removeSection}>{t("ui.remove_section")}</button>
      {:else}
        <button class="quiet small-btn" onclick={split} title={t("ui.split_sections_hint")}>{t("ui.split_sections")}</button>
      {/if}
    </div>
    {#if sections}
      {@const sec = sections[cur]!}
      <div class="secprops">
        <label>{t("ui.section_width")}
          <input class="mono" type="text" inputmode="decimal" value={sec.w ?? ""} placeholder={t("ui.rest")} onchange={(e) => setSection("w", parseInput((e.target as HTMLInputElement).value))} />
        </label>
        <label>{t("ui.section_interior")}
          <select value={sec.interior ?? ""} onchange={(e) => setSection("interior", (e.target as HTMLSelectElement).value || undefined)}>
            <option value="">{t("ui.inherit")}</option>
            <option value="shelves">{t("option.interior.shelves")}</option>
            <option value="hanging">{t("ui.section_hanging")}</option>
          </select>
        </label>
        <label>{t("ui.section_shelves")}
          <input class="mono" type="text" inputmode="decimal" value={sec.shelves ?? ""} placeholder={String(v("shelf_count"))} onchange={(e) => setSection("shelves", parseInput((e.target as HTMLInputElement).value))} />
        </label>
      </div>
    {/if}
    <div class="layouts" role="group" aria-label={t("ui.front_layouts")}>
      {#each LAYOUTS as l}
        <button class="quiet lay" title={t(`ui.layout.${l.id}`)} onclick={() => applyLayout(l.zones)}>{t(`ui.layout.${l.id}`)}</button>
      {/each}
    </div>
    <div class="body">
      {#if W && H}
        <svg class="preview" viewBox={`-4 -4 ${W * s + 8} ${H * s + 8}`} width={W * s + 8} height={H * s + 8} role="img" aria-label={t("ui.front_preview")}>
          <polygon class="carcase" points={outline} />
          {#each columns as col}
            {#each col.placed as p, i}
              {#each rects(col, i) as r}
                {@const y = (H - p.y1) * s}
                {@const h = (p.y1 - p.y0) * s}
                {#if col.zones[i]?.type === "open" || (col.zones[i]?.type === "appliance" && !col.zones[i]?.front)}
                  <rect class="hole" class:dim={sections && col.k !== cur} x={r.x * s} {y} width={r.w * s} height={h} />
                {:else}
                  <rect class="front {col.zones[i]?.type}" class:dim={sections && col.k !== cur} x={r.x * s} {y} width={r.w * s} height={h} />
                  {#if r.hinge}
                    <!-- Opening symbol: lines from the opening edge to the middle of the hinge edge. -->
                    {@const hx = r.hinge === "left" ? r.x * s : (r.x + r.w) * s}
                    {@const ox = r.hinge === "left" ? (r.x + r.w) * s : r.x * s}
                    <polyline class="swing" points={`${ox},${y} ${hx},${y + h / 2} ${ox},${y + h}`} />
                  {/if}
                  {#if col.zones[i]?.type === "flap"}
                    <polyline class="swing" points={`${r.x * s},${y + h} ${(r.x + r.w / 2) * s},${y} ${(r.x + r.w) * s},${y + h}`} />
                  {/if}
                {/if}
              {/each}
              {#if !sections || col.k === cur}
                <text class="h" x={col.fx1 * s - 3} y={(H - (p.y0 + p.y1) / 2) * s + 3} text-anchor="end">{formatNumber(p.y1 - p.y0)}</text>
              {/if}
            {/each}
          {/each}
        </svg>
      {/if}
      <div class="rows">
        {#each zones as z, i}
          <div class="row">
            <select id={`fz-type-${i}`} aria-label={t("ui.front_type")} value={z.type} onchange={(e) => edit((l) => (l[i]!.type = (e.target as HTMLSelectElement).value))}>
              {#each TYPES as ty}<option value={ty}>{t(`ui.zone.${ty}`)}</option>{/each}
            </select>
            <input
              id={`fz-h-${i}`}
              class="mono"
              type="text"
              inputmode="decimal"
              value={z.h ?? ""}
              placeholder={t("ui.rest")}
              aria-label={t("ui.front_height")}
              onchange={(e) => {
                const val = parseInput((e.target as HTMLInputElement).value);
                edit((l) => (val === undefined ? delete l[i]!.h : (l[i]!.h = val)));
              }}
            />
            {#if z.type === "door"}
              <div class="seg" role="group" aria-label={t("ui.opening")}>
                {#each ["left", "pair", "right"] as m}
                  <button aria-pressed={doorMode(z) === m} title={t(`ui.door_mode.${m}`)} onclick={() => setDoorMode(i, m as "left")}>{t(`ui.door_mode_short.${m}`)}</button>
                {/each}
              </div>
            {:else if z.type === "appliance"}
              <label class="chk"><input type="checkbox" checked={z.front ?? false} onchange={(e) => edit((l) => (l[i]!.front = (e.target as HTMLInputElement).checked))} /> {t("ui.appliance_front")}</label>
            {:else if z.type === "open"}
              <input class="mono shelves" type="text" inputmode="numeric" value={z.shelves ?? ""} placeholder={t("ui.zone_shelves")} title={t("ui.zone_shelves")} aria-label={t("ui.zone_shelves")} onchange={(e) => {
                const val = parseInput((e.target as HTMLInputElement).value);
                edit((l) => (typeof val === "number" ? (l[i]!.shelves = Math.max(0, Math.round(val))) : delete l[i]!.shelves));
              }} />
            {:else}<span></span>{/if}
            {#if z.type === "door" || z.type === "drawer" || z.type === "flap" || (z.type === "appliance" && z.front)}
              <select class="handle" aria-label={t("ui.zone_handle")} title={t("ui.zone_handle")} value={handleValue(z)} onchange={(e) => setHandle(i, (e.target as HTMLSelectElement).value)}>
                <option value="">{t("ui.zone_handle_default")}</option>
                <option value="none">{t("ui.zone_handle_none")}</option>
                {#each handleItems as h}<option value={h.id}>{localName(h.name, store.tr.locale)}</option>{/each}
              </select>
            {:else}<span></span>{/if}
            <span class="tools">
              <button class="quiet" aria-label={t("ui.move_up")} disabled={i === 0} onclick={() => edit((l) => l.splice(i - 1, 0, ...l.splice(i, 1)))}>↑</button>
              <button class="quiet" aria-label={t("ui.move_down")} disabled={i === zones.length - 1} onclick={() => edit((l) => l.splice(i + 1, 0, ...l.splice(i, 1)))}>↓</button>
              <button class="quiet" aria-label={t("ui.delete")} onclick={() => edit((l) => l.splice(i, 1))}>×</button>
            </span>
          </div>
        {/each}
        {#if !zones.length}<p class="muted small">{t("ui.no_fronts")}</p>{/if}
        <div class="add">
          <button onclick={() => edit((l) => l.push({ type: "drawer", h: 150 }))}>{t("ui.add_drawer")}</button>
          <button onclick={() => edit((l) => l.push({ type: "door", doors: 1 }))}>{t("ui.add_door_zone")}</button>
          <button onclick={() => edit((l) => l.push({ type: "open" }))}>{t("ui.add_open")}</button>
          {#if !sections}<button onclick={() => edit((l) => l.push({ type: "flap" }))}>{t("ui.add_flap")}</button>{/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .fb { display: flex; flex-direction: column; gap: 8px; }
  .sections { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .tab { font-size: 12px; padding: 2px 10px; }
  .small-btn { font-size: 12px; padding: 2px 8px; border: 1px solid var(--line); }
  .secprops { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .secprops label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); }
  .secprops input, .secprops select { width: 100%; }
  .layouts { display: flex; flex-wrap: wrap; gap: 4px; }
  .lay { font-size: 12px; padding: 2px 8px; border: 1px solid var(--line); }
  .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-items: start; }
  .preview { display: block; }
  .carcase { fill: var(--surface-2); stroke: var(--part-edge); stroke-width: 1; }
  .front { fill: color-mix(in srgb, var(--surface) 75%, var(--accent)); stroke: var(--fg); stroke-width: .8; }
  .front.drawer { fill: color-mix(in srgb, var(--surface) 82%, var(--accent)); }
  .front.panel, .front.appliance { fill: color-mix(in srgb, var(--surface) 88%, var(--fg)); }
  .dim { opacity: .45; }
  .hole { fill: var(--view); stroke: var(--part-edge); stroke-width: .6; stroke-dasharray: 3 2; }
  .swing { fill: none; stroke: var(--muted); stroke-width: .8; stroke-dasharray: 4 2; }
  .h { font: 9px var(--font-mono); fill: var(--fg); }
  .rows { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .row { display: grid; grid-template-columns: minmax(84px, 1fr) 58px auto minmax(70px, 1fr) auto; gap: 4px; align-items: center; }
  .row select.handle { min-width: 0; width: 100%; font-size: 12px; }
  .row input { width: 100%; }
  .row input.shelves { width: 4.5em; }
  .seg { display: flex; }
  .seg button { padding: 2px 7px; border-radius: 0; font-size: 12px; white-space: nowrap; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; }
  .chk { display: flex; align-items: center; gap: 4px; font-size: 12px; white-space: nowrap; }
  .tools { display: flex; }
  .tools button { padding: 0 4px; }
  .add { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .add button { font-size: 12px; padding: 3px 8px; }
  .small { font-size: 12px; margin: 0; }
  @media (max-width: 420px) { .secprops { grid-template-columns: 1fr; } }
</style>
