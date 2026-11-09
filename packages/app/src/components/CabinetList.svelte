<script lang="ts">
  import { addCabinet, addFromTemplate, duplicateCabinet, moveCabinet, removeCabinet, store } from "../lib/store.svelte.ts";
  import { FACTORY_TEMPLATES, formatNumber, localName } from "@cabinet-planner/engine";

  const groups = ["kitchen", "storage", "wardrobe", "bath"] as const;
  // Shop templates with a factory id replace that factory template (saved from the construction editor).
  const allShop = $derived(store.built.shop?.library.templates ?? []);
  const factoryIds = new Set(FACTORY_TEMPLATES.map((x) => x.id));
  const shopTemplates = $derived(allShop.filter((x) => !factoryIds.has(x.id)));
  const factoryList = $derived(FACTORY_TEMPLATES.map((f) => allShop.find((x) => x.id === f.id) ?? f));
  function pick(e: Event): void {
    const sel = e.target as HTMLSelectElement;
    const tpl = factoryList.find((x) => x.id === sel.value) ?? shopTemplates.find((x) => `shop:${x.id}` === sel.value);
    if (tpl) addFromTemplate(tpl as never);
    sel.value = "";
  }

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
</script>

<section class="panel list">
  <div class="head">
    <span class="label">{t("ui.cabinets")}</span>
  </div>
  <div class="add" role="group" aria-label={t("ui.add_cabinet")}>
    <button onclick={() => addCabinet("base")}>+ {t("ui.kind.base")}</button>
    <button onclick={() => addCabinet("wall")}>+ {t("ui.kind.wall")}</button>
    <button onclick={() => addCabinet("tall")}>+ {t("ui.kind.tall")}</button>
    <select id="add-template" aria-label={t("ui.add_from_template")} onchange={pick}>
      <option value="">{t("ui.add_from_template")}</option>
      {#if shopTemplates.length}
        <optgroup label={t("ui.my_templates")}>
          {#each shopTemplates as tpl}<option value={`shop:${tpl.id}`}>{localName(tpl.name, store.ui.lang)}</option>{/each}
        </optgroup>
      {/if}
      {#each groups as g}
        <optgroup label={t(`ui.template_group.${g}`)}>
          {#each FACTORY_TEMPLATES.filter((x) => x.group === g).map((f) => factoryList.find((x) => x.id === f.id) ?? f) as tpl}
            <option value={tpl.id}>{localName(tpl.name, store.ui.lang)}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </div>
  <ul>
    {#each cabinets as c (c.id)}
      <li>
        <button
          class="item"
          aria-pressed={store.ui.selected === c.id}
          onclick={() => {
            store.ui.selected = c.id;
            store.ui.part = null;
            // Narrow screens: the list is a drawer; get out of the way.
            if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 700px)").matches) store.ui.panel = null;
          }}
        >
          <span class="mono id" class:err={hasError(c.id)}>{c.id}</span>
          <span class="nm">{c.name || t(`ui.kind.${c.kind ?? "base"}`)}</span>
          <span class="mono w">{widthOf(c.id)}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if store.ui.selected}
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

<style>
  .list { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .add { display: flex; flex-wrap: wrap; gap: 6px; }
  .add button { flex: 1 1 auto; padding: 4px 8px; }
  .add select { flex: 1 1 100%; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .item { width: 100%; display: grid; grid-template-columns: 34px 1fr auto; gap: 6px; text-align: left; align-items: baseline; }
  .id { font-size: 12px; }
  .id.err { color: var(--err); }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .w { color: var(--muted); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; gap: 2px; border-top: 1px solid var(--line); padding-top: 8px; }
  .danger { color: var(--err); }
</style>
