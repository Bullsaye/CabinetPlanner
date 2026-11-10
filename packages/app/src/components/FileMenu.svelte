<script lang="ts">
  import { blankProject, copy, download, downloadNote, parseDocument, store } from "../lib/store.svelte.ts";
  import { openFile } from "../lib/platform.ts";

  const t = $derived(store.tr.t);
  let open = $state(false);
  let note = $state("");

  const fileName = (s: string): string => (s || "project").replace(/[^\w.-]+/g, "-").toLowerCase();

  async function openDoc(): Promise<void> {
    const f = await openFile(["json"]);
    if (!f) return;
    try {
      const { kind, doc } = parseDocument(f.text);
      if (kind === "shop") {
        store.shop = doc;
        note = t("ui.shop_loaded", { file: f.name });
      } else {
        await store.addProject(doc);
        note = t("ui.loaded", { file: f.name });
      }
    } catch (err) {
      note = t("ui.load_failed", { file: f.name, error: String((err as Error).message) });
    }
  }
  async function save(kind: "project" | "shop"): Promise<void> {
    const doc = $state.snapshot(kind === "project" ? store.project : store.shop);
    const name = kind === "project" ? `${fileName(store.project.name)}.project.json` : "shop.json";
    note = downloadNote(await download(name, JSON.stringify(doc, null, 2) + "\n", "application/json"), name, t);
  }
  async function copyDoc(): Promise<void> {
    note = (await copy(JSON.stringify($state.snapshot(store.project), null, 2))) ? t("ui.copied") : t("ui.copy_failed");
  }
  const run = (f: () => unknown) => () => {
    note = "";
    void f();
  };
</script>

<div class="menu">
  <button aria-expanded={open} aria-haspopup="menu" onclick={() => (open = !open)}>{t("ui.file")}</button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="scrim" onclick={() => (open = false)}></div>
    <div class="pop panel" role="menu">
      <button class="quiet" role="menuitem" onclick={run(() => { open = false; store.closeProject(); })}>{t("ui.all_projects")}</button>
      <button class="quiet" role="menuitem" onclick={run(() => { open = false; return store.addProject(blankProject(t("ui.new_project_name"))); })}>{t("ui.new_project")}</button>
      <button class="quiet" role="menuitem" onclick={run(openDoc)}>{t("ui.open_file")}</button>
      <hr />
      <button class="quiet" role="menuitem" onclick={run(() => save("project"))}>{t("ui.save_project")}</button>
      <button class="quiet" role="menuitem" onclick={run(() => save("shop"))}>{t("ui.save_shop")}</button>
      <button class="quiet" role="menuitem" onclick={run(copyDoc)}>{t("ui.copy_project")}</button>
      <hr />
      <label class="lang">
        <span>{t("ui.language")}</span>
        <select id="lang" bind:value={store.ui.lang}>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </label>
      {#if note}<p class="note" role="status">{note}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .menu { position: relative; }
  .scrim { position: fixed; inset: 0; z-index: 19; }
  .pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; padding: 6px; display: flex; flex-direction: column; min-width: 230px; box-shadow: 0 8px 24px rgb(0 0 0 / .12); }
  .pop button { text-align: left; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
  .lang { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 10px; }
  .note { margin: 6px 4px 2px; font-size: 12px; color: var(--muted); max-width: 30ch; }
</style>
