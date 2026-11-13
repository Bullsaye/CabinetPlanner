<script lang="ts">
  import { store, type Tab } from "./lib/store.svelte.ts";
  import CabinetList from "./components/CabinetList.svelte";
  import RightPane from "./components/RightPane.svelte";
  import Viewer3D from "./components/Viewer3D.svelte";
  import CabinetView from "./components/CabinetView.svelte";
  import CutlistView from "./components/CutlistView.svelte";
  import DrawingsView from "./components/DrawingsView.svelte";
  import BomView from "./components/BomView.svelte";
  import Diagnostics from "./components/Diagnostics.svelte";
  import FileMenu from "./components/FileMenu.svelte";
  import RoomView from "./components/RoomView.svelte";
  import ProjectsHome from "./components/ProjectsHome.svelte";
  import LibraryView from "./components/LibraryView.svelte";
  import AccountMenu from "./components/AccountMenu.svelte";
  import CommunityView from "./components/CommunityView.svelte";
  import { account } from "./lib/account.svelte.ts";
  import { onMount } from "svelte";

  const t = $derived(store.tr.t);
  const tabs: Tab[] = ["view", "room", "cutlist", "drawings", "hardware", "library", "community"];

  onMount(() => {
    // The account is optional: it starts after the local data is there.
    void store.boot().then(() => account.boot());
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
    store.ui.viewMode;
    store.ui.cabinet3d;
    store.ui.walls;
    store.ui.fittings;
    store.ui.worktops;
    store.ui.plinths;
    store.ui.hingeSymbol;
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

  /** The cabinet view on a narrow screen carries the settings itself (D68). */
  const inlinePane = $derived(store.narrow && store.ui.tab === "view" && store.viewMode === "cabinet");
  $effect(() => {
    if (inlinePane && store.ui.panel === "inspector") store.ui.panel = null;
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
      <span class="panel-toggles" class:off={store.ui.tab === "community"}>
        <button class="only-narrow" aria-pressed={store.ui.panel === "list"} onclick={() => (store.ui.panel = store.ui.panel === "list" ? null : "list")}>{t("ui.cabinets")}</button>
        <button class="only-tablet" class:gone={inlinePane} aria-pressed={store.ui.panel === "inspector"} onclick={() => (store.ui.panel = store.ui.panel === "inspector" ? null : "inspector")}>{t("ui.properties")}</button>
      </span>
      <span class="status" class:bad={counts.errors > 0} class:warn={!counts.errors && counts.warnings > 0} title={counts.errors || counts.warnings ? t("cli.summary", { errors: counts.errors, warnings: counts.warnings }) : t("ui.checks_ok")}>
        {#if counts.errors}{t("ui.errors", { n: counts.errors })}{:else if counts.warnings}{t("ui.warnings", { n: counts.warnings })}{:else}{t("ui.checks_ok_short")}{/if}
      </span>
      {/if}
      <AccountMenu />
      <FileMenu />
    </div>
  </header>

  {#if !store.ready}
    <p class="muted loading">{t("ui.loading")}</p>
  {:else if store.screen === "home"}
    <ProjectsHome />
  {:else if store.ui.tab === "community"}
    <CommunityView />
  {:else}
  {#if store.built.error}
    <div class="fatal" role="alert">
      <strong>{t("ui.file_error")}</strong>
      <pre>{store.built.error}</pre>
      <button onclick={() => store.undo()} disabled={!store.canUndo}>{t("ui.undo")}</button>
      <button onclick={() => store.closeProject()}>{t("ui.all_projects")}</button>
    </div>
  {/if}

  {#if store.ui.panel}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="scrim" onclick={() => (store.ui.panel = null)}></div>
  {/if}
  <div class="body" class:wide={store.ui.construction !== null}>
    <aside class="left" class:open={store.ui.panel === "list"}><CabinetList /></aside>
    <main>
      <div class="work">
        {#if store.ui.tab === "view" && store.viewMode === "cabinet"}
          <CabinetView />
        {:else if store.ui.tab === "view"}
          <Viewer3D />
        {:else if store.ui.tab === "room"}
          <RoomView />
        {:else if store.ui.tab === "cutlist"}
          <CutlistView />
        {:else if store.ui.tab === "drawings"}
          <DrawingsView />
        {:else if store.ui.tab === "library"}
          <LibraryView />
        {:else}
          <BomView />
        {/if}
      </div>
      <Diagnostics />
    </main>
    <!-- Narrow screens: the cabinet view shows the settings below its drawing instead. -->
    {#if !inlinePane}
    <aside class="right-pane" class:open={store.ui.panel === "inspector"}>
      <button class="quiet close only-tablet" aria-label={t("ui.close")} onclick={() => (store.ui.panel = null)}>×</button>
      <RightPane />
    </aside>
    {/if}
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
  .project-name { border-color: transparent; font-weight: 500; width: 14em; flex: 0 1 14em; min-width: 5em; text-overflow: ellipsis; }
  .project-name:hover, .project-name:focus { border-color: var(--line); }
  nav { display: flex; gap: 2px; flex-wrap: wrap; }
  .tab { border-color: transparent; background: transparent; white-space: nowrap; }
  .tab[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-fg); border-color: transparent; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .status { font-size: 12px; color: var(--ok); white-space: nowrap; }
  .status.warn { color: var(--warn); }
  .status.bad { color: var(--err); }
  /* Desktop: one row. The tabs keep their place; the project name gives way first. */
  @media (min-width: 1101px) {
    header { flex-wrap: nowrap; gap: 8px 10px; }
    nav { flex-wrap: nowrap; }
    .right { flex-wrap: nowrap; flex: none; }
  }
  @media (min-width: 1101px) and (max-width: 1340px) {
    .tab { padding-left: 7px; padding-right: 7px; }
    .name { display: none; }
  }
  .fatal { margin: 12px 16px; padding: 12px; border: 1px solid var(--err); background: var(--err-soft); border-radius: 8px; }
  .fatal pre { white-space: pre-wrap; font-size: 12px; }
  .body {
    flex: 1; display: grid; grid-template-columns: 230px minmax(0, 1fr) 360px; gap: 12px;
    padding: 12px max(16px, env(safe-area-inset-right, 0px)) 16px max(16px, env(safe-area-inset-left, 0px));
    min-height: 0;
  }
  .body.wide { grid-template-columns: 230px minmax(0, 1fr) 460px; }
  main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .work { flex: 1; min-height: 0; }
  aside { min-width: 0; }
  .panel-toggles { display: contents; }
  .panel-toggles.off, .panel-toggles .gone { display: none; }
  .only-tablet, .only-narrow, .scrim { display: none; }
  /* Tablet: the inspector slides in from the right; phone: the cabinet list from the left too. */
  @media (max-width: 1100px) {
    .body, .body.wide { grid-template-columns: 210px minmax(0, 1fr); }
    .only-tablet { display: inline-block; }
    .scrim { display: block; position: fixed; inset: 0; background: rgb(0 0 0 / .25); z-index: 30; }
    .right-pane {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 31; width: min(400px, 94vw); overflow-y: auto;
      padding: max(10px, env(safe-area-inset-top, 0px)) max(10px, env(safe-area-inset-right, 0px)) 16px 10px;
      background: var(--bg); box-shadow: -8px 0 24px rgb(0 0 0 / .18);
      transform: translateX(105%); transition: transform .18s ease-out; visibility: hidden;
    }
    .right-pane.open { transform: none; visibility: visible; }
    .close { display: block; margin-left: auto; font-size: 20px; line-height: 1; }
  }
  @media (max-width: 700px) {
    .body, .body.wide { grid-template-columns: minmax(0, 1fr); }
    .only-narrow { display: inline-block; }
    .left {
      position: fixed; top: 0; left: 0; bottom: 0; z-index: 31; width: min(300px, 88vw); overflow-y: auto;
      padding: max(10px, env(safe-area-inset-top, 0px)) 10px 16px max(10px, env(safe-area-inset-left, 0px));
      background: var(--bg); box-shadow: 8px 0 24px rgb(0 0 0 / .18);
      transform: translateX(-105%); transition: transform .18s ease-out; visibility: hidden;
    }
    .left.open { transform: none; visibility: visible; }
  }
  /* Phone header: icon-only brand, one scrolling row of tabs. */
  @media (max-width: 700px) {
    .name, .sep { display: none; }
    .brand { flex: 1; }
    .project-name { width: auto; flex: 1; min-width: 0; }
    nav { order: 10; flex: 1 1 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .tab { white-space: nowrap; }
    .right { margin-left: 0; gap: 6px; flex-wrap: nowrap; flex: 1 1 100%; }
    .right :global(button) { padding-left: 8px; padding-right: 8px; white-space: nowrap; }
    .status { display: none; }
  }
  @media (prefers-reduced-motion: reduce) { .right-pane, .left { transition: none; } }
</style>
