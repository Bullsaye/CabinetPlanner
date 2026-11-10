<script lang="ts">
  import { account, cloudErrorText } from "../lib/account.svelte.ts";
  import { LICENCES, type PackDetail } from "../lib/cloud.ts";
  import { LIBRARY_KINDS, applyInstall, installedPack, listItems, nextVersion, pickContent, prepareContent } from "../lib/packs.ts";
  import { store } from "../lib/store.svelte.ts";

  let {
    mode: modeProp,
    pack: packProp,
    onDone,
    onCancel,
  }: {
    /** new: first publication; fork: new pack based on another; version: new version; edit: description only. */
    mode: "new" | "fork" | "version" | "edit";
    pack?: PackDetail;
    onDone: (id: string) => void;
    onCancel: () => void;
  } = $props();

  const t = $derived(store.tr.t);
  // The parent creates this form anew for every task, so the props are read once.
  // svelte-ignore state_referenced_locally
  const mode = modeProp;
  // svelte-ignore state_referenced_locally
  const src = packProp;
  const withContent = mode !== "edit";
  const withMeta = mode !== "version";

  // A fork starts from the pack's items: they have to be in the library to be edited and republished.
  if (mode === "fork" && src && !installedPack(store.shop, src.id)) {
    applyInstall(store.shop, { id: src.id, version: src.latestVersion, name: src.name, trust: src.trust }, prepareContent(src.content, src.trust));
  }

  const mine = $derived(listItems(store.shop.library, store.ui.lang));
  const preselected = src && mode !== "new" ? new Set(listItems(src.content, "en").map((x) => `${x.kind}/${x.id}`)) : new Set<string>();
  let selected = $state<string[]>(listItems(store.shop.library, "en").map((x) => `${x.kind}/${x.id}`).filter((k) => preselected.has(k)));

  let name = $state(mode === "fork" ? store.tr.t("cloud.publish.fork_name", { name: src?.name ?? "" }) : (src?.name ?? ""));
  let description = $state(src?.description ?? "");
  let tags = $state((src?.tags ?? []).join(", "));
  let licence = $state(src?.licence ?? LICENCES[0]);
  let language = $state(src?.language ?? store.ui.lang);
  let tested = $state(mode === "edit" ? src?.trust !== "community" : false);
  let version = $state(mode === "version" && src ? nextVersion(src.latestVersion) : "1.0.0");
  let changelog = $state("");
  let agree = $state(false);
  let busy = $state(false);
  let error = $state("");
  let details = $state<string[]>([]);

  const title = $derived(t(`cloud.publish.title.${mode}`, { name: src?.name ?? "" }));
  const tagList = (): string[] => [...new Set(tags.split(/[,\s]+/).map((x) => x.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))];
  const canSubmit = $derived(!busy && (!withContent || (selected.length > 0 && agree)) && (!withMeta || name.trim().length >= 3));

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    busy = true;
    error = "";
    details = [];
    try {
      const meta = { name: name.trim(), description: description.trim(), tags: tagList(), licence, language, tested };
      const content = pickContent($state.snapshot(store.shop.library), selected);
      const c = account.client;
      const saved =
        mode === "edit"
          ? await c.editPack(src!.id, meta)
          : mode === "version"
            ? await c.publishVersion(src!.id, version.trim(), changelog.trim(), tested, content)
            : await c.publish(meta, version.trim(), changelog.trim(), content, mode === "fork" ? src!.id : undefined);
      onDone(saved.id);
    } catch (err) {
      if (await account.sessionLost(err)) {
        error = t("cloud.error.unauthorized");
        account.open = true;
      } else {
        error = cloudErrorText(err);
        const d = (err as { data?: { details?: { path: string; message: string }[] } }).data?.details;
        details = (d ?? []).slice(0, 6).map((x) => `${x.path}: ${x.message}`);
      }
    } finally {
      busy = false;
    }
  }
</script>

