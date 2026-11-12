<script lang="ts">
  import type { CabinetPlacement } from "@cabinet-planner/engine";
  import { parseInput, store } from "../lib/store.svelte.ts";
  import RoomPlan from "./RoomPlan.svelte";

  const t = $derived(store.tr.t);
  const room = $derived(store.project.room as Record<string, any> | undefined);
  const layout = $derived(store.result?.room);

  function createRoom(): void {
    store.project.room = {
      walls: [
        { id: "A", length: 3600 },
        { id: "B", length: 2400 },
        { id: "C", length: 3600 },
        { id: "D", length: 2400 },
      ],
      openings: [],
    };
    for (const c of store.project.cabinets ?? []) c.place ??= { wall: "A" };
  }
  // Working without a room (D68): the cabinets stay, in a simple run; their places are kept for a later room.
  let confirmRemove = $state(false);
  function removeRoom(): void {
    delete store.project.room;
    confirmRemove = false;
  }
  function nextWallId(): string {
    const used = new Set((room?.walls ?? []).map((w: any) => w.id));
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(ch)) return ch;
    return `W${used.size + 1}`;
  }
  const setNum = (obj: Record<string, any>, key: string, text: string, keepEmpty = false): void => {
    const v = parseInput(text);
    if (v === undefined && !keepEmpty) delete obj[key];
    else obj[key] = v ?? 0;
  };
  const placed = (id: string): CabinetPlacement | undefined => layout?.placements.find((p) => p.cabinet === id);
</script>

