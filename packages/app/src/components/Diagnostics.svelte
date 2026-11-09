<script lang="ts">
  import { store } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  const diags = $derived(store.result?.diagnostics ?? []);
  let open = $state(true);
</script>

{#if diags.length}
  <section class="panel dg">
    <button class="quiet head" aria-expanded={open} onclick={() => (open = !open)}>
      <span class="label">{t("ui.checks")}</span>
      <span class="muted">{t("cli.summary", { errors: diags.filter((d) => d.severity === "error").length, warnings: diags.filter((d) => d.severity === "warning").length })}</span>
    </button>
    {#if open}
      <ul>
        {#each diags as d}
          <li class={d.severity}>
            <button
              class="quiet"
              onclick={() => {
                if (d.cabinet) store.ui.selected = d.cabinet;
                if (d.part) store.ui.part = d.part;
              }}
            >
              <span class="sev">{t(`severity.${d.severity}`)}</span>
              {#if d.cabinet}<span class="mono">{d.part ?? d.cabinet}</span>{/if}
              <span>{t(`diag.${d.code}`, d.params)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .dg { padding: 4px 8px 8px; }
  .head { display: flex; gap: 12px; align-items: baseline; width: 100%; text-align: left; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 180px; overflow: auto; }
  li button { display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left; font-size: 12px; }
  .sev { font-weight: 600; min-width: 5em; }
  .error .sev { color: var(--err); }
  .warning .sev { color: var(--warn); }
</style>
