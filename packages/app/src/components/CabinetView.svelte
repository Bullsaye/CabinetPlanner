<script lang="ts">
  import { formatNumber, frontViewOf, type FrontViewPart } from "@cabinet-planner/engine";
  import { swingPoints } from "../lib/elevation.ts";
  import { longPress } from "../lib/longpress.ts";
  import { store } from "../lib/store.svelte.ts";
  import RightPane from "./RightPane.svelte";
  import Viewer3D from "./Viewer3D.svelte";
  import ViewModeSwitch from "./ViewModeSwitch.svelte";

  // The selected cabinet alone (D68): its front elevation to scale, drawn from
  // the built parts, or the same cabinet in 3D. On narrow screens the
  // cabinet's settings follow below the drawing.
  const t = $derived(store.tr.t);
  const cab = $derived(store.cabinet);
  const fv = $derived(cab && cab.parts.length ? frontViewOf(cab) : undefined);
  const cabinets = $derived((store.project.cabinets ?? []) as Record<string, any>[]);

  // Paper: pixels, Y down. Margins hold the dimension chains.
  const M = { left: 52, right: 14, top: 14, bottom: 58 };
  let cw = $state(0);
  let ch = $state(0);
  const s = $derived.by(() => {
    if (!fv || !cw || !ch) return 0;
    const b = fv.bounds;
    return Math.max(0.01, Math.min((cw - M.left - M.right) / (b.x1 - b.x0), (ch - M.top - M.bottom) / (b.y1 - b.y0), 1));
  });
  // Centre the drawing in the stage.
  const ox = $derived(fv ? M.left + Math.max(0, (cw - M.left - M.right - (fv.bounds.x1 - fv.bounds.x0) * s) / 2) : 0);
  const oy = $derived(fv ? M.top + Math.max(0, (ch - M.top - M.bottom - (fv.bounds.y1 - fv.bounds.y0) * s) / 2) : 0);
  const X = (x: number): number => (fv ? ox + (x - fv.bounds.x0) * s : 0);
  const Y = (y: number): number => (fv ? oy + (fv.bounds.y1 - y) * s : 0);

  const shown = $derived(fv ? fv.parts.filter((p) => store.ui.fronts || !p.front) : []);
  const rectOf = (p: { x: number; y: number; w: number; h: number }) => ({ x: X(p.x), y: Y(p.y + p.h), w: p.w * s, h: p.h * s });

  /** Plinth panel in front of this cabinet (a room part, D31), as cabinet Y range. */
  const plinthPanel = $derived.by(() => {
    const room = store.result?.room;
    const q = room?.placements.find((x) => x.cabinet === fv?.cabinet);
    if (!room || !q || !fv) return undefined;
    const p = room.plinths.find((x) => x.wall === q.wall && x.x0 < q.x + q.W - 0.5 && x.x1 > q.x + 0.5);
    return p ? { y: p.y - q.baseY, h: p.h } : undefined;
  });

  /** A click picks the part: the right pane shows its settings (D73). */
  function pick(p: FrontViewPart): void {
    store.selectPart(p.id);
    store.ui.zone = p.zone ?? null;
  }
  /** Double-click (touch: long press): the parameters behind the part, in the construction editor. */
  function params(p: FrontViewPart): void {
    store.ui.zone = p.zone ?? null;
    store.openPartParams(p.id);
  }
  /** A click beside the cabinet: nothing picked, back to the cabinet's editor. */
  function clear(e: MouseEvent): void {
    if (e.target !== e.currentTarget) return;
    store.selectPart(null);
    store.ui.zone = null;
  }
  const onKey = (e: KeyboardEvent, p: FrontViewPart): void => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (e.shiftKey) params(p);
    else pick(p);
  };
  // A zone picked in another cabinet means nothing here.
  let lastCabinet: string | null = store.ui.selected;
  $effect(() => {
    if (store.ui.selected === lastCabinet) return;
    lastCabinet = store.ui.selected;
    store.ui.zone = null;
  });
  // Dimension chains: width below, heights on the left.
  const dy = $derived(fv ? Y(fv.bounds.y0) + 20 : 0);
  const dx = $derived(fv ? X(fv.bounds.x0) - 20 : 0);
  const val = (n: string): string => formatNumber(cab?.resolved.values.get(n) ?? 0);
</script>

