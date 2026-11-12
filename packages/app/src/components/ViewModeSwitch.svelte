<script lang="ts">
  import { store } from "../lib/store.svelte.ts";

  // Main view: the selected cabinet alone (front view or 3D) or the room (D68).
  const t = $derived(store.tr.t);
</script>

<div class="seg" role="group" aria-label={t("ui.view_mode")}>
  <button aria-pressed={store.viewMode === "cabinet"} onclick={() => (store.ui.viewMode = "cabinet")}>{t("ui.view_mode.cabinet")}</button>
  <button aria-pressed={store.viewMode === "room"} onclick={() => (store.ui.viewMode = "room")}>{t("ui.view_mode.room")}</button>
</div>
{#if store.viewMode === "cabinet"}
  <div class="seg" role="group" aria-label={t("ui.cabinet_view")}>
    <button aria-pressed={!store.ui.cabinet3d} onclick={() => (store.ui.cabinet3d = false)}>{t("ui.cabinet_view.front")}</button>
    <button aria-pressed={store.ui.cabinet3d} onclick={() => (store.ui.cabinet3d = true)}>{t("ui.cabinet_view.3d")}</button>
  </div>
{/if}

<style>
  .seg { display: flex; }
  .seg button { border-radius: 0; white-space: nowrap; }
  .seg button + button { margin-left: -1px; }
  .seg button:first-child { border-radius: 6px 0 0 6px; }
  .seg button:last-child { border-radius: 0 6px 6px 0; }
  .seg button[aria-pressed="true"] { position: relative; }
</style>
