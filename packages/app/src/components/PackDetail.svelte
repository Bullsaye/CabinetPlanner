<script lang="ts">
  import { account, cloudErrorText } from "../lib/account.svelte.ts";
  import { isConnectionError, type PackDetail } from "../lib/cloud.ts";
  import { applyInstall, installedPack, listItems, planInstall, prepareContent, renameItems, renamesFor, uninstall, type InstallPlan, type ItemRef } from "../lib/packs.ts";
  import { download, downloadNote, store } from "../lib/store.svelte.ts";

  let {
    id,
    onBack,
    onOpen,
    onPublish,
    onGone,
  }: {
    id: string;
    onBack: () => void;
    onOpen: (id: string) => void;
    onPublish: (mode: "version" | "edit" | "fork", pack: PackDetail) => void;
    onGone: () => void;
  } = $props();

  const t = $derived(store.tr.t);
  let pack = $state<PackDetail | null>(null);
  let loading = $state(true);
  let error = $state("");
  let note = $state("");
  let actionError = $state("");
  let busy = $state(false);
  /** Install waiting for the user's answer about items that differ. */
  let pending = $state<InstallPlan | null>(null);
  let reporting = $state(false);
  let reason = $state("");
  let confirmUnpublish = $state(false);

  async function load(): Promise<void> {
    loading = true;
    error = "";
    try {
      pack = await account.client.pack(id);
    } catch (e) {
      pack = null;
      error = cloudErrorText(e);
      if (isConnectionError(e)) account.server = "unreachable";
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void id;
    void account.user?.id;
    void load();
  });

  const installed = $derived(installedPack(store.shop, id));
  /** Items the user took under another id at an earlier install keep that id. */
  const renames = $derived(($state.snapshot(installed?.renames) ?? {}) as Record<string, string>);
  const content = $derived(pack ? prepareContent(pack.content, pack.trust, renames) : {});
  const items = $derived(listItems(content, store.ui.lang));
  const plan = $derived(pack ? planInstall($state.snapshot(store.shop), content, store.ui.lang) : null);
  const updateAvailable = $derived(!!installed && !!pack && installed.version !== pack.latestVersion);
  const untestedHardware = $derived(!!pack && pack.trust === "community" && (pack.counts.hardware ?? 0) > 0);
  const statusOf = (ref: ItemRef): "new" | "update" | "conflict" | "same" => {
    const has = (list: ItemRef[] | undefined): boolean => !!list?.some((x) => x.kind === ref.kind && x.id === ref.id);
    return has(plan?.added) ? "new" : has(plan?.updated) ? "update" : has(plan?.conflicts) ? "conflict" : "same";
  };
  const date = (ms: number): string => new Intl.DateTimeFormat(store.ui.lang, { dateStyle: "medium" }).format(new Date(ms));
  const stars = (avg: number | null): string => (avg === null ? "–" : store.tr.number(avg, 1));

  /** Runs a server call; a lost session or a failure ends as text under the actions. */
  async function act(f: () => Promise<void>): Promise<void> {
    busy = true;
    actionError = note = "";
    try {
      await f();
    } catch (e) {
      actionError = (await account.sessionLost(e)) ? t("cloud.error.unauthorized") : cloudErrorText(e);
    } finally {
      busy = false;
    }
  }

  function install(): void {
    if (!pack || !plan) return;
    actionError = note = "";
    if (plan.conflicts.length) pending = plan;
    else doInstall("replace");
  }
  /** replace: the pack's items take the place of own ones; mine: own ones stay; both: the pack's items get a new id. */
  function doInstall(how: "replace" | "mine" | "both"): void {
    const p = pack;
    if (!p) return;
    const clashes = pending?.conflicts ?? [];
    pending = null;
    const keepMine = how === "mine" ? clashes : [];
    const added = how === "both" ? renamesFor($state.snapshot(store.shop), content, clashes, p.id.slice(0, 4).toLowerCase().replace(/[^a-z0-9]/g, "x")) : {};
    // Renames are recorded against the ids the author uses.
    const original = Object.fromEntries(Object.entries(renames).map(([from, to]) => [`${from.split("/")[0]}/${to}`, from]));
    const all = { ...renames };
    for (const [k, to] of Object.entries(added)) all[original[k] ?? k] = to;
    applyInstall(store.shop, { id: p.id, version: p.latestVersion, name: p.name, trust: p.trust }, renameItems(content, added), keepMine.map((x) => `${x.kind}/${x.id}`), all);
    note = t("cloud.pack.installed_note", { name: p.name, n: items.length - keepMine.length });
    // Count the install; the library is already updated, so a failure here does not matter.
    void account.client
      .installed(p.id, p.latestVersion)
      .then((r) => {
        if (pack?.id === p.id) pack.downloads = r.downloads;
      })
      .catch(() => undefined);
  }
  function remove(): void {
    const kept = uninstall(store.shop, id);
    note = kept.length ? t("cloud.pack.uninstalled_kept", { ids: kept.join(", ") }) : t("cloud.pack.uninstalled");
  }
  const rate = (n: number): Promise<void> =>
    act(async () => {
      const r = await account.client.rate(id, n);
      if (pack) {
        pack.rating = r.rating;
        pack.myRating = r.myRating;
      }
    });
  const sendReport = (e: Event): Promise<void> => {
    e.preventDefault();
    return act(async () => {
      await account.client.report(id, reason.trim());
      reason = "";
      reporting = false;
      note = t("cloud.pack.report_sent");
    });
  };
  const unpublish = (): Promise<void> =>
    act(async () => {
      await account.client.unpublish(id);
      onGone();
    });
  const adminSet = (change: { hidden?: boolean; verified?: boolean }): Promise<void> =>
    act(async () => {
      await account.client.adminSetPack(id, change);
      await load();
    });
  async function downloadFile(): Promise<void> {
    if (!pack) return;
    const name = `${pack.name.replace(/[^\w.-]+/g, "-").toLowerCase()}-${pack.latestVersion}.pack.json`;
    const file = { kind: "pack", name: pack.name, version: pack.latestVersion, author: pack.author.displayName, licence: pack.licence, source: `${account.url}/api/packs/${pack.id}`, content: pack.content };
    note = downloadNote(await download(name, JSON.stringify(file, null, 2) + "\n", "application/json"), name, t);
  }
