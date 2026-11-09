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

  const t = $derived(store.tr.t);
  const tabs: Tab[] = ["view", "room", "cutlist", "drawings", "hardware"];

  // Save on every change.
  $effect(() => {
    $state.snapshot(store.project);
    $state.snapshot(store.shop);
    store.ui.lang;
    store.ui.style;
    store.save();
  });
  $effect(() => {
    document.documentElement.lang = store.ui.lang;
  });

  const counts = $derived.by(() => {
    const d = store.result?.diagnostics ?? [];
    return { errors: d.filter((x) => x.severity === "error").length, warnings: d.filter((x) => x.severity === "warning").length };
  });
</script>

<div class="shell">
  <header>
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="var(--accent)" stroke-width="2" />
        <line x1="12" y1="4" x2="12" y2="20" stroke="var(--accent)" stroke-width="2" />
        <line x1="3" y1="11" x2="12" y2="11" stroke="var(--accent)" stroke-width="2" />
      </svg>
      <span class="name">Cabinet Planner</span>
      <span class="sep">/</span>
      <input
        id="project-name"
        class="project-name"
        type="text"
        aria-label={t("ui.project_name")}
        bind:value={store.project.name}
      />
    </div>
    <nav aria-label={t("ui.views")}>
      {#each tabs as tab}
        <button class="tab" aria-pressed={store.ui.tab === tab} onclick={() => (store.ui.tab = tab)}>{t(`ui.tab.${tab}`)}</button>
      {/each}
    </nav>
    <div class="right">
      <span class="status" class:bad={counts.errors > 0}>
        {#if counts.errors}{t("ui.errors", { n: counts.errors })}{:else if counts.warnings}{t("ui.warnings", { n: counts.warnings })}{:else}{t("ui.checks_ok")}{/if}
      </span>
      <select id="lang" aria-label={t("ui.language")} bind:value={store.ui.lang}>
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
      <FileMenu />
    </div>
  </header>

  {#if store.built.error}
    <div class="fatal" role="alert">
      <strong>{t("ui.file_error")}</strong>
      <pre>{store.built.error}</pre>
      <button onclick={() => store.resetToExample()}>{t("ui.reset_example")}</button>
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
</div>

<style>
  .shell { display: flex; flex-direction: column; min-height: 100vh; }
  header {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; min-height: 52px;
    padding: 6px max(16px, env(safe-area-inset-right, 0px)) 6px max(16px, env(safe-area-inset-left, 0px));
    background: var(--surface); border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
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
