<script lang="ts">
  import { addCabinet, duplicateCabinet, moveCabinet, removeCabinet, store } from "../lib/store.svelte.ts";
  import { formatNumber } from "@cabinet-planner/engine";
  import TemplatePicker from "./TemplatePicker.svelte";

  let picking = $state(false);

  const t = $derived(store.tr.t);
  const cabinets = $derived((store.project.cabinets ?? []) as Record<string, any>[]);
  const widthOf = (id: string): string => {
    const c = store.result?.cabinets.find((x) => x.resolved.cabinet.id === id);
    const w = c?.resolved.values.get("W");
    return w === undefined ? "?" : formatNumber(w);
  };
  const hasError = (id: string): boolean =>
    !!store.result?.diagnostics.some((d) => d.cabinet === id && d.severity === "error");
  let confirmDelete = $state<string | null>(null);

  // Several cabinets at once (D73): Ctrl/Shift-click, or the checkbox mode for touch.
  const multi = $derived(store.multi);
  function pick(e: MouseEvent, id: string): void {
    if (store.ui.multiMode || e.ctrlKey || e.metaKey) return store.toggleMulti(id);
    if (e.shiftKey) return store.selectRange(id);
    store.select(id);
    // Narrow screens: the list is a drawer; get out of the way.
    if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 700px)").matches) store.ui.panel = null;
  }
  function toggleMode(): void {
    store.ui.multiMode = !store.ui.multiMode;
    if (store.ui.multiMode) store.ui.multi = store.ui.selected ? [store.ui.selected] : [];
    else store.select(store.ui.selected);
  }
</script>

<section class="panel list">
  <div class="head">
    <span class="label">{t("ui.cabinets")}</span>
    <button class="quiet mm" aria-pressed={store.ui.multiMode} title={t("ui.multi.mode_hint")} onclick={toggleMode}>{t("ui.multi.mode")}</button>
  </div>
  <div class="add" role="group" aria-label={t("ui.add_cabinet")}>
    <button onclick={() => addCabinet("base")}>+ {t("ui.kind.base")}</button>
    <button onclick={() => addCabinet("wall")}>+ {t("ui.kind.wall")}</button>
    <button onclick={() => addCabinet("tall")}>+ {t("ui.kind.tall")}</button>
    <button id="add-template" class="more" onclick={() => (picking = true)}>{t("ui.add_from_template")}</button>
  </div>
  <ul>
    {#each cabinets as c (c.id)}
      <li>
        <button
          class="item"
          class:checks={store.ui.multiMode}
          aria-pressed={multi.length ? multi.includes(c.id) : store.ui.selected === c.id}
          onclick={(e) => pick(e, c.id)}
        >
          {#if store.ui.multiMode}<span class="check" class:on={store.ui.multi.includes(c.id)} aria-hidden="true">{store.ui.multi.includes(c.id) ? "✓" : ""}</span>{/if}
          <span class="mono id" class:err={hasError(c.id)}>{c.id}</span>
          <span class="nm">{c.name || t(`ui.kind.${c.kind ?? "base"}`)}</span>
          <span class="mono w">{widthOf(c.id)}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if multi.length}
    <div class="actions">
      <span class="muted small">{t("ui.multi.count", { n: multi.length })}</span>
      <button class="quiet" onclick={() => { store.ui.multiMode = false; store.select(store.ui.selected); }}>{t("ui.multi.end")}</button>
    </div>
  {:else if store.ui.selected}
    {@const id = store.ui.selected}
    <div class="actions">
      <button class="quiet" title={t("ui.move_up")} aria-label={t("ui.move_up")} onclick={() => moveCabinet(id, -1)}>↑</button>
      <button class="quiet" title={t("ui.move_down")} aria-label={t("ui.move_down")} onclick={() => moveCabinet(id, 1)}>↓</button>
      <button class="quiet" onclick={() => duplicateCabinet(id)}>{t("ui.duplicate")}</button>
      {#if confirmDelete === id}
        <button class="quiet danger" onclick={() => { removeCabinet(id); confirmDelete = null; }}>{t("ui.confirm_delete")}</button>
      {:else}
        <button class="quiet" onclick={() => (confirmDelete = id)}>{t("ui.delete")}</button>
      {/if}
    </div>
  {/if}
</section>
{#if picking}<TemplatePicker onclose={() => (picking = false)} />{/if}

<style>
  .list { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .add { display: flex; flex-wrap: wrap; gap: 6px; }
  .add button { flex: 1 1 auto; padding: 4px 8px; }
  .add .more { flex: 1 1 100%; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .item { width: 100%; display: grid; grid-template-columns: 34px 1fr auto; gap: 6px; text-align: left; align-items: baseline; }
  .item.checks { grid-template-columns: 20px 34px 1fr auto; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .mm { font-size: 12px; padding: 2px 6px; color: var(--accent-fg); }
  .mm[aria-pressed="true"] { background: var(--accent-soft); font-weight: 600; }
  .check { width: 18px; height: 18px; border: 1.5px solid var(--muted); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; line-height: 1; align-self: center; background: var(--surface); }
  .check.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .small { font-size: 12px; align-self: center; margin-right: auto; }
  .id { font-size: 12px; }
  .id.err { color: var(--err); }
  .nm { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.25; }
  .w { color: var(--muted); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 2px; border-top: 1px solid var(--line); padding-top: 8px; }
  .danger { color: var(--err); }
</style>
