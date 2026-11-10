<script lang="ts">
  import { account, cloudErrorText } from "../lib/account.svelte.ts";
  import { isConnectionError, type PackDetail, type PackList, type PackSort, type PackSummary, type Trust } from "../lib/cloud.ts";
  import { LIBRARY_KINDS, installedPack } from "../lib/packs.ts";
  import { store } from "../lib/store.svelte.ts";
  import PackDetailView from "./PackDetail.svelte";
  import PackPublish from "./PackPublish.svelte";

  type View =
    | { name: "browse" }
    | { name: "mine" }
    | { name: "pack"; id: string }
    | { name: "publish"; mode: "new" | "fork" | "version" | "edit"; pack?: PackDetail };

  const t = $derived(store.tr.t);
  const PAGE_SIZE = 12;
  const TRUSTS: Trust[] = ["verified", "tested", "community"];

  let view = $state<View>({ name: "browse" });
  let search = $state("");
  let q = $state("");
  let type = $state("");
  let sort = $state<PackSort>("newest");
  let trust = $state<Trust[]>([...TRUSTS]);
  let page = $state(1);
  let list = $state<PackList | null>(null);
  let loading = $state(false);
  let error = $state("");
  let note = $state("");
  /** Latest versions of the installed packs (for "update available"). */
  let latest = $state<Record<string, string>>({});

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function onSearch(): void {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      q = search.trim();
      page = 1;
    }, 300);
  }
  const setFilter = (f: () => void): void => {
    f();
    page = 1;
  };

  let seq = 0;
  async function load(): Promise<void> {
    const my = ++seq;
    if (!account.url || (view.name !== "browse" && view.name !== "mine")) return;
    if (view.name === "mine" && !account.user) {
      list = null;
      return;
    }
    if (view.name === "browse" && !trust.length) {
      list = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE };
      return;
    }
    loading = true;
    error = "";
    try {
      const r = await account.client.packs(
        view.name === "mine"
          ? { mine: true, pageSize: 50 }
          : { q, type, sort, trust: trust.length === TRUSTS.length ? undefined : trust, page, pageSize: PAGE_SIZE },
      );
      if (my !== seq) return;
      list = r;
      if (account.server !== "online") account.server = "online";
    } catch (e) {
      if (my !== seq) return;
      list = null;
      if (isConnectionError(e)) account.server = "unreachable";
      else if (!(await account.sessionLost(e))) error = cloudErrorText(e);
    } finally {
      if (my === seq) loading = false;
    }
  }
  $effect(() => {
    // Everything the list depends on.
    void [view.name, q, type, sort, trust.join(), page, account.url, account.user?.id];
    void load();
  });

  const installedIds = $derived(((store.shop.installedPacks ?? []) as { id: string }[]).map((p) => p.id));
  $effect(() => {
    const ids = installedIds;
    if (!account.url || !ids.length) {
      latest = {};
      return;
    }
    void account.client
      .packs({ ids, pageSize: 50 })
      .then((r) => (latest = Object.fromEntries(r.items.map((p) => [p.id, p.latestVersion]))))
      .catch(() => undefined);
  });
  const updates = $derived(
    ((store.shop.installedPacks ?? []) as { id: string; name: string; version: string }[]).filter((p) => latest[p.id] && latest[p.id] !== p.version),
  );

  const pages = $derived(list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1);
  const stars = (p: PackSummary): string => (p.rating.average === null ? "" : `★ ${store.tr.number(p.rating.average, 1)}`);
  const stateOf = (p: PackSummary): "none" | "installed" | "update" => {
    const i = installedPack(store.shop, p.id);
    return !i ? "none" : i.version !== p.latestVersion ? "update" : "installed";
  };
  function publish(): void {
    if (!account.user) account.open = true;
    else view = { name: "publish", mode: "new" };
  }
  function showMine(): void {
    if (!account.user) account.open = true;
    else view = { name: "mine" };
  }
</script>

