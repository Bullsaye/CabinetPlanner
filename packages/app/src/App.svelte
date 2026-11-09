<script lang="ts">
  import { store, type Tab } from "./lib/store.svelte.ts";
  import CabinetList from "./components/CabinetList.svelte";
  import Inspector from "./components/Inspector.svelte";
  import Viewer3D from "./components/Viewer3D.svelte";
  import CutlistView from "./components/CutlistView.svelte";
  import DrawingsView from "./components/DrawingsView.svelte";
  import HardwareView from "./components/HardwareView.svelte";
  import Diagnostics from "./components/Diagnostics.svelte";
  import FileMenu from "./components/FileMenu.svelte";
  import RoomView from "./components/RoomView.svelte";
  import ProjectsHome from "./components/ProjectsHome.svelte";
  import { onMount } from "svelte";

  const t = $derived(store.tr.t);
  const tabs: Tab[] = ["view", "room", "cutlist", "drawings", "hardware"];

  onMount(() => {
    void store.boot();
  });

  // Save and record undo history shortly after every change (typing is grouped).
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    $state.snapshot(store.project);
    $state.snapshot(store.shop);
    store.ui.lang;
    store.ui.style;
    store.ui.ops;
    store.ui.fronts;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void store.persist(), 300);
  });
  $effect(() => {
    $state.snapshot(store.project);
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => store.record(), 400);
  });

  function onKey(e: KeyboardEvent): void {
    if (store.screen !== "project" || !(e.ctrlKey || e.metaKey)) return;
    const el = e.target as HTMLElement | null;
    // Text fields keep their own undo.
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && (el as HTMLInputElement).type !== "checkbox") return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if ((k === "z" && e.shiftKey) || k === "y") {
      e.preventDefault();
      store.redo();
    }
  }
  $effect(() => {
    document.documentElement.lang = store.ui.lang;
  });

  const counts = $derived.by(() => {
    const d = store.result?.diagnostics ?? [];
    return { errors: d.filter((x) => x.severity === "error").length, warnings: d.filter((x) => x.severity === "warning").length };
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="shell">
  <header>
    <div class="brand">
      <button class="quiet home-btn" title={t("ui.all_projects")} aria-label={t("ui.all_projects")} onclick={() => store.closeProject()}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="var(--accent)" stroke-width="2" />
        <line x1="12" y1="4" x2="12" y2="20" stroke="var(--accent)" stroke-width="2" />
        <line x1="3" y1="11" x2="12" y2="11" stroke="var(--accent)" stroke-width="2" />
      </svg>
      <span class="name">Cabinet Planner</span>
      </button>
      {#if store.screen === "project"}
      <span class="sep">/</span>
      <input
        id="project-name"
        class="project-name"
        type="text"
        aria-label={t("ui.project_name")}
        bind:value={store.project.name}
      />
      {/if}
    </div>
    {#if store.screen === "project"}
    <div class="undo" role="group" aria-label={t("ui.history")}>
      <button class="quiet" title={`${t("ui.undo")} (Ctrl+Z)`} aria-label={t("ui.undo")} disabled={!store.canUndo} onclick={() => store.undo()}>↶</button>
      <button class="quiet" title={`${t("ui.redo")} (Ctrl+Shift+Z)`} aria-label={t("ui.redo")} disabled={!store.canRedo} onclick={() => store.redo()}>↷</button>
    </div>
    <nav aria-label={t("ui.views")}>
      {#each tabs as tab}
        <button class="tab" aria-pressed={store.ui.tab === tab} onclick={() => (store.ui.tab = tab)}>{t(`ui.tab.${tab}`)}</button>
      {/each}
    </nav>
    {/if}
    <div class="right">
      {#if store.screen === "project"}
      <span class="status" class:bad={counts.errors > 0}>
        {#if counts.errors}{t("ui.errors", { n: counts.errors })}{:else if counts.warnings}{t("ui.warnings", { n: counts.warnings })}{:else}{t("ui.checks_ok")}{/if}
      </span>
      {/if}
      <select id="lang" aria-label={t("ui.language")} bind:value={store.ui.lang}>
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
      <FileMenu />
    </div>
  </header>

  {#if !store.ready}
    <p class="muted loading">{t("ui.loading")}</p>
  {:else if store.screen === "home"}
    <ProjectsHome />
  {:else}
  {#if store.built.error}
    <div class="fatal" role="alert">
      <strong>{t("ui.file_error")}</strong>
      <pre>{store.built.error}</pre>
      <button onclick={() => store.undo()} disabled={!store.canUndo}>{t("ui.undo")}</button>
      <button onclick={() => store.closeProject()}>{t("ui.all_projects")}</button>
    </div>
  {/if}

  <div class="body">
    <aside class="left"><CabinetList /></aside>
    <main>
      <div class="work">
        {#if store.ui.tab === "view"}
          <Viewer3D />
        {:else if store.ui.tab === "room"}
          <RoomView />
        {:else if store.ui.tab === "cutlist"}
          <CutlistView />
        {:else if store.ui.tab === "drawings"}
          <DrawingsView />
        {:else}
          <HardwareView />
        {/if}
      </div>
      <Diagnostics />
    </main>
    <aside class="right-pane"><Inspector /></aside>
  </div>
  {/if}
</div>

<style>
  .shell { display: flex; flex-direction: column; min-height: 100vh; }
  header {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-height: 52px;
    padding: 6px max(16px, env(safe-area-inset-right, 0px)) 6px max(16px, env(safe-area-inset-left, 0px));
    background: var(--surface); border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .home-btn { display: flex; align-items: center; gap: 8px; padding: 4px 6px; }
  .undo { display: flex; gap: 2px; }
  .undo button { font-size: 16px; line-height: 1; padding: 4px 8px; }
  .loading { padding: 40px; text-align: center; }
  .name { font-weight: 600; font-size: 14px; white-space: nowrap; }
  .sep { color: var(--muted); }
  .project-name { border-color: transparent; font-weight: 500; width: 14em; }
  .project-name:hover, .project-name:focus { border-color: var(--line); }
  nav { display: flex; gap: 4px; flex-wrap: wrap; }
  .tab { border-color: transparent; background: transparent; }
  .tab[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-fg); border-color: transparent; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status { font-size: 12px; color: var(--ok); }
  .status.bad { color: var(--err); }
  .fatal { margin: 12px 16px; padding: 12px; border: 1px solid var(--err); background: var(--err-soft); border-radius: 8px; }
  .fatal pre { white-space: pre-wrap; font-size: 12px; }
  .body {
    flex: 1; display: grid; grid-template-columns: 230px minmax(0, 1fr) 340px; gap: 12px;
    padding: 12px max(16px, env(safe-area-inset-right, 0px)) 16px max(16px, env(safe-area-inset-left, 0px));
    min-height: 0;
  }
  main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .work { flex: 1; min-height: 0; }
  aside { min-width: 0; }
  @media (max-width: 1100px) {
    .body { grid-template-columns: 200px minmax(0, 1fr); }
    .right-pane { grid-column: 1 / -1; }
  }
  @media (max-width: 700px) {
    .body { grid-template-columns: minmax(0, 1fr); }
  }
</style>
