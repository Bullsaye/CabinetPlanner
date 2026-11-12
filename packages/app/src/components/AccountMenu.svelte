<script lang="ts">
  import { account, cloudCodeText, cloudErrorText } from "../lib/account.svelte.ts";
  import { download, downloadNote, store } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  let mode = $state<"signin" | "register">("signin");
  let email = $state("");
  let password = $state("");
  let displayName = $state("");
  let busy = $state(false);
  let error = $state("");
  let note = $state("");

  let urlInput = $state("");
  let urlError = $state("");
  let urlNote = $state("");
  let editUrl = $state(false);

  let newName = $state("");
  let currentPw = $state("");
  let newPw = $state("");
  let deletePw = $state("");
  let confirmDelete = $state(false);

  $effect(() => {
    if (account.open) {
      error = note = urlError = urlNote = "";
      urlInput = account.url;
      newName = account.user?.displayName ?? "";
      editUrl = !account.url;
      confirmDelete = false;
    }
  });

  /** Runs a server call with the busy flag; the error text lands in `error`. */
  async function run(f: () => Promise<void>, done = ""): Promise<boolean> {
    busy = true;
    error = note = "";
    try {
      await f();
      note = done;
      return true;
    } catch (e) {
      if (!(await account.sessionLost(e))) error = cloudErrorText(e);
      else error = t("cloud.error.invalid_token");
      return false;
    } finally {
      busy = false;
    }
  }

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    const ok = await run(() => (mode === "signin" ? account.signIn(email.trim(), password) : account.register(email.trim(), password, displayName.trim())));
    if (ok) {
      password = "";
      newName = account.user?.displayName ?? "";
    }
  }
  async function saveUrl(e: Event): Promise<void> {
    e.preventDefault();
    busy = true;
    urlError = urlNote = "";
    try {
      await account.setUrl(urlInput);
      urlInput = account.url;
      urlNote = account.url ? t("cloud.server_ok") : "";
      editUrl = !account.url;
    } catch (err) {
      urlError = cloudErrorText(err);
    } finally {
      busy = false;
    }
  }
  async function changePassword(e: Event): Promise<void> {
    e.preventDefault();
    if (await run(() => account.changePassword(currentPw, newPw), t("cloud.password_changed"))) currentPw = newPw = "";
  }
  async function deleteAccount(e: Event): Promise<void> {
    e.preventDefault();
    if (await run(() => account.deleteAccount(deletePw), t("cloud.account_deleted"))) {
      deletePw = "";
      confirmDelete = false;
    }
  }
  async function downloadConflict(): Promise<void> {
    const c = account.conflict;
    if (!c) return;
    const name = `shop-conflict-${new Date(c.at).toISOString().slice(0, 10)}.json`;
    note = downloadNote(await download(name, JSON.stringify(c.doc, null, 2) + "\n", "application/json"), name, t);
  }

  const when = (ms: number): string => new Intl.DateTimeFormat(store.ui.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  const syncText = $derived(
    account.sync.state === "syncing"
      ? t("cloud.sync.syncing")
      : account.sync.state === "offline"
        ? t("cloud.sync.offline")
        : account.sync.state === "error"
          ? t("cloud.sync.error", { error: cloudCodeText(account.sync.error ?? "unknown") })
          : account.sync.at
            ? t("cloud.sync.synced", { time: when(account.sync.at) })
            : t("cloud.sync.idle"),
  );
  const dot = $derived(!account.user ? "" : account.sync.state === "error" || account.conflict ? "warn" : account.sync.state === "offline" ? "off" : "ok");
</script>

<button class="acct" aria-haspopup="dialog" title={account.user ? `${t("cloud.account")} · ${syncText}` : t("cloud.sign_in")} onclick={() => (account.open = true)}>
  {#if account.user}
    <span class="dot {dot}" aria-hidden="true"></span><span class="who">{account.user.displayName}</span>
  {:else}
    {t("cloud.sign_in")}
  {/if}
</button>

{#if account.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="modal-scrim" onclick={(e) => { if (e.target === e.currentTarget) account.open = false; }}>
    <div class="modal panel" role="dialog" aria-modal="true" aria-labelledby="acct-title">
      <div class="modal-head">
        <h2 id="acct-title">{t("cloud.account")}</h2>
        <button class="quiet x" aria-label={t("ui.close")} onclick={() => (account.open = false)}>×</button>
      </div>

      {#if account.user}
        <p class="who-line"><strong>{account.user.displayName}</strong> <span class="muted">{account.user.email}</span>{#if account.user.isAdmin} <span class="pill t-verified">{t("cloud.admin")}</span>{/if}</p>

        <section>
          <h3 class="label">{t("cloud.sync.title")}</h3>
          <p class="muted" role="status">{syncText}</p>
          <div class="c-row">
            <button onclick={() => account.syncShop()} disabled={account.sync.state === "syncing"}>{t("cloud.sync.now")}</button>
          </div>
          {#if account.conflict}
            <div class="c-notice warn">
              <strong>{t("cloud.conflict.title")}</strong>
              <p>{t(account.conflict.source === "server" ? "cloud.conflict.server_kept" : "cloud.conflict.device_kept", { time: when(account.conflict.at) })}</p>
              <div class="c-row">
                <button onclick={downloadConflict}>{t("cloud.conflict.download")}</button>
                <button onclick={() => account.restoreConflict()}>{t("cloud.conflict.restore")}</button>
                <button class="quiet" onclick={() => account.discardConflict()}>{t("cloud.conflict.discard")}</button>
              </div>
            </div>
          {/if}
        </section>

        <section>
          <h3 class="label">{t("cloud.profile")}</h3>
          <form class="c-line" onsubmit={(e) => { e.preventDefault(); void run(() => account.setDisplayName(newName.trim()), t("cloud.name_changed")); }}>
            <label class="c-grow"><span>{t("cloud.display_name")}</span><input id="acct-name" type="text" bind:value={newName} minlength="2" maxlength="40" required /></label>
            <button type="submit" disabled={busy || newName.trim() === account.user.displayName}>{t("ui.save")}</button>
          </form>
          <details>
            <summary>{t("cloud.change_password")}</summary>
            <form class="c-stack" onsubmit={changePassword}>
              <label><span>{t("cloud.current_password")}</span><input id="acct-current-pw" type="password" autocomplete="current-password" bind:value={currentPw} required /></label>
              <label><span>{t("cloud.new_password")}</span><input id="acct-new-pw" type="password" autocomplete="new-password" minlength="10" bind:value={newPw} required /></label>
              <div class="c-row"><button type="submit" disabled={busy}>{t("cloud.change_password")}</button></div>
            </form>
          </details>
        </section>

        {#if error}<p class="c-err" role="alert">{error}</p>{/if}
        {#if note}<p class="c-ok" role="status">{note}</p>{/if}

        <section class="c-row c-end">
          <button onclick={() => run(() => account.signOut())} disabled={busy}>{t("cloud.sign_out")}</button>
          <span class="c-sp"></span>
          {#if !confirmDelete}
            <button class="quiet c-danger" onclick={() => (confirmDelete = true)}>{t("cloud.delete_account")}</button>
          {/if}
        </section>
        {#if confirmDelete}
          <form class="c-notice bad c-stack" onsubmit={deleteAccount}>
            <p>{t("cloud.delete_account_hint")}</p>
            <label><span>{t("cloud.password")}</span><input id="acct-delete-pw" type="password" autocomplete="current-password" bind:value={deletePw} required /></label>
            <div class="c-row">
              <button type="submit" class="c-danger" disabled={busy}>{t("cloud.delete_account_confirm")}</button>
              <button type="button" class="quiet" onclick={() => (confirmDelete = false)}>{t("ui.cancel")}</button>
            </div>
          </form>
        {/if}
      {:else}
        <p class="muted">{t("cloud.intro")}</p>
        {#if !account.url}
          <p class="c-notice">{t("cloud.no_server")}</p>
        {:else}
         <div class="tabs" role="group">
            <button aria-pressed={mode === "signin"} onclick={() => { mode = "signin"; error = ""; }}>{t("cloud.sign_in")}</button>
            <button aria-pressed={mode === "register"} onclick={() => { mode = "register"; error = ""; }}>{t("cloud.register")}</button>
          </div>
          <form class="c-stack" onsubmit={submit}>
            <label><span>{t("cloud.email")}</span><input id="acct-email" type="email" autocomplete="email" bind:value={email} required /></label>
            {#if mode === "register"}
              <label><span>{t("cloud.display_name")}</span><input id="acct-display-name" type="text" autocomplete="nickname" minlength="2" maxlength="40" bind:value={displayName} required /></label>
            {/if}
            <label>
              <span>{t("cloud.password")}</span>
              <input id="acct-password" type="password" autocomplete={mode === "signin" ? "current-password" : "new-password"} minlength={mode === "register" ? 10 : undefined} bind:value={password} required />
            </label>
            {#if mode === "register"}<p class="muted c-small">{t("cloud.password_hint")}</p>{/if}
            {#if error}<p class="c-err" role="alert">{error}</p>{/if}
            {#if note}<p class="c-ok" role="status">{note}</p>{/if}
            <div class="c-row">
              <button type="submit" class="primary" disabled={busy}>{t(mode === "signin" ? "cloud.sign_in" : "cloud.create_account")}</button>
            </div>
            {#if mode === "signin"}<p class="muted c-small">{t("cloud.forgot_password")}</p>{/if}
          </form>
        {/if}
      {/if}

      <section class="server">
        <h3 class="label">{t("cloud.server")}</h3>
        {#if editUrl}
          <form class="c-line" onsubmit={saveUrl}>
            <label class="c-grow">
              <span>{t("cloud.server_url")}</span>
              <input id="acct-server" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="https://… / http://192.168.1.23:8787" bind:value={urlInput} />
            </label>
            <button type="submit" disabled={busy}>{t("cloud.connect")}</button>
          </form>
          {#if account.user}<p class="muted c-small">{t("cloud.server_change_hint")}</p>{/if}
          {#if account.defaultUrl && urlInput !== account.defaultUrl}
            <button class="quiet c-small" onclick={() => (urlInput = account.defaultUrl)}>{t("cloud.server_default", { url: account.defaultUrl })}</button>
          {/if}
        {:else}
          <p class="srv">
            <span class="mono">{account.url}</span>
            <span class="muted">· {t(`cloud.server_status.${account.server}`)}</span>
            <button class="quiet c-small" onclick={() => (editUrl = true)}>{t("cloud.change")}</button>
            {#if account.server === "unreachable"}<button class="quiet c-small" onclick={() => account.refresh()}>{t("cloud.retry")}</button>{/if}
          </p>
        {/if}
        {#if urlError}<p class="c-err" role="alert">{urlError}</p>{/if}
        {#if urlNote}<p class="c-ok" role="status">{urlNote}</p>{/if}
      </section>
    </div>
  </div>
{/if}

<style>
  .acct { display: inline-flex; align-items: center; gap: 6px; max-width: 14em; }
  .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.ok { background: var(--ok); }
  .dot.warn { background: var(--warn); }
  h3 { margin: 0 0 4px; }
  section { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line); padding-top: 10px; }
  section.c-row { flex-direction: row; }
  .who-line { margin: 0; overflow-wrap: anywhere; }
  .tabs { display: flex; gap: 4px; }
  .srv { margin: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; overflow-wrap: anywhere; }
  details summary { cursor: pointer; padding: 4px 0; }
  p { margin: 0; }
  @media (max-width: 700px) { .acct { max-width: 8em; } }
</style>
