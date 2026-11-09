<script lang="ts">
  import { copy, download, downloadNote, store } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  let open = $state(false);
  let note = $state("");
  let input: HTMLInputElement;

  const fileName = (s: string): string => (s || "project").replace(/[^\w.-]+/g, "-").toLowerCase();

  async function onFile(e: Event): Promise<void> {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (doc.kind === "shop") store.shop = doc;
      else store.project = doc;
      store.ui.selected = store.project.cabinets?.[0]?.id ?? null;
      note = t("ui.loaded", { file: f.name });
    } catch (err) {
      note = t("ui.load_failed", { file: f.name, error: String((err as Error).message) });
    }
    input.value = "";
  }
  async function save(kind: "project" | "shop"): Promise<void> {
    const doc = $state.snapshot(kind === "project" ? store.project : store.shop);
    const name = kind === "project" ? `${fileName(store.project.name)}.project.json` : "shop.json";
    note = downloadNote(await download(name, JSON.stringify(doc, null, 2) + "\n", "application/json"), name, t);
  }
  async function copyDoc(kind: "project" | "shop"): Promise<void> {
    const doc = $state.snapshot(kind === "project" ? store.project : store.shop);
    note = (await copy(JSON.stringify(doc, null, 2))) ? t("ui.copied") : t("ui.copy_failed");
  }
</script>

<div class="menu">
  <button aria-expanded={open} onclick={() => (open = !open)}>{t("ui.file")}</button>
  {#if open}
    <div class="pop panel" role="menu">
      <button class="quiet" role="menuitem" onclick={() => input.click()}>{t("ui.open_file")}</button>
      <button class="quiet" role="menuitem" onclick={() => save("project")}>{t("ui.save_project")}</button>
      <button class="quiet" role="menuitem" onclick={() => save("shop")}>{t("ui.save_shop")}</button>
      <button class="quiet" role="menuitem" onclick={() => copyDoc("project")}>{t("ui.copy_project")}</button>
      <hr />
      <button class="quiet" role="menuitem" onclick={() => { store.resetToExample(); note = t("ui.example_loaded"); }}>{t("ui.reset_example")}</button>
      {#if note}<p class="note">{note}</p>{/if}
    </div>
  {/if}
  <input bind:this={input} id="file-input" type="file" accept=".json,application/json" hidden onchange={onFile} />
</div>

<style>
  .menu { position: relative; }
  .pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; padding: 6px; display: flex; flex-direction: column; min-width: 230px; box-shadow: 0 8px 24px rgb(0 0 0 / .12); }
  .pop button { text-align: left; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
  .note { margin: 6px 4px 2px; font-size: 12px; color: var(--muted); max-width: 30ch; }
</style>
