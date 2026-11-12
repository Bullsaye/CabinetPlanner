<script lang="ts">
  import { FACTORY_TEMPLATES, buildProject, loadProject, localName, type Part } from "@cabinet-planner/engine";
  import { addFromTemplate, store } from "../lib/store.svelte.ts";

  /** Template chooser: every template as a small front view built by the engine, grouped. */
  let { onclose }: { onclose: () => void } = $props();
  const t = $derived(store.tr.t);
  const groups = ["kitchen", "storage", "wardrobe", "bath"] as const;
  const allShop = $derived(store.built.shop?.library.templates ?? []);
  const factoryIds = new Set(FACTORY_TEMPLATES.map((x) => x.id));
  const sections = $derived([
    { title: t("ui.my_templates"), items: allShop.filter((x) => !factoryIds.has(x.id)) },
    ...groups.map((g) => ({
      title: t(`ui.template_group.${g}`),
      items: FACTORY_TEMPLATES.filter((x) => x.group === g).map((f) => allShop.find((x) => x.id === f.id) ?? f),
    })),
  ].filter((s) => s.items.length));

  const FRONT = new Set(["door", "drawer_front", "flap", "blind_panel", "appliance_front"]);
  interface Thumb { W: number; H: number; base: number; fronts: Part[]; inner: Part[]; carcase: Part[] }
  /** Builds a template with the shop's defaults; undefined when it has errors. */
  function thumb(tpl: { cabinet: unknown }): Thumb | undefined {
    try {
      const r = buildProject(loadProject({ schemaVersion: 1, name: "t", cabinets: [{ id: "T1", type: "box", ...(tpl.cabinet as object) }] }), store.built.shop);
      const c = r.cabinets[0];
      if (!c || !c.parts.length) return undefined;
      const v = (n: string): number => c.resolved.values.get(n) ?? 0;
      const wall = c.resolved.cabinet.kind === "wall";
      return {
        W: v("W"),
        H: v("H"),
        base: wall ? 0 : v("plinth_h"),
        fronts: c.parts.filter((p) => FRONT.has(p.role)),
        inner: c.parts.filter((p) => p.role === "shelf" || p.role === "fixed_shelf" || p.role === "partition"),
        carcase: c.parts.filter((p) => ["side_left", "side_right", "bottom", "top", "rail_front", "custom"].includes(p.role)),
      };
    } catch {
      return undefined;
    }
  }
  const thumbs = $derived(new Map(sections.flatMap((s) => s.items.map((x) => [x.id, thumb(x)] as const))));
  function choose(tpl: unknown): void {
    addFromTemplate(tpl as never);
    onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />
<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="sheet panel" role="dialog" aria-modal="true" aria-labelledby="tp-title">
    <div class="top">
      <h2 id="tp-title">{t("ui.add_from_template")}</h2>
      <button class="quiet" aria-label={t("ui.close")} onclick={onclose}>×</button>
    </div>
    {#each sections as s}
      <h3 class="label">{s.title}</h3>
      <div class="cards">
        {#each s.items as tpl (tpl.id)}
          {@const th = thumbs.get(tpl.id)}
          <button class="card" onclick={() => choose(tpl)}>
            {#if th}
              <svg viewBox={`-20 -20 ${th.W + 40} ${th.H + th.base + 40}`} aria-hidden="true">
                <g transform={`translate(0 ${th.H}) scale(1 -1)`}>
                  {#each th.carcase as p}<rect class="tc" x={p.box.x} y={p.box.y} width={p.box.dx} height={p.box.dy} />{/each}
                  {#each th.inner as p}<rect class="ti" x={p.box.x} y={p.box.y} width={p.box.dx} height={p.box.dy} />{/each}
                  {#each th.fronts as p}<rect class="tf" x={p.box.x} y={p.box.y} width={p.box.dx} height={p.box.dy} />{/each}
                  {#if th.base > 0}<rect class="tp" x={th.W * 0.04} y={-th.base} width={th.W * 0.92} height={th.base} />{/if}
                </g>
              </svg>
            {:else}
              <span class="none muted">?</span>
            {/if}
            <span class="nm">{localName(tpl.name, store.ui.lang)}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / .35); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .sheet { width: min(980px, 100%); max-height: min(86vh, 900px); overflow: auto; padding: 14px 16px 18px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 12px 40px rgb(0 0 0 / .25); }
  .top { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font-size: 16px; }
  h3 { margin: 8px 0 0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; }
  .card { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; text-align: center; height: 100%; }
  .card svg { width: 100%; height: 96px; }
  .none { height: 96px; display: flex; align-items: center; }
  .nm { font-size: 12px; line-height: 1.25; }
  .tc { fill: var(--surface-2); stroke: var(--fg); stroke-width: 6; }
  .ti { fill: var(--muted); opacity: .45; }
  .tf { fill: var(--accent-soft); stroke: var(--accent-fg); stroke-width: 6; }
  .tp { fill: var(--fg); opacity: .55; }
</style>
