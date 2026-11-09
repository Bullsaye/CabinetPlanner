<script lang="ts">
  import { drawingText, floorPlanSvg, type CabinetPlacement } from "@cabinet-planner/engine";
  import { parseInput, store } from "../lib/store.svelte.ts";

  const t = $derived(store.tr.t);
  const room = $derived(store.project.room as Record<string, any> | undefined);
  const layout = $derived(store.result?.room);
  const plan = $derived(layout && store.result ? floorPlanSvg(layout, store.project.name, drawingText(store.tr, store.result.library), false) : "");

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
      <button class="primary" onclick={createRoom}>{t("ui.room_create")}</button>
    </div>
  {:else}
    <div class="cols">
      <div class="sheet plan">{@html plan}</div>
      <div class="edit">
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

        <h2 class="label">{t("ui.placement")}</h2>
        <p class="hint muted">{t("ui.placement_hint")}</p>
        <table class="grid">
          <thead><tr><th>{t("ui.cabinet")}</th><th>{t("ui.wall")}</th><th>{t("ui.position")}</th><th></th></tr></thead>
          <tbody>
            {#each store.project.cabinets ?? [] as c, i}
              <tr>
                <td class="mono">{c.id}</td>
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
                <td class="muted small">{c.kind === "wall" ? t("ui.kind.wall") : t("ui.floor_unit")}</td>
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
  .cols { display: flex; flex-direction: column; gap: 16px; }
  .plan :global(svg) { max-height: 62vh; }
  .edit { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  h2 { margin: 8px 0 0; }
  .hint { margin: 0; font-size: 12px; }
  .small { font-size: 12px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  td input { width: 64px; }
  td select { max-width: 110px; }
  .plan { min-width: 0; }
</style>
