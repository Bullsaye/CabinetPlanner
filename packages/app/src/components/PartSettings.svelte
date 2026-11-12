<script lang="ts">
  import { localName, type Part } from "@cabinet-planner/engine";
  import { isOption, partSources, ROLE_SETTINGS, type SourceGroup } from "../lib/partmap.ts";
  import { store } from "../lib/store.svelte.ts";
  import OptRow from "./fields/OptRow.svelte";
  import VarRow from "./fields/VarRow.svelte";

  /**
   * The settings that drive one part (D59): by its role, and behind each
   * source of its machining (joints, hardware, system holes, back groove).
   * `detail` is the parameter view of the construction editor: variable
   * names and where each value comes from are spelled out.
   */
  let { part, detail = false, scope = "part" }: { part: Part; detail?: boolean; scope?: string } = $props();

  const t = $derived(store.tr.t);
  const cab = $derived(store.cabinet);
  const lib = $derived(store.result?.library);
  const groups = $derived(ROLE_SETTINGS[part.role] ?? []);
  const shownByRole = $derived(new Set(groups.flatMap((g) => g.keys)));
  const sources = $derived(partSources(part, cab?.resolved, lib));
  /** A machining source repeats no row the part's own groups already show. */
  const extra = (s: SourceGroup): string[] => s.settings.keys.filter((k) => !shownByRole.has(k));

  function sourceTitle(s: SourceGroup): string {
    if (s.item) return localName(lib?.hardware.get(s.item)?.name ?? s.item, store.tr.locale);
    if (s.key === "joint") return t("ui.part.src.joint", { with: [...new Set(s.refs.flatMap((r) => r.split("-")))].filter((c) => c !== part.code).join(", ") });
    return t(`ui.part.src.${s.key.split(":")[0]}`);
  }
  function showInLibrary(id: string): void {
    store.ui.libraryItem = { section: "hardware", id };
    store.ui.tab = "library";
  }
</script>

{#each groups as g (g.id)}
  <section class="ps" data-group={g.id}>
    <h4 class="label">{t(`ui.pg.${g.id}`)}</h4>
    {#each g.keys as k (k)}
      {#if isOption(k)}<OptRow key={k} scope={`${scope}-${g.id}`} />{:else}<VarRow name={k} scope={`${scope}-${g.id}`} {detail} />{/if}
    {/each}
  </section>
{/each}

{#if sources.length}
  <section class="ps" data-group="machining">
    <h4 class="label">{t("ui.part.machining")}</h4>
    <p class="muted small">{t("ui.part.machining_hint")}</p>
    {#each sources as s, i (s.key)}
      {@const keys = extra(s)}
      <div class="src" data-source={s.key}>
        <div class="src-head">
          <span class="src-name">{sourceTitle(s)}</span>
          <span class="muted small mono">{t("ui.part.ops", { n: s.count })}</span>
          {#if s.item}
            <button class="quiet link" onclick={() => showInLibrary(s.item!)}>{t("ui.part.in_library")}</button>
          {/if}
        </div>
        {#each keys as k (k)}
          {#if isOption(k)}<OptRow key={k} scope={`${scope}-m${i}`} />{:else}<VarRow name={k} scope={`${scope}-m${i}`} {detail} />{/if}
        {/each}
        {#if !keys.length && s.settings.keys.length}
          <p class="muted small">{t("ui.part.see_above", { group: t(`ui.pg.${s.settings.id}`) })}</p>
        {:else if s.kind === "custom"}
          <p class="muted small">{t("ui.part.src.custom_hint")}</p>
        {:else if !s.settings.keys.length}
          <p class="muted small">{t("ui.part.src.fitting_hint")}</p>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .ps { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  h4 { margin: 0 0 2px; }
  .small { font-size: 12px; margin: 0; }
  .src { display: flex; flex-direction: column; gap: 4px; padding: 6px 0 6px 8px; border-left: 2px solid var(--line); margin-top: 4px; }
  .src-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
  .src-name { font-weight: 600; }
  .link { color: var(--accent-fg); font-size: 12px; padding: 0 4px; margin-left: auto; }
</style>
