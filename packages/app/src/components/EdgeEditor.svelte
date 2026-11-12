<script lang="ts">
  /**
   * Editor for one edge of a part (D75): the edgeband and a short production
   * remark such as "45°". Plain form fields without a frame of their own, so
   * it fits a popover (cutlist) as well as a panel. It does not write to the
   * project itself: the host does, e.g. with lib/edges.ts.
   */
  import { store } from "../lib/store.svelte.ts";

  let {
    id,
    band,
    constructed,
    bands,
    note,
    onband,
    onnote,
  }: {
    /** Prefix for the field ids (unique on the page). */
    id: string;
    /** The override as stored: an edgeband id, null (bare edge) or undefined (as constructed). */
    band: string | null | undefined;
    /** Code of the edgeband the construction gives this edge ("" for none), shown in the default option when known. */
    constructed?: string;
    bands: readonly { id: string; code: string; name: string }[];
    note: string;
    onband: (band: string | null | undefined) => void;
    onnote: (text: string) => void;
  } = $props();

  const t = $derived(store.tr.t);
  const value = $derived(band === undefined ? "@default" : band === null ? "@none" : band);
</script>

<div class="ee">
  <label for={`${id}-band`}>{t("ui.edge_band")}</label>
  <select
    id={`${id}-band`}
    {value}
    onchange={(e) => {
      const v = (e.target as HTMLSelectElement).value;
      onband(v === "@default" ? undefined : v === "@none" ? null : v);
    }}
  >
    <option value="@default">{t("ui.edge_default")}{constructed !== undefined ? ` (${constructed || "–"})` : ""}</option>
    <option value="@none">{t("ui.edge_none")}</option>
    {#each bands as b (b.id)}<option value={b.id}>{b.code} · {b.name}</option>{/each}
  </select>
  <label for={`${id}-note`}>{t("ui.edge_note")}</label>
  <input id={`${id}-note`} type="text" maxlength="40" value={note} placeholder={t("ui.edge_note_hint")} onchange={(e) => onnote((e.target as HTMLInputElement).value)} />
  <p class="muted">{t("ui.edge_note_help")}</p>
</div>

<style>
  .ee { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 8px; align-items: center; }
  .ee select, .ee input { width: 100%; min-width: 0; }
  .ee p { grid-column: 1 / -1; margin: 0; font-size: 11px; }
</style>
