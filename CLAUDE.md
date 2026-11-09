# Cabinet Planner – notes for Claude Code

Parametric planner for frameless 32 mm cabinets. Read `docs/PLAN.md` for the
product, `DECISIONS.md` for conventions that outputs depend on.

## Layout

- `packages/engine` – pure TypeScript engine. No DOM, no Node APIs, no UI
  text. Pipeline: presets → variables (expression graph) → cabinet rules →
  parts → machining (back pockets, joints, system holes, hardware) → checks
  → output writers. Hardware seed items are JSON in `packages/engine/library/hardware/`.
- `packages/i18n` – message catalogues (`en` base, `de` complete) and the
  translator.
- `packages/cli` – `cabinet-planner` command; the first client of the engine.
- `reference/` – reference cabinets with golden cutlists (byte-exact tests).
- `examples/` – example project and shop files.
- `design/` – UI mockups (visual reference only).

## Commands

```sh
pnpm install
pnpm test            # all tests
pnpm test -u         # regenerate golden files after an intended change; review the diff
pnpm typecheck
pnpm check           # typecheck + tests (what CI runs)
pnpm cp cutlist examples/kitchen-basic.project.json --shop examples/shop.json --format table --lang de
pnpm cp resolve examples/kitchen-basic.project.json --cabinet W01
pnpm cp ops examples/kitchen-basic.project.json --cabinet B01   # machining + hardware per part
```

## Rules

- Units are mm. Coordinates per DECISIONS.md D2.
- Never hard-code a size in a rule: every number comes from a variable in
  `catalog.ts` (with factory default, min, max) so the user can change it.
- New variable, option, role or diagnostic → add English and German text in
  `packages/i18n/src/locales/`. A coverage test checks this.
- Engine reports problems as `Diagnostic` (code + params), never throws on
  user data and never formats text. It may throw for rule bugs (e.g. a bore
  entry that is not on the part surface).
- Machining lives in the part-local frame (D13). Before placing a bore that
  can move (dowels), check `boreWouldCollide`; everything is re-checked by
  `checkOperations`.
- Output must be deterministic. Changing a golden file means a real change
  in production data: say so in the commit message.
- Any change to a convention in DECISIONS.md gets a new entry there.
- English identifiers; German terms only in the i18n catalogue and glossary.

## Glossary (DE → EN → code)

| German | English | Code / role |
| --- | --- | --- |
| Korpus | carcase | `carcase` |
| Seite (links/rechts) | side (left/right) | `side_left`, `side_right` (SL, SR) |
| Boden | bottom | `bottom` (BO) |
| Oberboden / Deckel | top | `top` (TO) |
| Traverse (vorne/hinten) | rail (front/rear) | `rail_front`, `rail_rear` (RF, RR) |
| Rückwand | back panel | `back` (BK) |
| Fachboden | shelf | `shelf` (SH) |
| Tür | door | `door` (DO) |
| Front / Blende | front / drawer front | `front` |
| Sockel | plinth | `plinth_h` |
| Nut | groove | `back_groove_*` |
| Falz | rebate | `back_rebate_depth` |
| Fuge | gap | `front_gap*` |
| Kante / Umleimer | edgeband | `edge.*` |
| Zuschnitt | cut size | `cutLength`, `cutWidth` |
| Maserung | grain | `grain` |
| Dübel | dowel | `dowel-8x35`, `joint_method: dowel` |
| Lochreihe / Systembohrung | system hole row | `sys_*`, `system_holes` |
| Raster | pitch / grid | `sys_pitch`, `sys_grid_y0` |
| Topfband | cup hinge | `hardware.hinge` |
| Topfbohrung | hinge cup bore | `cup_d`, `cup_depth` |
| Bohrabstand (K) | cup boring distance | `cup_boring_distance` |
| Montageplatte | mounting plate | `plate_*` |
| Bodenträger | shelf support pin | `hardware.shelf_support` |
| Anschlag | hinge side | `door_hinge_side` |
| Restwandstärke | remaining wall | `bore_min_wall` |
| Auszug | drawer slide | (next) |
