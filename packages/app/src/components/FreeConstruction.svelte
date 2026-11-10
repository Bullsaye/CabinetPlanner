<script lang="ts">
  import { formatNumber, localName, OPTIONS, ROLE_CODES } from "@cabinet-planner/engine";
  import { parseInput, store } from "../lib/store.svelte.ts";

  /**
   * Free construction (D45): the cabinet's own parameters, free parts placed
   * by formulas, box parts to leave out, free bores and extra hardware.
   */
  type Doc = Record<string, any>;
  const t = $derived(store.tr.t);
  const c = $derived(store.cabinetDoc);
  const cab = $derived(store.cabinet);
  const lib = $derived(store.result?.library);
  const fmt = (x: number): string => formatNumber(x);

  function cons(): Doc {
    c!.construction ??= {};
    const k = c!.construction;
    k.parts ??= [];
    k.omit ??= [];
    k.bores ??= [];
    k.hardware ??= [];
    k.fittings ??= [];
    return k;
  }
  /** Writes a number, a formula, or removes the key when the field is empty. */
  function setVal(target: Doc, key: string, text: string): void {
    const v = parseInput(text);
    if (v === undefined) delete target[key];
    else target[key] = v;
  }
  const val = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value;

  // --- Parameters -------------------------------------------------------------
  const params = $derived((c?.params ?? []) as Doc[]);
  function addParam(): void {
    c!.params ??= [];
    const used = new Set(c!.params.map((p: Doc) => p.name));
    let n = 1;
    while (used.has(`p${n}`)) n++;
    c!.params.push({ name: `p${n}`, label: "", default: 100 });
  }
  function renameParam(p: Doc, text: string): void {
    const name = text.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name === p.name) return;
    // The cabinet's own value moves with the name.
    if (c!.vars?.[p.name] !== undefined) {
      c!.vars[name] = c!.vars[p.name];
      delete c!.vars[p.name];
    }
    p.name = name;
  }
  function setLimit(p: Doc, key: "min" | "max" | "step", text: string): void {
    const n = Number(text.trim().replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(n)) delete p[key];
    else p[key] = n;
  }

  // --- Free parts ---------------------------------------------------------------
  const PLANES = ["horizontal", "vertical", "frontal"] as const;
  const THICKNESS = { horizontal: "dy", vertical: "dx", frontal: "dz" } as const;
  const EDGES = {
    horizontal: ["front", "rear", "left", "right"],
    vertical: ["front", "rear", "top", "bottom"],
    frontal: ["top", "bottom", "left", "right"],
  } as const;
  const START: Record<(typeof PLANES)[number], Doc> = {
    horizontal: { x: "t_carcase", y: "H / 2", z: 0, dx: "W - 2 * t_carcase", dz: "D" },
    vertical: { x: "W / 2", y: "t_carcase", z: 0, dy: "H - 2 * t_carcase", dz: "D" },
    frontal: { x: "t_carcase", y: "t_carcase", z: 0, dx: "W - 2 * t_carcase", dy: 100 },
  };
  const reserved = new Set<string>(Object.values(ROLE_CODES));
  function addPart(plane: (typeof PLANES)[number]): void {
    const k = cons();
    const used = new Set(k.parts.map((p: Doc) => p.id));
    let n = 1;
    while (used.has(`F${n}`)) n++;
    k.parts.push({ id: `F${n}`, plane, ...START[plane], edges: {} });
  }
  function setCode(p: Doc, text: string): void {
    const id = text.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9]{0,5}$/.test(id) && !reserved.has(id.replace(/\d+$/, ""))) p.id = id;
  }
  function setEdge(p: Doc, side: string, v: string): void {
    p.edges ??= {};
    if (v === "") delete p.edges[side];
    else p.edges[side] = v;
  }
  /** Built parts of a free part (several with repeat). */
  const builtOf = (p: Doc) => (cab?.parts ?? []).filter((x) => x.role === "custom" && (x.code === p.id || (p.repeat !== undefined && x.code.startsWith(p.id) && /^\d+$/.test(x.code.slice(p.id.length)))));
  const materialKeys = OPTIONS.filter((o) => o.kind.type === "material").map((o) => o.key);
  const edgeKeys = OPTIONS.filter((o) => o.kind.type === "edgeband").map((o) => o.key);
  const materials = $derived([...(lib?.materials.values() ?? [])]);
  const edgebands = $derived([...(lib?.edgebands.values() ?? [])]);
  const hardware = $derived([...(lib?.hardware.values() ?? [])]);

  // --- Parts to leave out ---------------------------------------------------------
  const omitted = $derived((c?.construction?.omit ?? []) as string[]);
  const boxCodes = $derived([...(cab?.parts ?? []).filter((p) => p.role !== "custom").map((p) => p.code), ...omitted]);
  function toggleOmit(code: string): void {
    const k = cons();
    k.omit = k.omit.includes(code) ? k.omit.filter((x: string) => x !== code) : [...k.omit, code];
  }

  // --- Free bores -------------------------------------------------------------------
  const partCodes = $derived((cab?.parts ?? []).map((p) => p.code));
  /** Names of the two wide faces by where they face in the cabinet. */
  function faceLabel(ref: string | string[], face: string): string {
    const code = Array.isArray(ref) ? ref[0] : ref;
    const p = cab?.parts.find((x) => x.code === code);
    if (face !== "t0" && face !== "t1") return t(`ui.face.${face}`);
    const axis = p ? (["x", "y", "z"] as const).find((a) => a !== p.lengthAxis && a !== p.widthAxis)! : "x";
    return t(`ui.face.${axis}.${face}`);
  }
  function addBore(): void {
    cons().bores.push({ part: partCodes[0] ?? "SL", face: "inner", u: 100, v: 100, d: 5, depth: 13 });
  }
  /** "SL, SR" → one code or a list. */
  const partText = (ref: string | string[]): string => (Array.isArray(ref) ? ref.join(", ") : ref);
  function setParts(target: Doc, text: string): void {
    const list = text.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    if (list.length) target.part = list.length === 1 ? list[0] : list;
  }
  const firstPart = (ref: string | string[]): string => (Array.isArray(ref) ? (ref[0] ?? "") : ref);
  const placeable = $derived(hardware.filter((h) => h.drilling.some((d) => d.mount === "part")));
  function addFitting(): void {
    cons().fittings.push({ item: placeable[0]?.id ?? "", part: partCodes[0] ?? "SL", face: "inner", u: 100, v: 100 });
  }
