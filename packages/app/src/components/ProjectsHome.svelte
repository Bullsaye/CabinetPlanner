<script lang="ts">
  import { blankProject, download, downloadNote, exampleProjectDoc, parseDocument, store } from "../lib/store.svelte.ts";
  import { openFile } from "../lib/platform.ts";

  const t = $derived(store.tr.t);
  let note = $state("");
  let renaming = $state<string | null>(null);
  let confirmDelete = $state<string | null>(null);
  let filter = $state("");

  const list = $derived(store.projects.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase())));
  const when = (ms: number): string =>
    new Intl.DateTimeFormat(store.ui.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  const fileName = (s: string): string => (s || "project").replace(/[^\w.-]+/g, "-").toLowerCase();

  async function importFile(): Promise<void> {
    const f = await openFile(["json"]);
    if (!f) return;
    try {
      const { kind, doc } = parseDocument(f.text);
      if (kind === "shop") {
        store.shop = doc;
        note = t("ui.shop_loaded", { file: f.name });
      } else {
        await store.addProject(doc);
      }
    } catch (e) {
      note = t("ui.load_failed", { file: f.name, error: String((e as Error).message) });
    }
  }
  async function exportProject(id: string): Promise<void> {
    const doc = await store.projectDoc(id);
    if (!doc) return;
    const name = `${fileName(doc.name)}.project.json`;
    note = downloadNote(await download(name, JSON.stringify(doc, null, 2) + "\n", "application/json"), name, t);
  }
</script>

<section class="home">
  <div class="top">
    <h1>{t("ui.projects")}</h1>
    <div class="actions">
      <button class="primary" onclick={() => store.addProject(blankProject(t("ui.new_project_name")))}>{t("ui.new_project")}</button>
      <button onclick={() => store.addProject(exampleProjectDoc())}>{t("ui.new_from_example")}</button>
      <button onclick={importFile}>{t("ui.import_file")}</button>
    </div>
  </div>
  {#if note}<p class="note muted" role="status">{note}</p>{/if}
  {#if store.projects.length > 6}
    <input id="project-filter" type="text" placeholder={t("ui.search_projects")} aria-label={t("ui.search_projects")} bind:value={filter} />
  {/if}
  {#if !store.projects.length}
    <p class="muted empty">{t("ui.no_projects")}</p>
  {/if}
  <ul class="grid-list">
    {#each list as p (p.id)}
      <li class="panel card" class:current={p.id === store.projectId}>
        {#if renaming === p.id}
          <form onsubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget as HTMLFormElement).get("name") as string).trim(); if (v) store.renameProject(p.id, v); renaming = null; }}>
            <!-- svelte-ignore a11y_autofocus -->
            <input name="name" type="text" value={p.name} aria-label={t("ui.project_name")} autofocus />
            <button type="submit">{t("ui.ok")}</button>
          </form>
        {:else}
          <button class="open" onclick={() => store.openProject(p.id)}>
            <span class="nm">{p.name || t("ui.untitled")}</span>
            <span class="muted meta">{t("ui.cabinet_count", { n: p.cabinets })} · {when(p.updated)}</span>
          </button>
        {/if}
        <div class="row">
          <button class="quiet" onclick={() => (renaming = p.id)}>{t("ui.rename")}</button>
          <button class="quiet" onclick={() => store.duplicateProject(p.id, t("ui.copy_suffix"))}>{t("ui.duplicate")}</button>
          <button class="quiet" onclick={() => exportProject(p.id)}>{t("ui.export")}</button>
          {#if confirmDelete === p.id}
            <button class="quiet danger" onclick={() => { store.deleteProject(p.id); confirmDelete = null; }}>{t("ui.confirm_delete")}</button>
          {:else}
            <button class="quiet" onclick={() => (confirmDelete = p.id)}>{t("ui.delete")}</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
  <p class="muted small">{t("ui.local_storage_hint")}</p>
</section>

<style>
  .home { max-width: 1100px; margin: 0 auto; padding: 20px max(16px, env(safe-area-inset-right, 0px)) 32px max(16px, env(safe-area-inset-left, 0px)); display: flex; flex-direction: column; gap: 14px; }
  .top { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; }
  h1 { font-size: 20px; margin: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .grid-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .card.current { border-color: var(--accent); }
  .open { text-align: left; display: flex; flex-direction: column; gap: 4px; border: 0; background: transparent; padding: 4px; }
  .open:hover { background: var(--surface-2); }
  .nm { font-weight: 600; font-size: 15px; }
  .meta { font-size: 12px; }
  .row { display: flex; flex-wrap: wrap; gap: 2px; border-top: 1px solid var(--line); padding-top: 6px; }
  form { display: flex; gap: 6px; }
  form input { flex: 1; }
  .danger { color: var(--err); }
  .note { margin: 0; }
  .empty { padding: 24px 0; }
  .small { font-size: 12px; }
  #project-filter { max-width: 320px; }
</style>