<section class="cv">
  {#if view.name === "pack"}
    {#key view.id}
      <PackDetailView
        id={view.id}
        onBack={() => (view = { name: "browse" })}
        onOpen={(id) => (view = { name: "pack", id })}
        onPublish={(mode, pack) => (view = { name: "publish", mode, pack })}
        onGone={() => { note = t("cloud.pack.unpublished"); view = { name: "browse" }; }}
      />
    {/key}
  {:else if view.name === "publish"}
    <PackPublish
      mode={view.mode}
      pack={view.pack}
      onDone={(id) => { note = ""; view = { name: "pack", id }; }}
      onCancel={() => (view = view.name === "publish" && view.pack ? { name: "pack", id: view.pack.id } : { name: "browse" })}
    />
  {:else}
    <div class="top">
      <h1>{t("cloud.community")}</h1>
      <div class="c-row">
        <button aria-pressed={view.name === "browse"} onclick={() => (view = { name: "browse" })}>{t("cloud.browse")}</button>
        <button aria-pressed={view.name === "mine"} onclick={showMine}>{t("cloud.my_packs")}</button>
        <button class="primary" onclick={publish} disabled={!account.url}>{t("cloud.publish_pack")}</button>
      </div>
    </div>

    {#if !account.url}
      <div class="c-notice">
        <strong>{t("cloud.no_server_title")}</strong>
        <p>{t("cloud.no_server")}</p>
        <div class="c-row"><button class="primary" onclick={() => (account.open = true)}>{t("cloud.set_server")}</button></div>
      </div>
    {:else}
      {#if account.server === "unreachable"}
        <div class="c-notice warn" role="status">
          <strong>{t("cloud.unreachable_title")}</strong>
          <p>{t("cloud.unreachable_text", { url: account.url })}</p>
          <div class="c-row"><button onclick={() => { void account.refresh(); void load(); }}>{t("cloud.retry")}</button></div>
        </div>
      {/if}
      {#if note}<p class="c-ok" role="status">{note}</p>{/if}
      {#if updates.length}
        <div class="c-notice">
          <strong>{t("cloud.updates_title", { n: updates.length })}</strong>
          <div class="c-row">
            {#each updates as u}
              <button onclick={() => (view = { name: "pack", id: u.id })}>{u.name || u.id} <span class="mono c-small">{u.version} → {latest[u.id]}</span></button>
            {/each}
          </div>
        </div>
      {/if}

      {#if view.name === "browse"}
        <div class="filters panel">
          <div class="c-line">
            <label class="c-grow">
              <span>{t("cloud.search")}</span>
              <input id="pack-search" type="text" inputmode="search" placeholder={t("cloud.search_hint")} bind:value={search} oninput={onSearch} />
            </label>
            <label>
              <span>{t("cloud.sort")}</span>
              <select id="pack-sort" value={sort} onchange={(e) => setFilter(() => (sort = (e.target as HTMLSelectElement).value as PackSort))}>
                <option value="newest">{t("cloud.sort.newest")}</option>
                <option value="downloads">{t("cloud.sort.downloads")}</option>
                <option value="rating">{t("cloud.sort.rating")}</option>
              </select>
            </label>
          </div>
          <div class="chips" role="group" aria-label={t("cloud.filter_type")}>
            <button aria-pressed={type === ""} onclick={() => setFilter(() => (type = ""))}>{t("cloud.all")}</button>
            {#each LIBRARY_KINDS as k}
              <button aria-pressed={type === k} onclick={() => setFilter(() => (type = k))}>{t(`cloud.kind.${k}`)}</button>
            {/each}
          </div>
          <div class="c-row" role="group" aria-label={t("cloud.filter_trust")}>
            <span class="muted c-small">{t("cloud.filter_trust")}</span>
            {#each TRUSTS as lv}
              <label class="trust"><input type="checkbox" value={lv} checked={trust.includes(lv)} onchange={(e) => setFilter(() => (trust = (e.target as HTMLInputElement).checked ? [...trust, lv] : trust.filter((x) => x !== lv)))} /> <span class="pill t-{lv}">{t(`cloud.trust.${lv}`)}</span></label>
            {/each}
          </div>
        </div>
      {/if}

      {#if view.name === "mine" && !account.user}
        <p class="c-notice">{t("cloud.sign_in_first")}</p>
      {:else if error}
        <div class="c-notice bad" role="alert">
          <p>{error}</p>
          <div class="c-row"><button onclick={load}>{t("cloud.retry")}</button></div>
        </div>
      {:else if list}
        <p class="muted c-small" role="status">
          {view.name === "mine" ? t("cloud.my_packs_count", { n: list.total }) : t("cloud.result_count", { n: list.total })}
        </p>
        {#if !list.items.length}
          <p class="muted empty">{t(view.name === "mine" ? "cloud.no_own_packs" : q || type || trust.length < 3 ? "cloud.no_results" : "cloud.no_packs")}</p>
        {/if}
        <ul class="cards">
          {#each list.items as p (p.id)}
            {@const st = stateOf(p)}
            <li>
              <button class="card panel" onclick={() => (view = { name: "pack", id: p.id })}>
                <span class="nm">{p.name}</span>
                <span class="c-row">
                  {#each p.types.slice(0, 3) as k}<span class="pill kind">{t(`cloud.kind.${k}`)}</span>{/each}
                  {#if p.types.length > 3}<span class="pill kind">+{p.types.length - 3}</span>{/if}
                  <span class="pill t-{p.trust}">{t(`cloud.trust.${p.trust}`)}</span>
                  {#if p.hidden}<span class="pill s-con">{t("cloud.pack.hidden")}</span>{/if}
                </span>
                <span class="muted desc">{p.description}</span>
                <span class="meta muted">
                  <span>{t("cloud.pack.by", { author: p.author.displayName })} · <span class="mono">{p.latestVersion}</span></span>
                  <span>
                    {#if st === "installed"}<span class="inst">✓ {t("cloud.installed")}</span>
                    {:else if st === "update"}<span class="upd">{t("cloud.update_available")}</span>
                    {:else}{stars(p)} {t("cloud.pack.installs", { n: p.downloads })}{/if}
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if view.name === "browse" && pages > 1}
          <div class="c-row pager">
            <button disabled={page <= 1} onclick={() => page--}>←</button>
            <span class="muted">{t("cloud.page", { page, pages })}</span>
            <button disabled={page >= pages} onclick={() => page++}>→</button>
          </div>
        {/if}
      {:else if loading}
        <p class="muted">{t("ui.loading")}</p>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .cv { max-width: 1240px; width: 100%; margin: 0 auto; padding: 16px max(16px, env(safe-area-inset-right, 0px)) 32px max(16px, env(safe-area-inset-left, 0px)); display: flex; flex-direction: column; gap: 12px; }
  .top { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
  h1 { margin: 0; font-size: 20px; }
  p { margin: 0; }
  .filters { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .trust { display: inline-flex; align-items: center; gap: 4px; }
  .cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px; }
  .card { width: 100%; height: 100%; text-align: left; padding: 12px; display: flex; flex-direction: column; gap: 8px; border-radius: 10px; }
  .nm { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
  .desc { font-size: 12px; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-top: auto; flex-wrap: wrap; }
  .inst { color: var(--ok); }
  .upd { color: var(--accent-fg); font-weight: 500; }
  .empty { padding: 24px 0; }
  .pager { justify-content: center; }
  @media (max-width: 700px) {
    .chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .chips button { white-space: nowrap; }
  }
</style>