</script>

{#if c}
  <section>
    <h3 class="label">{t("ui.params")}</h3>
    <p class="muted small">{t("ui.params_hint")}</p>
    {#each params as p, k}
      <div class="card">
        <div class="line">
          <label class="f w3"><span>{t("ui.param_label")}</span><input type="text" value={typeof p.label === "string" ? p.label : p.label ? localName(p.label, store.ui.lang) : ""} onchange={(e) => (p.label = val(e))} /></label>
          <label class="f w2"><span>{t("ui.param_name")}</span><input class="mono" type="text" value={p.name} onchange={(e) => renameParam(p, val(e))} /></label>
          <button class="quiet x" aria-label={t("ui.delete")} onclick={() => c!.params.splice(k, 1)}>×</button>
        </div>
        <div class="line">
          <label class="f w2"><span>{t("ui.param_default")}</span><input class="mono" type="text" value={p.default ?? ""} onchange={(e) => setVal(p, "default", val(e))} /></label>
          <label class="f"><span>{t("ui.min")}</span><input class="mono" type="text" value={p.min ?? ""} onchange={(e) => setLimit(p, "min", val(e))} /></label>
          <label class="f"><span>{t("ui.max")}</span><input class="mono" type="text" value={p.max ?? ""} onchange={(e) => setLimit(p, "max", val(e))} /></label>
          <label class="f"><span>{t("ui.unit")}</span>
            <select aria-label={t("ui.unit")} value={p.unit ?? "mm"} onchange={(e) => { p.unit = val(e); p.integer = val(e) === "count" ? true : undefined; }}>
              <option value="mm">mm</option>
              <option value="count">{t("ui.unit_count")}</option>
            </select>
          </label>
        </div>
        <label class="f"><span>{t("ui.description")}</span><input type="text" value={typeof p.description === "string" ? p.description : p.description ? localName(p.description, store.ui.lang) : ""} onchange={(e) => { if (val(e).trim()) p.description = val(e).trim(); else delete p.description; }} /></label>
      </div>
    {/each}
    <button onclick={addParam}>{t("ui.add_param")}</button>
  </section>

  <section>
    <h3 class="label">{t("ui.free_parts")}</h3>
    <p class="muted small">{t("ui.free_parts_hint")}</p>
    {#each c.construction?.parts ?? [] as p, k}
      {@const built = builtOf(p)}
      <div class="card" role="group" aria-label={`${t("ui.free_part")} ${p.id}`} onfocusin={() => (store.ui.part = built[0]?.id ?? null)}>
        <div class="line">
          <label class="f"><span>{t("ui.code")}</span><input class="mono" type="text" value={p.id} onchange={(e) => setCode(p, val(e))} /></label>
          <label class="f w3"><span>{t("ui.name")}</span><input type="text" value={typeof p.name === "string" ? p.name : p.name ? localName(p.name, store.ui.lang) : ""} onchange={(e) => { if (val(e).trim()) p.name = val(e).trim(); else delete p.name; }} /></label>
          <button class="quiet x" title={t("ui.duplicate")} aria-label={t("ui.duplicate")} onclick={() => { const copy = JSON.parse(JSON.stringify(p)); const used = new Set(cons().parts.map((q: Doc) => q.id)); let n = 1; while (used.has(`F${n}`)) n++; copy.id = `F${n}`; cons().parts.splice(k + 1, 0, copy); }}>⧉</button>
          <button class="quiet x" aria-label={t("ui.delete")} onclick={() => cons().parts.splice(k, 1)}>×</button>
        </div>
        <div class="line">
          <label class="f w2"><span>{t("ui.plane")}</span>
            <select value={p.plane} onchange={(e) => (p.plane = val(e))}>
              {#each PLANES as pl}<option value={pl}>{t(`ui.plane.${pl}`)}</option>{/each}
            </select>
          </label>
          <label class="f w2"><span>{t("ui.material")}</span>
            <select value={p.material ?? "material.carcase"} onchange={(e) => (p.material = val(e))}>
              <optgroup label={t("ui.material_of_cabinet")}>
                {#each materialKeys as key}<option value={key}>{t(`option.${key}`)}</option>{/each}
              </optgroup>
              <optgroup label={t("ui.material_fixed")}>
                {#each materials as m}<option value={m.id}>{localName(m.name, store.ui.lang)}</option>{/each}
              </optgroup>
            </select>
          </label>
        </div>
        <div class="line three">
          {#each ["x", "y", "z"] as ax}
            <label class="f"><span>{t(`ui.pos.${ax}`)}</span><input class="mono" type="text" value={p[ax] ?? ""} placeholder="0" onchange={(e) => setVal(p, ax, val(e))} /></label>
          {/each}
        </div>
        <div class="line three">
          {#each ["dx", "dy", "dz"] as d}
            <label class="f"><span>{t(`ui.size.${d}`)}</span><input class="mono" type="text" value={p[d] ?? ""} placeholder={THICKNESS[p.plane as "horizontal"] === d ? t("ui.thickness_auto") : ""} onchange={(e) => setVal(p, d, val(e))} /></label>
          {/each}
        </div>
        <div class="line">
          {#each EDGES[p.plane as "horizontal"] as side}
            <label class="f"><span>{t("ui.edge_at", { side: t(`ui.side.${side}`) })}</span>
              <select value={p.edges?.[side] ?? ""} onchange={(e) => setEdge(p, side, val(e))}>
                <option value="">–</option>
                {#each edgeKeys as key}<option value={key}>{t(`option.${key}`)}</option>{/each}
                {#each edgebands as b}<option value={b.id}>{b.code}</option>{/each}
              </select>
            </label>
          {/each}
        </div>
        <div class="line">
          <label class="f"><span>{t("ui.repeat")}</span><input class="mono" type="text" value={p.repeat ?? ""} placeholder="1" onchange={(e) => setVal(p, "repeat", val(e))} /></label>
          <label class="f w2"><span>{t("ui.when")}</span><input class="mono" type="text" value={p.when ?? ""} placeholder={t("ui.always")} onchange={(e) => setVal(p, "when", val(e))} /></label>
          <label class="check"><input type="checkbox" checked={(p.joint ?? "auto") === "auto"} onchange={(e) => (p.joint = (e.target as HTMLInputElement).checked ? "auto" : "none")} /> {t("ui.join_auto")}</label>
        </div>
        <p class="muted small mono">
          {#if built.length}{built.length > 1 ? `${built.length} × ` : ""}{fmt(built[0]!.length)} × {fmt(built[0]!.width)} × {fmt(built[0]!.thickness)}{:else}{t("ui.not_built")}{/if}
        </p>
      </div>
    {/each}
    <div class="row">
      {#each PLANES as pl}<button onclick={() => addPart(pl)}>+ {t(`ui.plane.${pl}`)}</button>{/each}
    </div>
    <p class="muted small">{t("ui.free_parts_vars")}</p>
  </section>

  <section>
    <h3 class="label">{t("ui.omit_parts")}</h3>
    <p class="muted small">{t("ui.omit_hint")}</p>
    <div class="row">
      {#each [...new Set(boxCodes)] as code}
        <button class="chip mono" aria-pressed={!omitted.includes(code)} title={omitted.includes(code) ? t("ui.omitted") : t("ui.built")} onclick={() => toggleOmit(code)}>{code}</button>
      {/each}
    </div>
  </section>

  <section>
    <h3 class="label">{t("ui.free_bores")}</h3>
    <p class="muted small">{t("ui.free_bores_hint")}</p>
    {#each c.construction?.bores ?? [] as b, k}
      <div class="card" role="group" aria-label={`${t("ui.free_bore")} ${k + 1}`} onfocusin={() => (store.ui.part = cab?.parts.find((x) => x.code === firstPart(b.part))?.id ?? null)}>
        <div class="line">
          <label class="f w2"><span>{t("ui.parts")}</span><input class="mono" type="text" list="fc-parts" value={partText(b.part)} onchange={(e) => setParts(b, val(e))} /></label>
          <label class="f w3"><span>{t("ui.face")}</span>
            <select value={b.face ?? "inner"} onchange={(e) => (b.face = val(e))}>
              {#each ["inner", "outer", "t0", "t1", "l1", "l2", "w1", "w2"] as f}<option value={f}>{faceLabel(b.part, f)}</option>{/each}
            </select>
          </label>
          <button class="quiet x" aria-label={t("ui.delete")} onclick={() => cons().bores.splice(k, 1)}>×</button>
        </div>
        <div class="line">
          <label class="f"><span>{t("ui.bore_u")}</span><input class="mono" type="text" value={b.u} onchange={(e) => setVal(b, "u", val(e) || "0")} /></label>
          <label class="f"><span>{t("ui.bore_v")}</span><input class="mono" type="text" value={b.v} onchange={(e) => setVal(b, "v", val(e) || "0")} /></label>
          <label class="f"><span>Ø</span><input class="mono" type="text" value={b.d} onchange={(e) => setVal(b, "d", val(e) || "5")} /></label>
          <label class="f"><span>{t("ui.depth")}</span><input class="mono" type="text" value={b.depth} placeholder={t("ui.through")} onchange={(e) => setVal(b, "depth", val(e) || "0")} /></label>
          <label class="f"><span>{t("ui.repeat")}</span><input class="mono" type="text" value={b.repeat ?? ""} placeholder="1" onchange={(e) => setVal(b, "repeat", val(e))} /></label>
        </div>
      </div>
    {/each}
    <button onclick={addBore}>{t("ui.add_bore")}</button>
  </section>

  <datalist id="fc-parts">
    <option value="SL, SR"></option>
    {#each partCodes as code}<option value={code}></option>{/each}
  </datalist>

  <section>
    <h3 class="label">{t("ui.fittings_placed")}</h3>
    <p class="muted small">{t("ui.fittings_placed_hint")}</p>
    {#each c.construction?.fittings ?? [] as f, k}
      <div class="card" role="group" aria-label={`${t("ui.fitting")} ${k + 1}`} onfocusin={() => (store.ui.part = cab?.parts.find((x) => x.code === firstPart(f.part))?.id ?? null)}>
        <div class="line">
          <label class="f w3"><span>{t("ui.fitting")}</span>
            <select value={f.item} onchange={(e) => (f.item = val(e))}>
              {#each [...new Set([f.item, ...placeable.map((h) => h.id)])] as id}
                <option value={id}>{lib?.hardware.get(id) ? localName(lib.hardware.get(id)!.name, store.ui.lang) : id}</option>
              {/each}
            </select>
          </label>
          <button class="quiet x" aria-label={t("ui.delete")} onclick={() => cons().fittings.splice(k, 1)}>×</button>
        </div>
        <div class="line">
          <label class="f w2"><span>{t("ui.parts")}</span><input class="mono" type="text" list="fc-parts" value={partText(f.part)} onchange={(e) => setParts(f, val(e))} /></label>
          <label class="f w2"><span>{t("ui.face")}</span>
            <select value={f.face ?? "inner"} onchange={(e) => (f.face = val(e))}>
              {#each ["inner", "outer", "t0", "t1"] as fc}<option value={fc}>{faceLabel(f.part, fc)}</option>{/each}
            </select>
          </label>
        </div>
        <div class="line">
          <label class="f"><span>{t("ui.bore_u")}</span><input class="mono" type="text" value={f.u} onchange={(e) => setVal(f, "u", val(e) || "0")} /></label>
          <label class="f"><span>{t("ui.bore_v")}</span><input class="mono" type="text" value={f.v} onchange={(e) => setVal(f, "v", val(e) || "0")} /></label>
          <label class="f"><span>{t("ui.repeat")}</span><input class="mono" type="text" value={f.repeat ?? ""} placeholder="1" onchange={(e) => setVal(f, "repeat", val(e))} /></label>
          <label class="check" title={t("ui.mirror_hint")}><input type="checkbox" checked={!!f.mirror} onchange={(e) => { if ((e.target as HTMLInputElement).checked) f.mirror = true; else delete f.mirror; }} /> {t("ui.mirror")}</label>
        </div>
      </div>
    {/each}
    <button onclick={addFitting} disabled={!placeable.length}>{t("ui.add_fitting")}</button>
    {#if !placeable.length}<p class="muted small">{t("ui.no_placeable")}</p>{/if}
  </section>

  <section>
    <h3 class="label">{t("ui.extra_hardware")}</h3>
    {#each c.construction?.hardware ?? [] as h, k}
      <div class="line">
        <label class="f w3"><span class="sr">{t("ui.item")}</span>
          <select value={h.item} onchange={(e) => (h.item = val(e))}>
            {#each hardware as it}<option value={it.id}>{localName(it.name, store.ui.lang)}</option>{/each}
          </select>
        </label>
        <label class="f"><span class="sr">{t("ui.qty")}</span><input class="mono" type="text" value={h.qty ?? 1} aria-label={t("ui.qty")} onchange={(e) => setVal(h, "qty", val(e) || "1")} /></label>
        <button class="quiet x" aria-label={t("ui.delete")} onclick={() => cons().hardware.splice(k, 1)}>×</button>
      </div>
    {/each}
    <button onclick={() => cons().hardware.push({ item: hardware[0]?.id ?? "", qty: 1 })} disabled={!hardware.length}>{t("ui.add_hardware")}</button>
  </section>
{/if}

<style>
  section { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line); padding-top: 8px; }
  h3 { margin: 0 0 2px; }
  .small { font-size: 12px; margin: 0; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: var(--surface); }
  .card:focus-within { border-color: var(--accent); }
  .line { display: flex; gap: 6px; align-items: end; }
  .line.three .f { flex: 1; }
  .f { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; font-size: 11px; color: var(--muted); }
  .f.w2 { flex: 2; }
  .f.w3 { flex: 3; }
  .f span { overflow-wrap: anywhere; line-height: 1.25; }
  .f input, .f select { width: 100%; min-width: 0; font-size: 13px; }
  .check { display: flex; align-items: center; gap: 4px; font-size: 12px; white-space: nowrap; padding-bottom: 4px; }
  .x { padding: 2px 6px; flex: none; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { padding: 2px 8px; font-size: 12px; }
  .chip[aria-pressed="false"] { text-decoration: line-through; color: var(--muted); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