</script>

<div class="pd">
  <button class="quiet back" onclick={onBack}>← {t("cloud.community")}</button>
  {#if loading && !pack}
    <p class="muted">{t("ui.loading")}</p>
  {:else if !pack}
    <div class="c-notice bad" role="alert">
      <p>{error}</p>
      <div class="c-row"><button onclick={load}>{t("cloud.retry")}</button></div>
    </div>
  {:else}
    <div class="cols">
      <div class="main">
        <header class="panel head">
          <div class="c-row">
            {#each pack.types as k}<span class="pill kind">{t(`cloud.kind.${k}`)} · {pack.counts[k]}</span>{/each}
            <span class="pill t-{pack.trust}">{t(`cloud.trust.${pack.trust}`)}</span>
            <span class="pill t-community">{pack.licence}</span>
            {#if pack.hidden}<span class="pill s-con">{t("cloud.pack.hidden")}</span>{/if}
          </div>
          <h2>{pack.name}</h2>
          <p class="muted c-small">
            {t("cloud.pack.by", { author: pack.author.displayName })} · {t("cloud.pack.version", { version: pack.latestVersion })} · {t("cloud.pack.updated", { date: date(pack.updatedAt) })} ·
            {t("cloud.pack.installs", { n: pack.downloads })} · ★ {stars(pack.rating.average)} ({pack.rating.count})
          </p>
          {#if pack.description}<p class="desc">{pack.description}</p>{/if}
          {#if pack.tags.length}<p class="c-row">{#each pack.tags as tag}<span class="pill t-community">#{tag}</span>{/each}</p>{/if}
          {#if pack.forkedFrom}
            <p class="muted c-small">
              {t("cloud.pack.forked_from")}
              {#if pack.forkedFrom.name}<button class="quiet link" onclick={() => onOpen(pack!.forkedFrom!.id)}>{pack.forkedFrom.name}</button>{:else}{t("cloud.pack.fork_gone")}{/if}
            </p>
          {/if}
        </header>

        <section class="panel sec" aria-label={t("cloud.pack.contents")}>
          <div class="c-row"><h3 class="label">{t("cloud.pack.contents_compared")}</h3><span class="c-sp"></span><span class="muted c-small">{t("cloud.pack.item_count", { n: items.length })}</span></div>
          <div class="scroll-x">
            <table class="grid">
              <thead><tr><th>{t("cloud.pack.col_item")}</th><th>{t("cloud.pack.col_type")}</th><th>{t("cloud.pack.col_status")}</th></tr></thead>
              <tbody>
                {#each items as it (it.kind + "/" + it.id)}
                  {@const st = statusOf(it)}
                  <tr>
                    <td class="wrap">{it.name} <span class="muted mono c-small">{it.id}</span></td>
                    <td>{t(`cloud.item.${it.kind}`)}</td>
                    <td><span class="pill {st === 'new' ? 's-new' : st === 'conflict' ? 's-con' : st === 'update' ? 's-upd' : 't-community'}">{t(`cloud.pack.status.${st}`)}</span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <div class="two">
          <section class="panel sec">
            <h3 class="label">{t("cloud.pack.trust_title")}</h3>
            <p><span class="pill t-{pack.trust}">{t(`cloud.trust.${pack.trust}`)}</span> {t(`cloud.trust.${pack.trust}.hint`)}</p>
            <p class="muted c-small">{pack.openReports ? t("cloud.pack.open_reports", { n: pack.openReports }) : t("cloud.pack.no_reports")}</p>
          </section>
          <section class="panel sec">
            <h3 class="label">{t("cloud.pack.licence_title")}</h3>
            <p>{t(`cloud.licence.${pack.licence}`)}</p>
            <p class="muted c-small">{t("cloud.pack.cad_note")}</p>
          </section>
        </div>

        <section class="panel sec">
          <h3 class="label">{t("cloud.pack.changelog")}</h3>
          <dl class="log">
            {#each pack.versions as v}
              <dt class="mono">{v.version}</dt>
              <dd>{v.changelog || "–"} <span class="muted c-small">· {date(v.createdAt)}</span></dd>
            {/each}
          </dl>
        </section>
      </div>

      <aside class="side">
        <section class="panel sec">
          <h3 class="label">{t("cloud.pack.install_title")}</h3>
          {#if installed}
            <p class="c-ok">✓ {t("cloud.pack.installed_version", { version: installed.version })}</p>
          {/if}
          {#if untestedHardware}
            <div class="c-notice warn">
              <strong>{t("cloud.pack.untested_title")}</strong>
              <p>{t("cloud.pack.untested_text")}</p>
            </div>
          {/if}
          {#if pending}
            <div class="c-notice warn" role="alertdialog" aria-label={t("cloud.pack.replace_title")}>
              <strong>{t("cloud.pack.replace_title")}</strong>
              <p>{t("cloud.pack.replace_text")}</p>
              <ul class="ids">
                {#each pending.conflicts as c}<li>{c.name} <span class="muted mono c-small">{t(`cloud.item.${c.kind}`)} · {c.id}</span></li>{/each}
              </ul>
              <div class="c-row">
                <button class="primary" onclick={() => doInstall("both")}>{t("cloud.pack.keep_both")}</button>
                <button onclick={() => doInstall("mine")}>{t("cloud.pack.keep_mine")}</button>
                <button onclick={() => doInstall("replace")}>{t("cloud.pack.replace_mine")}</button>
                <button class="quiet" onclick={() => (pending = null)}>{t("ui.cancel")}</button>
              </div>
            </div>
          {:else}
            <button class="primary big" onclick={install} disabled={!!installed && !updateAvailable && !plan?.added.length && !plan?.updated.length && !plan?.conflicts.length}>
              {#if updateAvailable}{t("cloud.pack.update_to", { version: pack.latestVersion })}{:else if installed}{t("cloud.pack.reinstall")}{:else}{t("cloud.pack.install", { n: items.length })}{/if}
            </button>
          {/if}
          <p class="muted c-small">{t("cloud.pack.install_hint")}</p>
          {#if note}<p class="c-ok" role="status">{note}</p>{/if}
          {#if actionError}<p class="c-err" role="alert">{actionError}</p>{/if}
          <div class="c-row">
            {#if installed}<button onclick={remove}>{t("cloud.pack.uninstall")}</button>{/if}
            <button onclick={() => (account.user ? onPublish("fork", pack!) : (account.open = true))}>{t("cloud.pack.fork")}</button>
            <button onclick={downloadFile}>{t("cloud.pack.download")}</button>
          </div>
        </section>

        <section class="panel sec">
          <h3 class="label">{t("cloud.pack.rate_title")}</h3>
          {#if !account.user}
            <p class="muted c-small">{t("cloud.pack.sign_in_to_rate")} <button class="quiet link" onclick={() => (account.open = true)}>{t("cloud.sign_in")}</button></p>
          {:else if pack.isOwner}
            <p class="muted c-small">{t("cloud.pack.own_pack")}</p>
          {:else}
            <div class="stars" role="group" aria-label={t("cloud.pack.rate_title")}>
              {#each [1, 2, 3, 4, 5] as n}
                <button class="quiet star" class:on={(pack.myRating ?? 0) >= n} aria-pressed={pack.myRating === n} aria-label={t("cloud.pack.stars", { n })} disabled={busy} onclick={() => rate(n)}>★</button>
              {/each}
            </div>
            {#if pack.myRating}<p class="muted c-small">{t("cloud.pack.your_rating", { n: pack.myRating })}</p>{/if}
            {#if reporting}
              <form class="c-stack" onsubmit={sendReport}>
                <label><span>{t("cloud.pack.report_reason")}</span><textarea id="report-reason" rows="3" minlength="5" maxlength="2000" required bind:value={reason}></textarea></label>
                <div class="c-row">
                  <button type="submit" disabled={busy}>{t("cloud.pack.report_send")}</button>
                  <button type="button" class="quiet" onclick={() => (reporting = false)}>{t("ui.cancel")}</button>
                </div>
              </form>
            {:else}
              <button class="quiet link" onclick={() => (reporting = true)}>{t("cloud.pack.report")}</button>
            {/if}
          {/if}
        </section>

        {#if pack.isOwner || account.user?.isAdmin}
          <section class="panel sec">
            <h3 class="label">{t(pack.isOwner ? "cloud.pack.manage_title" : "cloud.admin")}</h3>
            <div class="c-row">
              {#if pack.isOwner}
                <button onclick={() => onPublish("version", pack!)}>{t("cloud.pack.new_version")}</button>
                <button onclick={() => onPublish("edit", pack!)}>{t("cloud.pack.edit")}</button>
              {/if}
              {#if confirmUnpublish}
                <button class="c-danger" disabled={busy} onclick={unpublish}>{t("cloud.pack.unpublish_confirm")}</button>
                <button class="quiet" onclick={() => (confirmUnpublish = false)}>{t("ui.cancel")}</button>
              {:else}
                <button class="quiet c-danger" onclick={() => (confirmUnpublish = true)}>{t("cloud.pack.unpublish")}</button>
              {/if}
            </div>
            {#if account.user?.isAdmin}
              <div class="c-row">
                <button disabled={busy} onclick={() => adminSet({ verified: pack!.trust !== "verified" })}>{t(pack.trust === "verified" ? "cloud.pack.unverify" : "cloud.pack.verify")}</button>
                <button disabled={busy} onclick={() => adminSet({ hidden: !pack!.hidden })}>{t(pack.hidden ? "cloud.pack.unhide" : "cloud.pack.hide")}</button>
              </div>
            {/if}
          </section>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .pd { display: flex; flex-direction: column; gap: 10px; }
  .back { align-self: flex-start; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 12px; align-items: start; }
  .main, .side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .sec, .head { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  h2 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
  h3 { margin: 0; }
  p { margin: 0; }
  .desc { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 70ch; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .wrap { white-space: normal; overflow-wrap: anywhere; }
  .log { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; }
  .log dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .big { padding: 9px 12px; font-weight: 500; }
  .ids { margin: 0; padding-left: 18px; }
  .link { padding: 0 2px; color: var(--accent-fg); text-decoration: underline; min-height: 0; }
  .stars { display: flex; gap: 2px; }
  .star { font-size: 22px; line-height: 1; padding: 2px 5px; color: var(--line); }
  .star.on { color: #d9960a; background: transparent; }
  @media (max-width: 900px) {
    /* One column: header, then install and rating, then the details. */
    .cols { display: flex; flex-direction: column; align-items: stretch; }
    .main, .side { display: contents; }
    .side > :global(*) { order: 1; }
    .main > :global(*) { order: 2; }
    .main > .head { order: 0; }
  }
  @media (max-width: 700px) { .two { grid-template-columns: minmax(0, 1fr); } }
</style>
