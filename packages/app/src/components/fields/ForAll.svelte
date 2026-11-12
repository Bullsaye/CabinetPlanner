<script lang="ts">
  import { applyForAll, kindCounts, type ForAllResult, type ForAllScope, type Kind, type Value, type ValueKind } from "../../lib/bulk.ts";
  import { store } from "../../lib/store.svelte.ts";

  /**
   * "For all …" on a value row of a cabinet (D59): the cabinet's own value
   * becomes the value of every cabinet in the project, of every cabinet of
   * one kind, or the shop standard. One line says what happened.
   */
  let {
    kind,
    name,
    value,
    shown,
    label,
    id,
  }: {
    kind: ValueKind;
    name: string;
    /** The cabinet's own value; undefined: nothing of its own to pass on. */
    value: Value | undefined;
    /** The value as the row shows it, for the message. */
    shown: string;
    label: string;
    id: string;
  } = $props();

  const t = $derived(store.tr.t);
  let open = $state(false);
  let done = $state<(ForAllResult & { shown: string }) | null>(null);
  const counts = $derived(open ? kindCounts() : { base: 0, wall: 0, tall: 0 });
  const total = $derived(counts.base + counts.wall + counts.tall);
  const kinds = $derived((["base", "wall", "tall"] as Kind[]).filter((k) => counts[k] > 0));

  function apply(scope: ForAllScope): void {
    if (value === undefined) return;
    done = { ...applyForAll(kind, name, value, scope), shown };
    open = false;
  }
  const message = $derived.by(() => {
    if (!done) return "";
    const p = { label, value: done.shown, n: done.cabinets };
    const head =
      done.scope === "project" ? t("ui.forall.done.project", p) : done.scope === "shop" ? t("ui.forall.done.shop", p) : t("ui.forall.done.kind", { ...p, kind: t(`ui.kinds.${done.scope}`) });
    return [
      head,
      done.cleared ? t("ui.forall.cleared", { n: done.cleared }) : "",
      done.kept ? t("ui.forall.kept", { n: done.kept }) : "",
      done.scope === "shop" ? "" : t("ui.forall.undo"),
    ]
      .filter(Boolean)
      .join(" ");
  });
  // The note belongs to the cabinet it was made in.
  let forCabinet = store.ui.selected;
  $effect(() => {
    if (store.ui.selected === forCabinet) return;
    forCabinet = store.ui.selected;
    done = null;
    open = false;
  });
</script>

{#if value !== undefined}
  <div class="fa">
    <button class="quiet fa-btn" aria-expanded={open} aria-controls={`${id}-fa`} title={t("ui.forall.hint")} onclick={() => { open = !open; done = null; }}>{t("ui.forall")}</button>
  </div>
  {#if open}
    <div class="fa-menu" id={`${id}-fa`} role="group" aria-label={`${label}: ${t("ui.forall")}`}>
      <p class="muted">{t("ui.forall.title", { label, value: shown })}</p>
      <button onclick={() => apply("project")}>{t("ui.forall.project", { n: total })}</button>
      {#each kinds as k}
        <button onclick={() => apply(k)}>{t("ui.forall.kind", { kind: t(`ui.kinds.${k}`), n: counts[k] })}</button>
      {/each}
      <button onclick={() => apply("shop")}>{t("ui.forall.shop")}</button>
    </div>
  {/if}
{/if}
{#if message}
  <p class="fa-done" role="status">
    {message}
    <button class="quiet fa-x" aria-label={t("ui.close")} onclick={() => (done = null)}>×</button>
  </p>
{/if}

<style>
  .fa, .fa-menu, .fa-done { grid-column: 1 / -1; }
  .fa { display: flex; justify-content: flex-end; margin-top: -3px; }
  .fa-btn { font-size: 11.5px; padding: 0 6px; min-height: 0; line-height: 20px; color: var(--accent-fg); }
  .fa-btn[aria-expanded="true"] { background: var(--accent-soft); }
  .fa-menu { display: flex; flex-direction: column; gap: 4px; padding: 8px; margin-bottom: 4px; border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); }
  .fa-menu p { margin: 0 0 2px; font-size: 12px; }
  .fa-menu button { text-align: left; }
  .fa-done { margin: 0 0 2px; font-size: 12px; line-height: 1.4; padding: 5px 8px; border-radius: 6px; background: var(--accent-soft); color: var(--fg); }
  .fa-x { padding: 0 6px; min-height: 0; line-height: 18px; float: right; }
  @media (max-width: 1100px) {
    .fa-btn { line-height: 30px; font-size: 12.5px; padding: 0 8px; }
    .fa-menu button { min-height: 40px; }
  }
</style>
