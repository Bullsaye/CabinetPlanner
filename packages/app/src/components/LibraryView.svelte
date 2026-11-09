<script lang="ts">
  import {
    FACTORY_EDGEBANDS,
    FACTORY_HARDWARE,
    FACTORY_MATERIALS,
    FACTORY_PRESETS,
    HardwareItem,
    localName,
    type HardwareItem as HardwareItemT,
  } from "@cabinet-planner/engine";
  import { openFile } from "../lib/platform.ts";
  import { parseInput, store } from "../lib/store.svelte.ts";

  type Section = "materials" | "edgebands" | "hardware" | "presets";
  type Doc = Record<string, any>;

  const t = $derived(store.tr.t);
  let section = $state<Section>("materials");
  let note = $state("");

  /** The shop library (the file the user edits here), created on demand. */
  function lib(): Doc {
    store.shop.library ??= {};
    const l = store.shop.library;
    for (const k of ["materials", "edgebands", "hardware", "presets", "templates"]) l[k] ??= [];
    return l;
  }
  const shopIds = (k: string): Set<string> => new Set((store.shop.library?.[k] ?? []).map((x: Doc) => x.id));
  const projectIds = (k: string): Set<string> => new Set((store.project.library?.[k] ?? []).map((x: Doc) => x.id));
  const sourceOf = (k: string, id: string): "project" | "shop" | "factory" =>
    projectIds(k).has(id) ? "project" : shopIds(k).has(id) ? "shop" : "factory";
  const name = (n: unknown): string => localName(n as never, store.tr.locale);
  // Read-only: safe in the template (lib() creates missing arrays, so only event handlers call it).
  const shopItem = (k: string, id: string): Doc | undefined => store.shop.library?.[k]?.find((x: Doc) => x.id === id);

  /** Copies a factory item into the shop library (same id: the shop version wins). */
  function toShop(k: string, item: unknown): void {
    if (shopItem(k, (item as Doc).id)) return;
    lib()[k].push(JSON.parse(JSON.stringify(item)));
  }
  function removeShop(k: string, id: string): void {
    const l = lib();
    l[k] = l[k].filter((x: Doc) => x.id !== id);
  }
  function uniqueId(k: string, base: string): string {
    const used = new Set([...(store.result?.library[k as "materials"]?.keys() ?? []), ...shopIds(k)]);
    for (let i = 1; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  }
  function setNum(item: Doc, key: string, text: string, min = 0): void {
    const v = parseInput(text);
    if (typeof v === "number" && v >= min) item[key] = v;
    else if (text.trim() === "" && key === "pricePerM2") delete item[key];
  }

  // --- Materials and edgebands -------------------------------------------------
  const materials = $derived([...(store.result?.library.materials.values() ?? FACTORY_MATERIALS)]);
  const edgebands = $derived([...(store.result?.library.edgebands.values() ?? FACTORY_EDGEBANDS)]);
  const usedMaterials = $derived(new Set(store.result?.parts.map((p) => p.material) ?? []));

  function addMaterial(): void {
    const id = uniqueId("materials", "material");
    lib().materials.push({ id, name: t("ui.new_material"), thickness: 19, grain: false });
  }
  function addEdgeband(): void {
    const id = uniqueId("edgebands", "band");
    lib().edgebands.push({ id, name: t("ui.new_edgeband"), thickness: 1, width: 23, code: `E${lib().edgebands.length + 1}` });
  }

  // --- Hardware -----------------------------------------------------------------
  const CATS = ["hinge", "slide", "handle", "connector", "shelf_support", "leg", "rail", "other"] as const;
  let cat = $state<string>("");
  let query = $state("");
  let selectedHw = $state<string | null>(null);
  let json = $state("");
  let jsonError = $state("");
  const hardware = $derived(
    [...(store.result?.library.hardware.values() ?? FACTORY_HARDWARE)].filter(
      (h) =>
        (!cat || h.category === cat) &&
        (!query || `${h.id} ${name(h.name)} ${h.manufacturer ?? ""} ${h.articles.map((a) => a.code).join(" ")}`.toLowerCase().includes(query.toLowerCase())),
    ),
  );
  const hw = $derived(selectedHw ? store.result?.library.hardware.get(selectedHw) : undefined);
  const usedHw = $derived(new Set(store.result?.cabinets.flatMap((c) => c.hardware.map((h) => h.item)) ?? []));

  function editJson(item: HardwareItemT): void {
    toShop("hardware", item);
    json = JSON.stringify(shopItem("hardware", item.id), null, 2);
    jsonError = "";
  }
  function saveJson(): void {
    try {
      const parsed = HardwareItem.parse(JSON.parse(json));
      const l = lib();
      const i = l.hardware.findIndex((x: Doc) => x.id === parsed.id);
      const raw = JSON.parse(json);
      if (i >= 0) l.hardware[i] = raw;
      else l.hardware.push(raw);
      selectedHw = parsed.id;
      jsonError = "";
      json = "";
      note = t("ui.hardware_saved", { id: parsed.id });
    } catch (e) {
      jsonError = String((e as Error).message);
    }
  }
  async function importHardware(): Promise<void> {
    const f = await openFile(["json"]);
    if (!f) return;
    try {
      const raw = JSON.parse(f.text);
      const items = Array.isArray(raw) ? raw : [raw];
      for (const r of items) {
        HardwareItem.parse(r);
        removeShop("hardware", r.id);
        lib().hardware.push(r);
      }
      note = t("ui.hardware_imported", { n: items.length, file: f.name });
    } catch (e) {
      note = t("ui.load_failed", { file: f.name, error: String((e as Error).message) });
    }
  }

  // --- Presets and templates -----------------------------------------------------
  const presets = $derived([...FACTORY_PRESETS, ...(store.built.shop?.library.presets ?? []), ...(store.result?.project.library.presets ?? [])]);
  const templates = $derived(store.built.shop?.library.templates ?? []);
  let newName = $state("");

  /** The selected cabinet's own values as a preset (no size), or the whole cabinet as a template. */
  function saveFromCabinet(kind: "preset" | "template"): void {
    const c = store.cabinetDoc;
    if (!c) return;
    const label = newName.trim() || c.name || c.id;
    const snap = JSON.parse(JSON.stringify($state.snapshot(c)));
    if (kind === "preset") {
      const { W: _w, ...vars } = snap.vars ?? {};
      lib().presets.push({ id: uniqueId("presets", "preset"), name: label, group: "shop", vars, options: snap.options ?? {} });
    } else {
      lib().templates.push({
        id: uniqueId("templates", "template"),
        name: label,
        group: "shop",
        cabinet: { kind: snap.kind ?? "base", presets: snap.presets ?? [], vars: snap.vars ?? {}, options: snap.options ?? {}, ...(snap.fronts ? { fronts: snap.fronts } : {}), parts: snap.parts ?? {} },
      });
    }
    newName = "";
    note = t(kind === "preset" ? "ui.preset_saved" : "ui.template_saved", { name: label });
  }
</script>

<section class="panel lv">
  <div class="bar">
    <div role="group" aria-label={t("ui.library")}>
      {#each ["materials", "edgebands", "hardware", "presets"] as s}
        <button aria-pressed={section === s} onclick={() => (section = s as Section)}>{t(`ui.lib.${s}`)}</button>
      {/each}
    </div>
    <span class="sp"></span>
    <span class="muted small">{t("ui.library_edit_hint")}</span>
  </div>
  {#if note}<p class="note muted" role="status">{note}</p>{/if}

  {#if section === "materials"}
    <div class="scroll-x">
      <table class="grid">
        <thead><tr><th>{t("ui.id")}</th><th>{t("ui.name")}</th><th>{t("ui.thickness")}</th><th>{t("ui.grain")}</th><th>{t("ui.price_m2")}</th><th></th><th></th></tr></thead>
        <tbody>
          {#each materials as m (m.id)}
            {@const src = sourceOf("materials", m.id)}
            {@const own = src === "shop" ? shopItem("materials", m.id) : undefined}
            <tr>
              <td class="mono">{m.id}</td>
              {#if own}
                <td><input type="text" aria-label={t("ui.name")} value={name(own.name)} onchange={(e) => (own.name = (e.target as HTMLInputElement).value)} /></td>
                <td><input class="mono num" type="text" inputmode="decimal" aria-label={t("ui.thickness")} value={own.thickness} onchange={(e) => setNum(own, "thickness", (e.target as HTMLInputElement).value, 0.1)} /></td>
                <td><input type="checkbox" aria-label={t("ui.grain")} checked={own.grain ?? false} onchange={(e) => (own.grain = (e.target as HTMLInputElement).checked)} /></td>
                <td><input class="mono num" type="text" inputmode="decimal" aria-label={t("ui.price_m2")} value={own.pricePerM2 ?? ""} onchange={(e) => setNum(own, "pricePerM2", (e.target as HTMLInputElement).value)} /></td>
              {:else}
                <td>{name(m.name)}</td>
                <td class="n">{m.thickness}</td>
                <td>{m.grain ? "✓" : ""}</td>
                <td class="n">{m.pricePerM2 ?? ""}</td>
              {/if}
              <td><span class="pill {src}">{t(`layer.${src}`)}</span>{#if usedMaterials.has(m.id)} <span class="pill project">{t("ui.in_use")}</span>{/if}</td>
              <td class="acts">
                {#if src === "factory"}<button class="quiet" onclick={() => toShop("materials", m)}>{t("ui.edit_in_shop")}</button>{/if}
                {#if src === "shop"}<button class="quiet" onclick={() => removeShop("materials", m.id)}>{t("ui.remove")}</button>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="foot"><button onclick={addMaterial}>{t("ui.add_material")}</button></div>
  {:else if section === "edgebands"}
    <div class="scroll-x">
      <table class="grid">
        <thead><tr><th>{t("ui.id")}</th><th>{t("ui.name")}</th><th>{t("ui.code")}</th><th>{t("ui.thickness")}</th><th>{t("ui.width")}</th><th></th><th></th></tr></thead>
        <tbody>
          {#each edgebands as b (b.id)}
            {@const src = sourceOf("edgebands", b.id)}
            {@const own = src === "shop" ? shopItem("edgebands", b.id) : undefined}
            <tr>
              <td class="mono">{b.id}</td>
              {#if own}
                <td><input type="text" aria-label={t("ui.name")} value={name(own.name)} onchange={(e) => (own.name = (e.target as HTMLInputElement).value)} /></td>
                <td><input class="mono num" type="text" maxlength="8" aria-label={t("ui.code")} value={own.code} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) own.code = v; }} /></td>
                <td><input class="mono num" type="text" inputmode="decimal" aria-label={t("ui.thickness")} value={own.thickness} onchange={(e) => setNum(own, "thickness", (e.target as HTMLInputElement).value)} /></td>
                <td><input class="mono num" type="text" inputmode="decimal" aria-label={t("ui.width")} value={own.width} onchange={(e) => setNum(own, "width", (e.target as HTMLInputElement).value, 1)} /></td>
              {:else}
                <td>{name(b.name)}</td>
                <td class="mono">{b.code}</td>
                <td class="n">{b.thickness}</td>
                <td class="n">{b.width}</td>
              {/if}
              <td><span class="pill {src}">{t(`layer.${src}`)}</span></td>
              <td class="acts">
                {#if src === "factory"}<button class="quiet" onclick={() => toShop("edgebands", b)}>{t("ui.edit_in_shop")}</button>{/if}
                {#if src === "shop"}<button class="quiet" onclick={() => removeShop("edgebands", b.id)}>{t("ui.remove")}</button>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="foot"><button onclick={addEdgeband}>{t("ui.add_edgeband")}</button></div>
  {:else if section === "hardware"}
    <div class="hwbar">
      <select id="hw-cat" aria-label={t("ui.category")} bind:value={cat}>
        <option value="">{t("ui.all_categories")}</option>
        {#each CATS as c}<option value={c}>{t(`ui.cat.${c}`)}</option>{/each}
      </select>
      <input id="hw-search" type="text" placeholder={t("ui.search_hardware")} aria-label={t("ui.search_hardware")} bind:value={query} />
      <button onclick={importHardware}>{t("ui.import_hardware")}</button>
    </div>
    <div class="hw">
      <ul class="hwlist">
        {#each hardware as h (h.id)}
          <li>
            <button class="item" aria-pressed={selectedHw === h.id} onclick={() => { selectedHw = h.id; json = ""; }}>
              <span class="nm">{name(h.name)}</span>
              <span class="muted small">{t(`ui.cat.${h.category}`)}{h.manufacturer ? ` · ${h.manufacturer}` : ""}</span>
              <span class="pills">
                <span class="pill {sourceOf('hardware', h.id)}">{t(`layer.${sourceOf("hardware", h.id)}`)}</span>
                {#if usedHw.has(h.id)}<span class="pill project">{t("ui.in_use")}</span>{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="detail">
        {#if json}
          <p class="muted small">{t("ui.hardware_json_hint")}</p>
          <textarea class="mono" spellcheck="false" aria-label="JSON" bind:value={json}></textarea>
          {#if jsonError}<pre class="err">{jsonError}</pre>{/if}
          <div class="row">
            <button class="primary" onclick={saveJson}>{t("ui.save")}</button>
            <button onclick={() => (json = "")}>{t("ui.cancel")}</button>
          </div>
        {:else if hw}
          <h3>{name(hw.name)}</h3>
          <p class="muted small mono">{hw.id}{hw.series ? ` · ${hw.series}` : ""} · {t(`ui.trust.${hw.trust}`)}</p>
          {#if hw.articles.length}<p class="small">{t("ui.articles")}: <span class="mono">{hw.articles.map((a) => a.code).join(", ")}</span></p>{/if}
          {#if hw.source}<p class="small muted">{hw.source}</p>{/if}
          {#if Object.keys(hw.params).length}
            <h4 class="label">{t("ui.parameters")}</h4>
            <table class="grid"><tbody>{#each Object.entries(hw.params) as [k, v]}<tr><td class="mono">{k}</td><td class="mono">{v}</td></tr>{/each}</tbody></table>
          {/if}
          {#if hw.drilling.length}
            <h4 class="label">{t("ui.drilling")}</h4>
            <div class="scroll-x">
              <table class="grid">
                <thead><tr><th>{t("ui.mount")}</th><th>Ø</th><th>{t("ui.depth")}</th><th>a</th><th>b</th></tr></thead>
                <tbody>{#each hw.drilling as d}<tr><td>{d.mount}</td><td class="n">{d.d}</td><td class="n">{d.through ? t("drawing.through") : d.depth}</td><td class="n">{d.a}</td><td class="n">{d.b}</td></tr>{/each}</tbody>
              </table>
            </div>
          {/if}
          {#if hw.limits.length}
            <h4 class="label">{t("ui.limits")}</h4>
            <table class="grid"><tbody>{#each hw.limits as l}<tr><td class="mono">{l.name}</td><td class="mono">{l.min ?? "–"} … {l.max ?? "–"}</td></tr>{/each}</tbody></table>
          {/if}
          {#if hw.slide}
            <h4 class="label">{t("ui.slide_data")}</h4>
            <p class="small mono">NL {hw.slide.lengths.join(", ")} · {hw.slide.box}</p>
          {/if}
          <div class="row">
            <button onclick={() => editJson(hw)}>{sourceOf("hardware", hw.id) === "shop" ? t("ui.edit") : t("ui.edit_in_shop")}</button>
            {#if sourceOf("hardware", hw.id) === "shop"}
              <button class="quiet" onclick={() => { removeShop("hardware", hw.id); }}>{t("ui.remove")}</button>
            {/if}
          </div>
        {:else}
          <p class="muted">{t("ui.select_hardware")}</p>
        {/if}
      </div>
    </div>
  {:else}
    <div class="presets">
      <div class="save panel">
        <h4 class="label">{t("ui.from_selected_cabinet")}</h4>
        {#if store.cabinetDoc}
          <input type="text" aria-label={t("ui.name")} placeholder={store.cabinetDoc.name ?? store.cabinetDoc.id} bind:value={newName} />
          <div class="row">
            <button onclick={() => saveFromCabinet("template")}>{t("ui.save_as_template")}</button>
            <button onclick={() => saveFromCabinet("preset")}>{t("ui.save_as_preset")}</button>
          </div>
          <p class="muted small">{t("ui.template_preset_hint")}</p>
        {:else}
          <p class="muted">{t("ui.select_cabinet")}</p>
        {/if}
      </div>
      <h4 class="label">{t("ui.my_templates")}</h4>
      {#if !templates.length}<p class="muted small">{t("ui.no_templates")}</p>{/if}
      <ul class="plain">
        {#each templates as tp (tp.id)}
          <li><span>{name(tp.name)}</span> <span class="muted small">{t(`ui.kind.${tp.cabinet.kind}`)}</span> <button class="quiet" onclick={() => removeShop("templates", tp.id)}>{t("ui.remove")}</button></li>
        {/each}
      </ul>
      <h4 class="label">{t("ui.lib.presets")}</h4>
      <ul class="plain">
        {#each presets as p (p.id)}
          {@const src = sourceOf("presets", p.id)}
          <li>
            <span>{name(p.name)}</span>
            <span class="pill {src}">{t(`layer.${src}`)}</span>
            <span class="muted small mono">{Object.entries(p.vars).map(([k, v]) => `${k}=${v}`).join(" ")}</span>
            {#if src === "shop"}<button class="quiet" onclick={() => removeShop("presets", p.id)}>{t("ui.remove")}</button>{/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .lv { display: flex; flex-direction: column; min-height: 460px; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); align-items: center; }
  .bar [role="group"] { display: flex; flex-wrap: wrap; gap: 4px; }
  .sp { flex: 1; }
  .small { font-size: 12px; }
  .note { margin: 6px 10px 0; font-size: 12px; }
  td input[type="text"] { width: 100%; min-width: 8em; }
  td input.num { min-width: 4em; width: 5em; }
  .acts { text-align: right; }
  .foot { padding: 10px; }
  .hwbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; }
  .hw { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 1.4fr); gap: 10px; padding: 0 8px 10px; min-height: 0; }
  .hwlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 70vh; overflow-y: auto; }
  .item { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px; }
  .pills { display: flex; gap: 4px; }
  .nm { font-weight: 500; }
  .detail { min-width: 0; }
  .detail h3 { margin: 4px 0; font-size: 15px; }
  .detail h4 { margin: 12px 0 4px; }
  .detail :global(table.grid td) { white-space: normal; overflow-wrap: anywhere; }
  textarea { width: 100%; min-height: 50vh; font-size: 12px; background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
  .err { color: var(--err); white-space: pre-wrap; font-size: 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .presets { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .save { padding: 10px; display: flex; flex-direction: column; gap: 6px; max-width: 520px; }
  .plain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .plain li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  @media (max-width: 700px) { .hw { grid-template-columns: minmax(0, 1fr); } }
</style>