<form class="pp panel c-stack" onsubmit={submit}>
  <div class="modal-head">
    <h2>{title}</h2>
    <button type="button" class="quiet x" aria-label={t("ui.close")} onclick={onCancel}>×</button>
  </div>

  {#if withContent}
    <fieldset>
      <legend class="label">{t("cloud.publish.items")}</legend>
      <p class="muted c-small">{t("cloud.publish.items_hint")}</p>
      {#if !mine.length}
        <p class="c-notice">{t("cloud.publish.empty_library")}</p>
      {/if}
      {#each LIBRARY_KINDS as kind}
        {@const list = mine.filter((x) => x.kind === kind)}
        {#if list.length}
          <div class="kind">
            <span class="kname">{t(`cloud.kind.${kind}`)}</span>
            <div class="items">
              {#each list as it (it.id)}
                <label class="check"><input type="checkbox" value={`${it.kind}/${it.id}`} bind:group={selected} /> <span>{it.name} <span class="muted mono c-small">{it.id}</span></span></label>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </fieldset>
  {/if}

  {#if withMeta}
    <label><span>{t("cloud.publish.name")}</span><input id="pack-name" type="text" minlength="3" maxlength="80" required bind:value={name} /></label>
    <label><span>{t("cloud.publish.description")}</span><textarea id="pack-description" rows="3" maxlength="2000" placeholder={t("cloud.publish.description_hint")} bind:value={description}></textarea></label>
    <label><span>{t("cloud.publish.tags")}</span><input id="pack-tags" type="text" autocapitalize="off" placeholder={t("cloud.publish.tags_hint")} bind:value={tags} /></label>
    <div class="c-line">
      <label class="c-grow">
        <span>{t("cloud.publish.licence")}</span>
        <select id="pack-licence" bind:value={licence}>
          {#each LICENCES as l}<option value={l}>{l}</option>{/each}
        </select>
      </label>
      <label class="c-grow">
        <span>{t("cloud.publish.language")}</span>
        <select id="pack-language" bind:value={language}>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </label>
    </div>
    <p class="muted c-small">{t(`cloud.licence.${licence}`)}</p>
  {/if}

  {#if withContent}
    <div class="c-line">
      <label class="ver"><span>{t("cloud.publish.version")}</span><input id="pack-version" class="mono" type="text" required pattern={"\\d+(\\.\\d+){0,2}(-[0-9A-Za-z.]+)?"} bind:value={version} /></label>
      <label class="c-grow"><span>{t("cloud.publish.changelog")}</span><input id="pack-changelog" type="text" maxlength="2000" placeholder={t(mode === "version" ? "cloud.publish.changelog_hint" : "cloud.publish.changelog_first")} bind:value={changelog} /></label>
    </div>
    {#if mode === "version" && src}<p class="muted c-small">{t("cloud.publish.version_hint", { version: src.latestVersion })}</p>{/if}
  {/if}

  <label class="check"><input id="pack-tested" type="checkbox" bind:checked={tested} /> <span>{t("cloud.publish.tested")}</span></label>
  {#if withContent}
    <label class="check"><input id="pack-agree" type="checkbox" bind:checked={agree} /> <span>{t("cloud.publish.agree", { licence })}</span></label>
  {/if}

  {#if error}
    <div class="c-notice bad" role="alert">
      <p>{error}</p>
      {#if details.length}<ul class="mono c-small">{#each details as d}<li>{d}</li>{/each}</ul>{/if}
    </div>
  {/if}
  <div class="c-row">
    <button type="submit" class="primary" disabled={!canSubmit}>{t(mode === "edit" ? "ui.save" : mode === "version" ? "cloud.publish.submit_version" : "cloud.publish.submit")}</button>
    <button type="button" class="quiet" onclick={onCancel}>{t("ui.cancel")}</button>
    {#if withContent}<span class="muted c-small">{t("cloud.publish.selected", { n: selected.length })}</span>{/if}
  </div>
</form>

<style>
  .pp { padding: 16px; max-width: 760px; }
  fieldset { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  legend { padding: 0 4px; }
  p { margin: 0; }
  .kind { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 8px; align-items: start; }
  .kname { font-weight: 500; padding-top: 2px; }
  .items { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .items span { overflow-wrap: anywhere; }
  .ver { width: 9em; }
  ul { margin: 0; padding-left: 18px; overflow-wrap: anywhere; }
  select { width: 100%; }
  @media (max-width: 700px) { .kind { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
  @media (pointer: coarse) { .check { min-height: 36px; } }
</style>
