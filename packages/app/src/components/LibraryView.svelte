<script lang="ts">
  import {
    FACTORY_EDGEBANDS,
    FACTORY_HARDWARE,
    FACTORY_MATERIALS,
    FACTORY_PRESETS,
    HardwareItem,
    localName,
    OPTIONS,
    VARIABLES,
    VARIABLE_BY_NAME,
    type HardwareItem as HardwareItemT,
  } from "@cabinet-planner/engine";
  import { openFile } from "../lib/platform.ts";
  import { parseInput, store, templateBody } from "../lib/store.svelte.ts";
  import { optionChoices, optionDef } from "../lib/fields.ts";

  type Section = "materials" | "edgebands" | "surfaces" | "hardware" | "presets";
  type Doc = Record<string, any>;

  const t = $derived(store.tr.t);
  let section = $state<Section>("materials");
  let note = $state("");

  /** The shop library (the file the user edits here), created on demand. */
  function lib(): Doc {
    store.shop.library ??= {};
    const l = store.shop.library;
    for (const k of ["materials", "edgebands", "surfaces", "hardware", "presets", "templates"]) l[k] ??= [];
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
    // Shared items meet other people's libraries: a random suffix instead of a counter keeps ids from clashing.
    for (;;) {
      const id = `${base}-${Math.random().toString(36).slice(2, 8)}`;
      if (!used.has(id)) return id;
    }
  }
  function setNum(item: Doc, key: string, text: string, min = 0): void {
    const v = parseInput(text);
    if (typeof v === "number" && v >= min) item[key] = v;
    else if (text.trim() === "" && (key === "pricePerM2" || key === "pricePerM" || key === "price")) delete item[key];
  }

  // --- Materials and edgebands -------------------------------------------------
  const materials = $derived([...(store.result?.library.materials.values() ?? FACTORY_MATERIALS)]);
  const edgebands = $derived([...(store.result?.library.edgebands.values() ?? FACTORY_EDGEBANDS)]);
  const usedMaterials = $derived(new Set(store.result?.parts.map((p) => p.material) ?? []));

  function addMaterial(): void {
    const id = uniqueId("materials", "material");
    lib().materials.push({ id, name: t("ui.new_material"), thickness: 19, grain: false });
  }
  const surfaces = $derived([...(store.result?.library.surfaces.values() ?? [])]);
  const SURFACE_KINDS = ["melamine", "hpl", "lacquer", "veneer", "oil", "other"] as const;
  function addSurface(): void {
    lib().surfaces.push({ id: uniqueId("surfaces", "surface"), name: t("ui.new_surface"), kind: "lacquer", ref: "RAL ", color: "#d9d9d9" });
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
  // A link from a part's hardware (part panel, D59) opens the item here.
  $effect(() => {
    const it = store.ui.libraryItem;
    if (!it) return;
    store.ui.libraryItem = null;
    if (it.section !== "hardware") return;
    section = "hardware";
    cat = "";
    query = "";
    selectedHw = it.id;
    json = "";
  });
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
  /** A new fitting of the shop: its drilling is placed on a part in the construction editor (D45). */
  function addHardware(): void {
    const id = uniqueId("hardware", "fitting");
    lib().hardware.push({
      schemaVersion: 1,
      id,
      name: t("ui.new_fitting"),
      category: "other",
      articles: [],
      trust: "untested",
      params: {},
      drilling: [{ mount: "part", d: 5, depth: 12, a: 0, b: 0 }],
      bom: { perPlacement: 1, unit: "pcs" },
    });
    cat = "";
    query = "";
    selectedHw = id;
    json = "";
  }
  const ownHw = $derived(selectedHw ? shopItem("hardware", selectedHw) : undefined);
  function setExpr(target: Doc, key: string, text: string, fallback: number | string = 0): void {
    target[key] = parseInput(text) ?? fallback;
  }
  let newParam = $state("");
  function addItemParam(item: Doc): void {
    const n = newParam.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return;
    item.params ??= {};
    item.params[n] ??= 0;
    newParam = "";
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

  /** Applies a preset to the selected cabinet (after the ones it has, so it wins over them). */
  function applyToCabinet(id: string): void {
    const c = store.cabinetDoc;
    if (!c) return;
    if (!(c.presets ?? []).includes(id)) c.presets = [...(c.presets ?? []), id];
    note = t("ui.preset_applied", { name: store.presetName(id), cabinet: c.name || c.id });
  }
  /** Cabinets and layers that use a preset: removing it would leave them with an error. */
  function presetUsers(id: string): string[] {
    const users = (store.project.cabinets ?? []).filter((c: Doc) => (c.presets ?? []).includes(id)).map((c: Doc) => c.id as string);
    if ((store.project.presets ?? []).includes(id)) users.push(t("ui.layer.project"));
    if ((store.shop.defaults?.presets ?? []).includes(id)) users.push(t("ui.layer.shop"));
    return users;
  }
  function removePreset(id: string): void {
    // Take it off everything that uses it in this project and the shop defaults.
    for (const c of store.project.cabinets ?? []) if (c.presets) c.presets = c.presets.filter((p: string) => p !== id);
    if (store.project.presets) store.project.presets = store.project.presets.filter((p: string) => p !== id);
    if (store.shop.defaults?.presets) store.shop.defaults.presets = store.shop.defaults.presets.filter((p: string) => p !== id);
    removeShop("presets", id);
  }
  function setPresetVar(p: Doc, key: string, text: string): void {
    const v = parseInput(text);
    if (v === undefined) delete p.vars[key];
    else p.vars[key] = v;
  }
  let addVarName = $state("");
  function addPresetVar(p: Doc, pick?: string): void {
    const n = (pick ?? addVarName).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return;
    p.vars ??= {};
    if (p.vars[n] === undefined) p.vars[n] = store.cabinet?.resolved.values.get(n) ?? VARIABLE_BY_NAME.get(n)?.factory ?? 0;
    addVarName = "";
  }
  function addPresetOption(p: Doc, key: string): void {
    const o = optionDef(key);
    if (!o) return;
    p.options ??= {};
    if (p.options[key] === undefined) p.options[key] = store.cabinet?.resolved.options.get(key)?.value ?? o.factory;
  }
  function newPreset(): void {
    const id = uniqueId("presets", "preset");
    lib().presets.push({ id, name: newName.trim() || t("ui.new_preset"), group: "shop", vars: {}, options: {}, params: [] });
    newName = "";
    openPreset = id;
  }
  let openPreset = $state<string | null>(null);
  /** Display texts of a preset's variable (D45): kept as a parameter of the preset. */
  const paramOf = (p: Doc, k: string): Doc | undefined => (p.params ?? []).find((x: Doc) => x.name === k);
  function setParamText(p: Doc, k: string, field: "label" | "description", text: string): void {
    p.params ??= [];
    let entry = paramOf(p, k);
    if (!entry) p.params.push((entry = { name: k }));
    entry = paramOf(p, k)!;
    if (text.trim()) entry[field] = text.trim();
    else delete entry[field];
    if (Object.keys(entry).length === 1) p.params = p.params.filter((x: Doc) => x.name !== k);
  }
  const text = (x: unknown): string => (x === undefined ? "" : localName(x as never, store.tr.locale));

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
      // The whole cabinet: fronts, construction with free parts, parameters, part overrides (D40, D45).
      lib().templates.push({ id: uniqueId("templates", "template"), name: label, group: "shop", cabinet: templateBody(c) });
    }
    newName = "";
    note = t(kind === "preset" ? "ui.preset_saved" : "ui.template_saved", { name: label });
  }