<section class="panel rv">
  {#if !room}
    <div class="empty">
      <p>{t("ui.room_none")}</p>
      <p class="muted">{t("ui.room_none_run")}</p>
      <button class="primary" onclick={createRoom}>{t("ui.room_create")}</button>
    </div>
  {:else}
    <div class="cols">
      <RoomPlan />
      <div class="edit">
        <div class="row">
          {#if confirmRemove}
            <span role="alert">{t("ui.room_remove_confirm")}</span>
            <button class="danger" onclick={removeRoom}>{t("ui.room_remove_yes")}</button>
            <button onclick={() => (confirmRemove = false)}>{t("ui.cancel")}</button>
          {:else}
            <button onclick={() => (confirmRemove = true)}>{t("ui.room_remove")}</button>
          {/if}
        </div>
        <h2 class="label">{t("ui.walls")}</h2>
        <p class="hint muted">{t("ui.walls_hint")}</p>
        <table class="grid">
          <thead><tr><th>{t("ui.wall")}</th><th>{t("ui.length")}</th><th>{t("ui.height")}</th><th>{t("ui.thickness")}</th><th>{t("ui.turn")}</th><th></th></tr></thead>
          <tbody>
            {#each room.walls as w, i}
              <tr>
                <td class="mono">{w.id}</td>
                <td><input id={`wall-len-${i}`} class="mono" type="text" value={w.length} onchange={(e) => setNum(w, "length", (e.target as HTMLInputElement).value, true)} /></td>
                <td><input id={`wall-h-${i}`} class="mono" type="text" value={w.height ?? ""} placeholder={String(layout?.walls[i]?.height ?? "")} onchange={(e) => setNum(w, "height", (e.target as HTMLInputElement).value)} /></td>
                <td><input id={`wall-t-${i}`} class="mono" type="text" value={w.thickness ?? ""} placeholder="100" onchange={(e) => setNum(w, "thickness", (e.target as HTMLInputElement).value)} /></td>
                <td>
                  <select id={`wall-turn-${i}`} value={w.turn ?? "right"} onchange={(e) => (w.turn = (e.target as HTMLSelectElement).value)}>
                    <option value="right">{t("ui.turn_right")}</option>
                    <option value="left">{t("ui.turn_left")}</option>
                  </select>
                </td>
                <td><button class="quiet" aria-label={t("ui.delete")} disabled={room.walls.length <= 1} onclick={() => room.walls.splice(i, 1)}>×</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="row">
          <button onclick={() => room.walls.push({ id: nextWallId(), length: 1200 })}>{t("ui.add_wall")}</button>
          <span class="muted small">{layout?.closed ? t("ui.room_closed") : t("ui.room_open")}</span>
        </div>

        <h2 class="label">{t("ui.openings")}</h2>
        <table class="grid">
          <thead><tr><th>{t("ui.wall")}</th><th>{t("ui.kind")}</th><th>x</th><th>{t("ui.width")}</th><th>{t("ui.sill")}</th><th>{t("ui.height")}</th><th></th></tr></thead>
          <tbody>
            {#each room.openings as o, i}
              <tr>
                <td>
                  <select id={`op-wall-${i}`} value={o.wall} onchange={(e) => (o.wall = (e.target as HTMLSelectElement).value)}>
                    {#each room.walls as w}<option value={w.id}>{w.id}</option>{/each}
                  </select>
                </td>
                <td>
                  <select id={`op-kind-${i}`} value={o.kind} onchange={(e) => (o.kind = (e.target as HTMLSelectElement).value)}>
                    {#each ["window", "door", "opening"] as k}<option value={k}>{t(`ui.opening.${k}`)}</option>{/each}
                  </select>
                </td>
                {#each ["x", "width", "sill", "height"] as key}
                  <td><input id={`op-${key}-${i}`} class="mono" type="text" value={o[key] ?? ""} onchange={(e) => setNum(o, key, (e.target as HTMLInputElement).value, true)} /></td>
                {/each}
                <td><button class="quiet" aria-label={t("ui.delete")} onclick={() => room.openings.splice(i, 1)}>×</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="row">
          <button onclick={() => room.openings.push({ wall: room.walls[0].id, kind: "window", x: 1000, width: 1000, sill: 900, height: 1300 })}>{t("ui.add_window")}</button>
          <button onclick={() => room.openings.push({ wall: room.walls[0].id, kind: "door", x: 300, width: 900, sill: 0, height: 2100 })}>{t("ui.add_door")}</button>
        </div>

        <h2 class="label">{t("ui.ceiling")}</h2>
        <p class="hint muted">{t("ui.ceiling_hint")}</p>
        <div class="row">
          <label for="ceil-h">{t("ui.ceiling_height")}</label>
          <input id="ceil-h" class="mono" type="text" placeholder={String(store.result?.room?.ceiling.height ?? "")} value={room.ceiling?.height ?? ""} onchange={(e) => { room.ceiling ??= { slopes: [] }; setNum(room.ceiling, "height", (e.target as HTMLInputElement).value); }} />
        </div>
        {#if room.ceiling?.slopes?.length}
          <table class="grid">
            <thead><tr><th>{t("ui.slope_from_wall")}</th><th>{t("ui.knee_height")}</th><th>{t("ui.angle")}</th><th></th></tr></thead>
            <tbody>
              {#each room.ceiling.slopes as sl, i}
                <tr>
                  <td>
                    <select id={`sl-wall-${i}`} value={sl.wall} onchange={(e) => (sl.wall = (e.target as HTMLSelectElement).value)}>
                      {#each room.walls as w}<option value={w.id}>{w.id}</option>{/each}
                    </select>
                  </td>
                  <td><input id={`sl-knee-${i}`} class="mono" type="text" value={sl.knee} onchange={(e) => setNum(sl, "knee", (e.target as HTMLInputElement).value, true)} /></td>
                  <td><input id={`sl-angle-${i}`} class="mono" type="text" value={sl.angle} onchange={(e) => setNum(sl, "angle", (e.target as HTMLInputElement).value, true)} /></td>
                  <td><button class="quiet" aria-label={t("ui.delete")} onclick={() => room.ceiling.slopes.splice(i, 1)}>×</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <div class="row">
          <button onclick={() => { room.ceiling ??= { slopes: [] }; room.ceiling.slopes ??= []; room.ceiling.slopes.push({ wall: room.walls[room.walls.length - 1].id, knee: 1000, angle: 45 }); }}>{t("ui.add_slope")}</button>
        </div>

        <h2 class="label">{t("ui.placement")}</h2>
        <p class="hint muted">{t("ui.placement_hint")}</p>
        <table class="grid">
          <thead><tr><th>{t("ui.cabinet")}</th><th>{t("ui.wall")}</th><th>{t("ui.position")}</th><th></th></tr></thead>
          <tbody>
            {#each store.project.cabinets ?? [] as c, i}
              <tr class:current={store.ui.selected === c.id}>
                <td><button class="quiet mono" aria-pressed={store.ui.selected === c.id} onclick={() => (store.ui.selected = c.id)}>{c.id}</button></td>
                <td>
                  <select id={`pl-wall-${i}`} value={c.place?.wall ?? room.walls[0].id} onchange={(e) => (c.place = { ...(c.place ?? {}), wall: (e.target as HTMLSelectElement).value })}>
                    {#each room.walls as w}<option value={w.id}>{w.id}</option>{/each}
                  </select>
                </td>
                <td>
                  <input
                    id={`pl-x-${i}`}
                    class="mono"
                    type="text"
                    value={c.place?.x ?? ""}
                    placeholder={placed(c.id) ? String(placed(c.id)!.x) : t("ui.auto")}
                    onchange={(e) => {
                      const v = parseInput((e.target as HTMLInputElement).value);
                      const p = { ...(c.place ?? { wall: room.walls[0].id }) };
                      if (v === undefined) delete p.x;
                      else p.x = v;
                      c.place = p;
                    }}
                  />
                </td>
                <td class="muted small">
                  {c.kind === "wall" ? t("ui.kind.wall") : t("ui.floor_unit")}
                  {#if c.place?.x !== undefined}
                    <button class="to-run" title={t("ui.arrange_to_run_hint")} onclick={() => (c.place = { wall: c.place.wall })}>{t("ui.arrange_to_run")}</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</section>

<style>
  .rv { padding: 12px; min-height: 460px; }
  .empty { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding: 16px; }
  .empty p { margin: 0; max-width: 60ch; }
  .danger { color: var(--err); border-color: var(--err); }
  .cols { display: flex; flex-direction: column; gap: 16px; }
  tr.current td { background: var(--accent-soft); }
  .to-run { margin-left: 6px; padding: 2px 8px; font-size: 12px; }
  .edit { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  h2 { margin: 8px 0 0; }
  .hint { margin: 0; font-size: 12px; }
  .small { font-size: 12px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  td input { width: 64px; }
  td select { max-width: 110px; }
</style>
