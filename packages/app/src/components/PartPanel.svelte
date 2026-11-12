<script lang="ts">
  import { localName, type Axis, type Part } from "@cabinet-planner/engine";
  import { store } from "../lib/store.svelte.ts";
  import PartSettings from "./PartSettings.svelte";

  /**
   * A picked part (D59): what it is, what can be set for this one part
   * (`cabinet.parts[code]`: material, surface, edges, remark), the settings
   * of the cabinet that drive it, and the way on to parameters and formulas.
   */
  type Doc = Record<string, any>;
  type EdgeKey = "l1" | "l2" | "w1" | "w2";
  let { part }: { part: Part } = $props();

  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const lib = $derived(store.result?.library);
  const editing = $derived(store.ui.construction !== null && store.ui.construction === store.ui.selected);
  const fmt = (x: number): string => store.tr.number(x, 2);
  const name = $derived(part.label !== undefined ? localName(part.label, store.tr.locale) : t(`role.${part.role}`));
  const own = $derived((c?.parts?.[part.code] ?? {}) as Doc);

  /** Writes one field of the part's override; undefined removes it (back to the cabinet's setting). */
  function setOwn(key: "material" | "surface" | "note", value: string | null | undefined): void {
    if (!c) return;
    c.parts ??= {};
    const o = { ...(c.parts[part.code] ?? {}) };
    if (value === undefined || value === "") delete o[key];
    else o[key] = value;
    if (Object.keys(o).length) c.parts[part.code] = o;
    else delete c.parts[part.code];
  }
  function setEdge(k: EdgeKey, value: string | null | undefined): void {
    if (!c) return;
    c.parts ??= {};
    const o = { ...(c.parts[part.code] ?? {}) };
    const edges = { ...(o.edges ?? {}) };
    if (value === undefined) delete edges[k];
    else edges[k] = value;
    if (Object.keys(edges).length) o.edges = edges;
    else delete o.edges;
    if (Object.keys(o).length) c.parts[part.code] = o;
    else delete c.parts[part.code];
  }
  /** Select value ↔ stored value: "" is "no edgeband / no surface" (null). */
  const pick = (e: Event): string | null => (e.target as HTMLSelectElement).value || null;

  const materials = $derived([...(lib?.materials.values() ?? [])]);
  const surfaces = $derived([...(lib?.surfaces.values() ?? [])]);
  const edgebands = $derived([...(lib?.edgebands.values() ?? [])]);
  const surface = $derived(part.surface ? lib?.surfaces.get(part.surface) : undefined);

  /** Where an edge sits in the cabinet (D2): l1/l2 close the width, w1/w2 the length. */
  const SIDE: Record<Axis, [string, string]> = { x: ["left", "right"], y: ["bottom", "top"], z: ["rear", "front"] };
  const EDGES = $derived<{ k: EdgeKey; where: string; len: number }[]>([
    { k: "l1", where: SIDE[part.widthAxis][0], len: part.length },
    { k: "l2", where: SIDE[part.widthAxis][1], len: part.length },
    { k: "w1", where: SIDE[part.lengthAxis][0], len: part.width },
    { k: "w2", where: SIDE[part.lengthAxis][1], len: part.width },
  ]);
  /** Edge picture as in the cutlist: length left to right, L1 bottom, L2 top, W1 left, W2 right. */
  const box = $derived.by(() => {
    const ratio = Math.min(3, Math.max(1 / 3, part.length / part.width));
    return ratio >= 1 ? { w: 84, h: Math.max(28, 84 / ratio) } : { w: Math.max(28, 84 * ratio), h: 84 };
  });
  let hot = $state<EdgeKey | null>(null);

  let head = $state<HTMLElement>();
  // Narrow screens: the panel is below the drawing; bring its head into view when a part is picked.
  $effect(() => {
    void part.id;
    if (store.narrow) head?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
</script>

<div class="pp" data-part={part.id}>
  <div class="head" bind:this={head}>
    <button class="quiet back" onclick={() => store.selectPart(null)}>‹ {editing ? t("ui.construction") : t("ui.part.back", { id: part.cabinet })}</button>
    <h2>{name} <span class="mono muted">{part.id}</span></h2>
  </div>

  <dl class="facts">
    <dt>{t("ui.part.finished")}</dt>
    <dd class="mono">{fmt(part.length)} × {fmt(part.width)} × {fmt(part.thickness)}</dd>
    <dt>{t("ui.cut_size")}</dt>
    <dd class="mono">{fmt(part.cutLength)} × {fmt(part.cutWidth)}</dd>
    <dt>{t("col.material")}</dt>
    <dd>{localName(lib?.materials.get(part.material)?.name ?? part.material, store.tr.locale)}{#if part.grain}<span class="muted" title={t("col.grain")}> ↔</span>{/if}</dd>
    <dt>{t("col.surface")}</dt>
    <dd>{surface ? localName(surface.name, store.tr.locale) : t("option.surface.none")}</dd>
  </dl>

  {#if c && part.role !== "custom"}
    <section>
      <h3 class="label">{t("ui.part.only_this")}</h3>
      <p class="muted small">{t("ui.part.only_this_hint")}</p>
      <div class="orow" class:own={own.material !== undefined}>
        <label for="pp-material">{t("col.material")}</label>
        <select id="pp-material" value={part.material} onchange={(e) => setOwn("material", pick(e))}>
          {#each materials as m}<option value={m.id}>{localName(m.name, store.tr.locale)}</option>{/each}
        </select>
        <span class="reset">{#if own.material !== undefined}<button class="quiet" title={t("ui.part.reset")} aria-label={`${t("ui.part.reset")}: ${t("col.material")}`} onclick={() => setOwn("material", undefined)}>↺</button>{/if}</span>
      </div>
      <div class="orow" class:own={own.surface !== undefined}>
        <label for="pp-surface">{t("col.surface")}</label>
        <select id="pp-surface" value={part.surface ?? ""} onchange={(e) => setOwn("surface", pick(e))}>
          <option value="">{t("option.surface.none")}</option>
          {#each surfaces as s}<option value={s.id}>{localName(s.name, store.tr.locale)}</option>{/each}
        </select>
        <span class="reset">{#if own.surface !== undefined}<button class="quiet" title={t("ui.part.reset")} aria-label={`${t("ui.part.reset")}: ${t("col.surface")}`} onclick={() => setOwn("surface", undefined)}>↺</button>{/if}</span>
      </div>

      <div class="edges">
        <svg width="112" height="112" viewBox="-14 -14 112 112" role="img" aria-label={t("ui.part.edge_picture")}>
          <g transform={`translate(${(84 - box.w) / 2} ${(84 - box.h) / 2})`}>
            <rect class="eb-part" x="0" y="0" width={box.w} height={box.h} />
            <line class="eb" class:on={part.edges.l1} class:hot={hot === "l1"} x1="0" y1={box.h} x2={box.w} y2={box.h} />
            <line class="eb" class:on={part.edges.l2} class:hot={hot === "l2"} x1="0" y1="0" x2={box.w} y2="0" />
            <line class="eb" class:on={part.edges.w1} class:hot={hot === "w1"} x1="0" y1="0" x2="0" y2={box.h} />
            <line class="eb" class:on={part.edges.w2} class:hot={hot === "w2"} x1={box.w} y1="0" x2={box.w} y2={box.h} />
            <text class="el" x={box.w / 2} y={box.h + 11} text-anchor="middle">{t("ui.part.edge_code.l1")}</text>
            <text class="el" x={box.w / 2} y="-4" text-anchor="middle">{t("ui.part.edge_code.l2")}</text>
            <text class="el" x="-4" y={box.h / 2 + 3} text-anchor="end">{t("ui.part.edge_code.w1")}</text>
            <text class="el" x={box.w + 4} y={box.h / 2 + 3}>{t("ui.part.edge_code.w2")}</text>
            <text class="dim" x={box.w / 2} y={box.h / 2 + 3} text-anchor="middle">{fmt(part.length)} × {fmt(part.width)}</text>
          </g>
        </svg>
        <div class="erows">
          {#each EDGES as e (e.k)}
            {@const mine = own.edges?.[e.k] !== undefined}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="orow edge" class:own={mine} onfocusin={() => (hot = e.k)} onfocusout={() => (hot = null)} onpointerenter={() => (hot = e.k)} onpointerleave={() => (hot = null)}>
              <label for={`pp-edge-${e.k}`}>
                <span class="mono code">{t(`ui.part.edge_code.${e.k}`)}</span>
                {t(`ui.part.edge.${e.where}`)} <span class="muted mono">{fmt(e.len)}</span>
              </label>
              <select id={`pp-edge-${e.k}`} value={part.edges[e.k] ?? ""} onchange={(ev) => setEdge(e.k, pick(ev))}>
                <option value="">{t("option.edge.none")}</option>
                {#each edgebands as b}<option value={b.id}>{b.code} · {localName(b.name, store.tr.locale)}</option>{/each}
              </select>
              <span class="reset">{#if mine}<button class="quiet" title={t("ui.part.reset")} aria-label={`${t("ui.part.reset")}: ${t(`ui.part.edge_code.${e.k}`)}`} onclick={() => setEdge(e.k, undefined)}>↺</button>{/if}</span>
            </div>
          {/each}
        </div>
      </div>
      <div class="orow" class:own={own.note !== undefined}>
        <label for="pp-note">{t("col.note")}</label>
        <input id="pp-note" type="text" value={part.note ?? ""} placeholder="–" onchange={(e) => setOwn("note", (e.target as HTMLInputElement).value.trim())} />
        <span class="reset"></span>
      </div>
    </section>
  {/if}

  {#if part.role === "custom"}
    <p class="muted small">{t("ui.part.custom_hint")}</p>
  {:else}
    <section class="settings">
      <h3 class="label">{t("ui.part.settings")}</h3>
      <p class="muted small">{t("ui.part.settings_hint", { id: part.cabinet })}</p>
      <PartSettings {part} />
    </section>
  {/if}

  <button class="primary params" onclick={() => store.openPartParams(part.id)}>{t("ui.part.params")}</button>
  <p class="muted small">{t(store.narrow ? "ui.part.params_hint_touch" : "ui.part.params_hint")}</p>
</div>

<style>
  .pp { display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
  .back { color: var(--accent-fg); padding: 2px 6px 2px 0; }
  h2 { margin: 0; font-size: 16px; }
  h2 .mono { font-size: 12px; font-weight: 400; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-size: 13px; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; }
  section { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  .settings { gap: 8px; }
  h3 { margin: 0 0 2px; }
  .small { font-size: 12px; margin: 0; }
  .orow { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.25fr) 28px; gap: 2px 6px; align-items: center; }
  .orow select, .orow input { width: 100%; min-width: 0; color: color-mix(in srgb, var(--fg) 72%, var(--muted)); background: var(--surface-2); }
  .orow.own select, .orow.own input { color: var(--fg); background: var(--surface); font-weight: 600; border-color: color-mix(in srgb, var(--line) 55%, var(--accent)); }
  .orow .reset button { padding: 0 6px; color: var(--accent-fg); }
  .orow label { line-height: 1.3; overflow-wrap: anywhere; }
  .edges { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; padding: 4px 0; }
  .edges svg { flex: none; }
  .erows { flex: 1 1 240px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .orow.edge { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px; }
  .code { font-size: 11px; color: var(--accent-fg); margin-right: 2px; }
  .eb-part { fill: var(--surface-2); stroke: var(--line); stroke-width: 1; }
  .eb { stroke: transparent; stroke-width: 4; stroke-linecap: square; }
  .eb.on { stroke: var(--accent); }
  .eb.hot { stroke: var(--fg); stroke-width: 5; }
  .el { font: 9px var(--font-mono); fill: var(--muted); }
  .dim { font: 9px var(--font-mono); fill: var(--fg); }
  .params { margin-top: 4px; }
</style>