<div class="cv">
  {#if store.ui.cabinet3d}
    <Viewer3D single />
  {:else}
    <section class="panel elev">
      <div class="bar">
        <ViewModeSwitch />
        <button aria-pressed={store.ui.fronts} onclick={() => (store.ui.fronts = !store.ui.fronts)}>{t("ui.fronts")}</button>
        <span class="sp"></span>
        {#if cabinets.length > 1}
          <select id="cv-cabinet" class="pick" aria-label={t("ui.cabinet")} value={store.ui.selected} onchange={(e) => store.select((e.target as HTMLSelectElement).value)}>
            {#each cabinets as c}<option value={c.id}>{c.id}{c.name ? ` · ${c.name}` : ""}</option>{/each}
          </select>
        {/if}
        {#if cab}
          <span class="mono muted dims">{cab.resolved.cabinet.id} · W {val("W")} · H {val("H")} · D {val("D")}</span>
        {/if}
      </div>
      <div class="stage" bind:clientWidth={cw} bind:clientHeight={ch}>
        {#if !cab}
          <div class="empty">
            <p class="muted">{cabinets.length ? t("ui.cabinet_view_pick") : t("ui.cabinet_view_empty")}</p>
            <button class="only-phone" onclick={() => (store.ui.panel = "list")}>{t("ui.cabinets")}</button>
          </div>
        {:else if !fv}
          <div class="empty"><p class="muted">{t("ui.cabinet_view_error")}</p></div>
        {:else if s > 0}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <svg width={cw} height={ch} viewBox={`0 0 ${cw} ${ch}`} role="group" aria-label={t("ui.cabinet_view")} onclick={clear}>
            <!-- Floor, legs and plinth panel. -->
            {#if fv.kind !== "wall"}
              {#each fv.legs as l}
                <rect class="leg" x={X(l.x) - (l.d * s) / 2} y={Y(l.y1)} width={l.d * s} height={(l.y1 - l.y0) * s} />
              {/each}
              {#if plinthPanel}
                <rect class="plinth" x={X(0)} y={Y(plinthPanel.y + plinthPanel.h)} width={fv.W * s} height={plinthPanel.h * s} />
              {/if}
              <line class="floor" x1={X(fv.bounds.x0) - 18} x2={X(fv.bounds.x1) + 18} y1={Y(-fv.plinth)} y2={Y(-fv.plinth)} />
            {/if}

            <!-- Parts back to front, as built. -->
            {#each shown as p (p.id)}
              {@const r = rectOf(p)}
              {@const sel = store.ui.part === p.id || (p.front && p.zone !== undefined && store.ui.zone === p.zone)}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <g
                class="part {p.role}"
                class:front={p.front}
                class:sel
                role={p.front ? "button" : undefined}
                tabindex={p.front ? 0 : undefined}
                aria-label={p.front ? `${t(`role.${p.role}`)} ${p.code}` : undefined}
                aria-pressed={p.front ? sel : undefined}
                data-part={p.id}
                onclick={() => pick(p)}
                ondblclick={() => params(p)}
                use:longPress={() => params(p)}
                onkeydown={p.front ? (e) => onKey(e, p) : undefined}
              >
                {#if p.points}
                  <polygon points={p.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} />
                {:else}
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} />
                {/if}
                {#if p.front && p.hinge}
                  <polyline class="swing" points={swingPoints(r, p.hinge, store.ui.hingeSymbol)} />
                {/if}
              </g>
            {/each}

            <!-- Hinges on the hinge edge and handles where they are drilled. -->
            {#if store.ui.fronts}
              {#each fv.hinges as h}
                {@const len = Math.max(h.d * 1.4 * s, 10)}
                {@const th = Math.max(14 * s, 4)}
                {@const door = fv.parts.find((p) => p.id === h.part)!}
                {#if h.edge === "top"}
                  <rect class="hinge" x={X(h.x) - len / 2} y={Y(door.y + door.h)} width={len} height={th} />
                {:else}
                  <rect class="hinge" x={h.edge === "left" ? X(door.x) : X(door.x + door.w) - th} y={Y(h.y) - len / 2} width={th} height={len} />
                {/if}
              {/each}
              {#each fv.handles as h}
                {#if h.kind === "knob"}
                  <circle class="knob" cx={X(h.x1)} cy={Y(h.y1)} r={Math.max((h.d / 2) * s, 3.5)} />
                {:else}
                  <line class="handle" x1={X(h.x1)} y1={Y(h.y1)} x2={X(h.x2)} y2={Y(h.y2)} stroke-width={Math.max(h.d * s, 3.5)} />
                {/if}
              {/each}
            {/if}

            <!-- Overall width and height of the carcase; plinth height below. -->
            <line class="dim" x1={X(0)} x2={X(fv.W)} y1={dy} y2={dy} />
            <line class="tick" x1={X(0)} x2={X(0)} y1={dy - 5} y2={dy + 5} />
            <line class="tick" x1={X(fv.W)} x2={X(fv.W)} y1={dy - 5} y2={dy + 5} />
            <text class="num" x={X(fv.W / 2)} y={dy + 15} text-anchor="middle">{formatNumber(fv.W)}</text>
            <line class="dim" x1={dx} x2={dx} y1={Y(fv.H)} y2={Y(-fv.plinth)} />
            <line class="tick" x1={dx - 5} x2={dx + 5} y1={Y(fv.H)} y2={Y(fv.H)} />
            <line class="tick" x1={dx - 5} x2={dx + 5} y1={Y(0)} y2={Y(0)} />
            <text class="num" x={dx - 7} y={Y(fv.H / 2)} text-anchor="middle" transform={`rotate(-90 ${dx - 7} ${Y(fv.H / 2)})`}>{formatNumber(fv.H)}</text>
            {#if fv.plinth > 0}
              <line class="tick" x1={dx - 5} x2={dx + 5} y1={Y(-fv.plinth)} y2={Y(-fv.plinth)} />
              {#if fv.plinth * s >= 26}
                <text class="num" x={dx - 7} y={Y(-fv.plinth / 2)} text-anchor="middle" transform={`rotate(-90 ${dx - 7} ${Y(-fv.plinth / 2)})`}>{formatNumber(fv.plinth)}</text>
              {:else}
                <text class="num" x={dx - 7} y={Y(-fv.plinth / 2) + 4} text-anchor="end">{formatNumber(fv.plinth)}</text>
              {/if}
            {/if}
          </svg>
        {/if}
      </div>
      {#if fv}<span class="hint">{t(store.narrow ? "ui.part.view_hint_touch" : "ui.part.view_hint")}</span>{/if}
    </section>
  {/if}
  {#if store.narrow}
    <RightPane />
  {/if}
</div>

<style>
  .cv { display: flex; flex-direction: column; gap: 12px; height: 100%; min-width: 0; }
  .elev { position: relative; display: flex; flex-direction: column; overflow: hidden; flex: none; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); align-items: center; }
  .sp { flex: 1; }
  .dims { font-size: 12px; }
  .pick { max-width: 14em; display: none; }
  .only-phone { display: none; }
  .stage { flex: none; height: max(400px, calc(100vh - 190px)); background: var(--view); position: relative; overflow: hidden; }
  .stage svg { display: block; position: absolute; inset: 0; }
  .empty { padding: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .empty p { margin: 0; }
  .hint { position: absolute; left: 10px; bottom: 6px; font-size: 11px; color: var(--muted); pointer-events: none; }

  .part rect, .part polygon { fill: var(--part); stroke: var(--part-edge); stroke-width: 1; }
  .part.back rect { fill: color-mix(in srgb, var(--part) 86%, var(--fg)); }
  .part { cursor: pointer; -webkit-touch-callout: none; user-select: none; }
  .part.front rect, .part.front polygon { fill: color-mix(in srgb, var(--surface) 78%, var(--accent)); stroke: var(--fg); stroke-width: 1; }
  .part.front.drawer_front rect { fill: color-mix(in srgb, var(--surface) 84%, var(--accent)); }
  .part.front.blind_panel rect, .part.front.appliance_front rect, .part.front.ceiling_filler rect { fill: color-mix(in srgb, var(--surface) 88%, var(--fg)); }
  .part.sel rect, .part.sel polygon { stroke: var(--accent); stroke-width: 2.5; }
  .part.front.sel rect, .part.front.sel polygon { fill: color-mix(in srgb, var(--surface) 62%, var(--accent)); }
  .part:focus-visible { outline: none; }
  .part:focus-visible rect, .part:focus-visible polygon { stroke: var(--accent); stroke-width: 2.5; }
  .part .swing { fill: none; stroke: var(--muted); stroke-width: 1; stroke-dasharray: 7 4; pointer-events: none; }
  .hinge { fill: var(--fg); pointer-events: none; }
  .handle { stroke: var(--fg); stroke-linecap: round; pointer-events: none; }
  .knob { fill: var(--fg); pointer-events: none; }
  .leg { fill: var(--part-edge); }
  .plinth { fill: var(--shade-side); stroke: var(--part-edge); stroke-width: 1; }
  .floor { stroke: var(--fg); stroke-width: 1.5; }
  .dim { stroke: var(--muted); stroke-width: 1; }
  .tick { stroke: var(--fg); stroke-width: 1.2; }
  .num { font: 12px var(--font-mono); fill: var(--fg); }

  @media (max-width: 1100px) {
    .cv { height: auto; }
    .elev { flex: none; min-height: 0; }
    .stage { flex: none; height: min(58vh, 560px); min-height: 300px; }
  }
  @media (max-width: 700px) {
    .pick, .only-phone { display: inline-block; }
    .dims { display: none; }
  }
</style>