</script>

<section class="panel lv">
  <div class="bar">
    <div role="group" aria-label={t("ui.library")}>
      {#each ["materials", "edgebands", "surfaces", "hardware", "presets"] as s}
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
        <thead><tr><th>{t("ui.id")}</th><th>{t("ui.name")}</th><th>{t("ui.code")}</th><th>{t("ui.thickness")}</th><th>{t("ui.width")}</th><th>{t("ui.price_m")}</th><th></th><th></th></tr></thead>
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
                <td><input class="mono num" type="text" inputmode="decimal" aria-label={t("ui.price_m")} value={own.pricePerM ?? ""} onchange={(e) => setNum(own, "pricePerM", (e.target as HTMLInputElement).value)} /></td>
              {:else}
                <td>{name(b.name)}</td>
                <td class="mono">{b.code}</td>
                <td class="n">{b.thickness}</td>
                <td class="n">{b.width}</td>
                <td class="n">{b.pricePerM ?? ""}</td>
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
  {:else if section === "surfaces"}
    <p class="muted small pad">{t("ui.surfaces_hint")}</p>
    <div class="scroll-x">
      <table class="grid">
        <thead><tr><th>{t("ui.colour")}</th><th>{t("ui.name")}</th><th>{t("ui.surface_kind")}</th><th>{t("ui.surface_ref")}</th><th></th><th></th></tr></thead>
        <tbody>
          {#each surfaces as sf (sf.id)}
            {@const src = sourceOf("surfaces", sf.id)}
            {@const own = src === "shop" ? shopItem("surfaces", sf.id) : undefined}
            <tr>
              {#if own}
                <td><input type="color" aria-label={t("ui.colour")} value={own.color ?? "#d9d9d9"} onchange={(e) => (own.color = (e.target as HTMLInputElement).value)} /></td>
                <td><input type="text" aria-label={t("ui.name")} value={name(own.name)} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) own.name = v; }} /></td>
                <td>
                  <select aria-label={t("ui.surface_kind")} value={own.kind ?? "other"} onchange={(e) => (own.kind = (e.target as HTMLSelectElement).value)}>
                    {#each SURFACE_KINDS as k}<option value={k}>{t(`ui.surface.${k}`)}</option>{/each}
                  </select>
                </td>
                <td><input class="mono" type="text" aria-label={t("ui.surface_ref")} value={own.ref ?? ""} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) own.ref = v; else delete own.ref; }} /></td>
              {:else}
                <td><span class="swatch" style={`background:${sf.color ?? "transparent"}`}></span></td>
                <td>{name(sf.name)}</td>
                <td>{t(`ui.surface.${sf.kind}`)}</td>
                <td class="mono">{sf.ref ?? ""}</td>
              {/if}
              <td><span class="pill {src}">{t(`layer.${src}`)}</span></td>
              <td class="acts">
                {#if src === "factory"}<button class="quiet" onclick={() => toShop("surfaces", sf)}>{t("ui.edit_in_shop")}</button>{/if}
                {#if src === "shop"}<button class="quiet" onclick={() => removeShop("surfaces", sf.id)}>{t("ui.remove")}</button>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="foot"><button onclick={addSurface}>{t("ui.add_surface")}</button></div>
  {:else if section === "hardware"}
    <div class="hwbar">
      <select id="hw-cat" aria-label={t("ui.category")} bind:value={cat}>
        <option value="">{t("ui.all_categories")}</option>
        {#each CATS as c}<option value={c}>{t(`ui.cat.${c}`)}</option>{/each}
      </select>
      <input id="hw-search" type="text" placeholder={t("ui.search_hardware")} aria-label={t("ui.search_hardware")} bind:value={query} />
      <button onclick={addHardware}>{t("ui.new_fitting_btn")}</button>
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
        {:else if hw && ownHw}
          <div class="hwform">
            <label class="f w2"><span>{t("ui.name")}</span><input type="text" value={name(ownHw.name)} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) ownHw.name = v; }} /></label>
            <label class="f"><span>{t("ui.category")}</span>
              <select value={ownHw.category} onchange={(e) => (ownHw.category = (e.target as HTMLSelectElement).value)}>
                {#each CATS as c}<option value={c}>{t(`ui.cat.${c}`)}</option>{/each}
              </select>
            </label>
            <label class="f"><span>{t("ui.manufacturer")}</span><input type="text" value={ownHw.manufacturer ?? ""} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) ownHw.manufacturer = v; else delete ownHw.manufacturer; }} /></label>
            <label class="f"><span>{t("ui.article")}</span><input class="mono" type="text" value={ownHw.articles?.[0]?.code ?? ""} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); ownHw.articles = v ? [{ code: v }, ...(ownHw.articles ?? []).slice(1)] : (ownHw.articles ?? []).slice(1); }} /></label>
            <label class="f"><span>{t("ui.price_each")}</span><input class="mono" type="text" inputmode="decimal" value={ownHw.bom?.price ?? ""} onchange={(e) => { ownHw.bom ??= { perPlacement: 1, unit: "pcs" }; setNum(ownHw.bom, "price", (e.target as HTMLInputElement).value); }} /></label>
            <label class="f"><span>{t("ui.trust")}</span>
              <select value={ownHw.trust ?? "untested"} onchange={(e) => (ownHw.trust = (e.target as HTMLSelectElement).value)}>
                <option value="untested">{t("ui.trust.untested")}</option>
                <option value="tested">{t("ui.trust.tested")}</option>
              </select>
            </label>
          </div>
          <p class="muted small mono">{hw.id}</p>

          <h4 class="label">{t("ui.parameters")}</h4>
          <p class="muted small">{t("ui.item_params_hint")}</p>
          <div class="kv">
            {#each Object.entries(ownHw.params ?? {}) as [k, v] (k)}
              <label class="pv"><span class="mono">{k}</span>
                <input class="mono" type="text" value={String(v)} onchange={(e) => setExpr(ownHw.params, k, (e.target as HTMLInputElement).value)} />
                <button class="quiet" aria-label={`${t("ui.remove")} ${k}`} onclick={() => delete ownHw.params[k]}>×</button>
              </label>
            {/each}
            <div class="pv add">
              <input class="mono" type="text" placeholder={t("ui.variable_name")} aria-label={t("ui.variable_name")} bind:value={newParam} />
              <button onclick={() => addItemParam(ownHw)}>{t("ui.add_value")}</button>
            </div>
          </div>

          <h4 class="label">{t("ui.drilling")}</h4>
          <p class="muted small">{t(ownHw.category === "other" ? "ui.drilling_hint_part" : "ui.drilling_hint_category")}</p>
          <div class="scroll-x">
            <table class="grid drill">
              <thead><tr><th>{t("ui.mount")}</th><th>Ø</th><th>{t("ui.depth")}</th><th>{t("ui.through")}</th><th>a</th><th>b</th><th></th></tr></thead>
              <tbody>
                {#each ownHw.drilling ?? [] as d, k}
                  <tr>
                    <td><input class="mono" type="text" aria-label={t("ui.mount")} value={d.mount} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) d.mount = v; }} /></td>
                    <td><input class="mono num" type="text" aria-label="Ø" value={d.d} onchange={(e) => setExpr(d, "d", (e.target as HTMLInputElement).value, 5)} /></td>
                    <td><input class="mono num" type="text" aria-label={t("ui.depth")} value={d.depth} disabled={!!d.through} onchange={(e) => setExpr(d, "depth", (e.target as HTMLInputElement).value, 0)} /></td>
                    <td><input type="checkbox" aria-label={t("ui.through")} checked={!!d.through} onchange={(e) => { if ((e.target as HTMLInputElement).checked) d.through = true; else delete d.through; }} /></td>
                    <td><input class="mono num" type="text" aria-label="a" value={d.a} onchange={(e) => setExpr(d, "a", (e.target as HTMLInputElement).value)} /></td>
                    <td><input class="mono num" type="text" aria-label="b" value={d.b} onchange={(e) => setExpr(d, "b", (e.target as HTMLInputElement).value)} /></td>
                    <td><button class="quiet" aria-label={t("ui.delete")} onclick={() => ownHw.drilling.splice(k, 1)}>×</button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="row">
            <button onclick={() => { ownHw.drilling ??= []; ownHw.drilling.push({ mount: ownHw.category === "other" ? "part" : (ownHw.drilling[0]?.mount ?? "part"), d: 5, depth: 12, a: 0, b: 0 }); }}>{t("ui.add_bore")}</button>
            <button class="quiet" onclick={() => editJson(hw)}>{t("ui.edit_json")}</button>
            <button class="quiet" onclick={() => { removeShop("hardware", hw.id); }}>{t("ui.remove")}</button>
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
            <button onclick={newPreset}>{t("ui.new_preset_btn")}</button>
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
          <li><input class="pname" type="text" aria-label={t("ui.name")} value={name(tp.name)} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); const own = shopItem("templates", tp.id); if (v && own) own.name = v; }} /> <span class="muted small">{t(`ui.kind.${tp.cabinet.kind}`)}</span> <button class="quiet" onclick={() => removeShop("templates", tp.id)}>{t("ui.remove")}</button></li>
        {/each}
      </ul>
      <h4 class="label">{t("ui.presets")}</h4>
      <p class="muted small">{t("ui.presets_hint")}</p>
      <ul class="plain">
        {#each presets as p (p.id)}
          {@const src = sourceOf("presets", p.id)}
          {@const own = src === "shop" ? shopItem("presets", p.id) : undefined}
          <li class="preset">
            <div class="phead">
              {#if own}
                <input class="pname" type="text" aria-label={t("ui.name")} value={name(own.name)} onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v) own.name = v; }} />
              {:else}
                <span>{name(p.name)}</span>
              {/if}
              <span class="pill {src}">{t(`layer.${src}`)}</span>
              {#if store.cabinetDoc}
                <button class="quiet" disabled={(store.cabinetDoc.presets ?? []).includes(p.id)} onclick={() => applyToCabinet(p.id)}>{t("ui.apply_to", { cabinet: store.cabinetDoc.id })}</button>
              {/if}
              {#if own}
                {@const users = presetUsers(p.id)}
                <button class="quiet" title={users.length ? t("ui.preset_in_use", { users: users.join(", ") }) : ""} onclick={() => removePreset(p.id)}>{t("ui.remove")}</button>
              {/if}
            </div>
            {#if own}
              <details open={openPreset === p.id}>
                <summary class="small">{t("ui.preset_values", { n: String(Object.keys(own.vars ?? {}).length + Object.keys(own.options ?? {}).length) })}</summary>
                <div class="pvals">
                  {#each Object.entries(own.vars ?? {}) as [k, v] (k)}
                    {@const known = store.tr.has(`var.${k}`)}
                    <div class="pvar">
                      <label class="pv"><span class={known ? "" : "mono"} title={k}>{known ? t(`var.${k}`) : k}</span>
                        <input class="mono" type="text" aria-label={k} value={String(v)} onchange={(e) => setPresetVar(own, k, (e.target as HTMLInputElement).value)} />
                        <button class="quiet" aria-label={`${t("ui.remove")} ${k}`} onclick={() => { delete own.vars[k]; if (own.params) own.params = own.params.filter((x: Doc) => x.name !== k); }}>×</button>
                      </label>
                      <div class="ptexts">
                        <input type="text" placeholder={t("ui.display_name")} aria-label={`${k}: ${t("ui.display_name")}`} value={text(paramOf(own, k)?.label)} onchange={(e) => setParamText(own, k, "label", (e.target as HTMLInputElement).value)} />
                        <input type="text" placeholder={t("ui.description")} aria-label={`${k}: ${t("ui.description")}`} value={text(paramOf(own, k)?.description)} onchange={(e) => setParamText(own, k, "description", (e.target as HTMLInputElement).value)} />
                      </div>
                    </div>
                  {/each}
                  {#each Object.entries(own.options ?? {}) as [k, v] (k)}
                    {@const o = optionDef(k)}
                    <label class="pv"><span title={k}>{store.tr.has(`option.${k}`) ? t(`option.${k}`) : k}</span>
                      {#if o}
                        <select value={JSON.stringify(v)} onchange={(e) => (own.options[k] = JSON.parse((e.target as HTMLSelectElement).value))}>
                          {#each optionChoices(o) as ch}<option value={ch.value}>{ch.label}</option>{/each}
                        </select>
                      {:else}
                        <span class="mono">{String(v)}</span>
                      {/if}
                      <button class="quiet" aria-label={`${t("ui.remove")} ${k}`} onclick={() => delete own.options[k]}>×</button>
                    </label>
                  {/each}
                </div>
                <div class="padd">
                  <select aria-label={t("ui.add_variable")} onchange={(e) => { const el = e.target as HTMLSelectElement; if (el.value) addPresetVar(own, el.value); el.value = ""; }}>
                    <option value="">+ {t("ui.add_variable")}</option>
                    {#each VARIABLES.filter((v) => own.vars?.[v.name] === undefined) as v}<option value={v.name}>{t(`var.${v.name}`)} ({v.name})</option>{/each}
                  </select>
                  <select aria-label={t("ui.add_option")} onchange={(e) => { const el = e.target as HTMLSelectElement; if (el.value) addPresetOption(own, el.value); el.value = ""; }}>
                    <option value="">+ {t("ui.add_option")}</option>
                    {#each OPTIONS.filter((o) => own.options?.[o.key] === undefined) as o}<option value={o.key}>{t(`option.${o.key}`)}</option>{/each}
                  </select>
                  <span class="own">
                    <input class="mono" type="text" placeholder={t("ui.own_variable")} aria-label={t("ui.own_variable")} bind:value={addVarName} />
                    <button onclick={() => addPresetVar(own)}>{t("ui.add_value")}</button>
                  </span>
                </div>
                <p class="muted small">{t("ui.preset_var_hint")}</p>
              </details>
            {:else}
              <span class="muted small">{[...Object.entries(p.vars).map(([k, v]) => `${store.tr.has(`var.${k}`) ? t(`var.${k}`) : k}: ${v}`), ...Object.entries(p.options ?? {}).map(([k, v]) => `${store.tr.has(`option.${k}`) ? t(`option.${k}`) : k}: ${store.tr.has(`option.${k}.${v}`) ? t(`option.${k}.${v}`) : v}`)].join(" · ")}</span>
            {/if}
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
  .swatch { display: inline-block; width: 28px; height: 18px; border: 1px solid var(--line); border-radius: 4px; vertical-align: middle; }
  .pad { padding: 8px 10px 0; margin: 0; }
  .hwform { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px 10px; }
  .f { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--muted); min-width: 0; }
  .f.w2 { grid-column: span 2; }
  .f input, .f select { width: 100%; min-width: 0; font-size: 13px; }
  .kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px 16px; }
  .drill input[type="text"] { width: 100%; min-width: 4.5em; }
  .presets { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .plain li.preset { flex-direction: column; flex-wrap: nowrap; gap: 4px; align-items: stretch; }
  .phead { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .pname { font-weight: 500; min-width: 10em; }
  .pvals { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 4px 16px; padding: 6px 0; }
  .pv { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; align-items: center; font-size: 12px; }
  .pv span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pv input, .pv select { min-width: 0; width: 100%; }
  .pv.add { grid-template-columns: minmax(0, 1fr) auto; }
  .pvar { display: flex; flex-direction: column; gap: 2px; padding-bottom: 4px; }
  .ptexts { display: grid; grid-template-columns: 1fr 1.6fr; gap: 4px; }
  .ptexts input { font-size: 12px; min-width: 0; }
  .padd { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .padd select { max-width: 16em; font-size: 12px; }
  .padd .own { display: inline-flex; gap: 4px; }
  .padd .own input { width: 11em; font-size: 12px; }
  .save { padding: 10px; display: flex; flex-direction: column; gap: 6px; max-width: 520px; }
  .plain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .plain li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  @media (max-width: 700px) { .hw { grid-template-columns: minmax(0, 1fr); } }
</style>
