# Cabinet Planner – notes for Claude Code

Parametric planner for frameless 32 mm cabinets. Read `docs/PLAN.md` for the
product, `DECISIONS.md` for conventions that outputs depend on.

## Layout

- `packages/engine` – pure TypeScript engine. No DOM, no Node APIs, no UI
  text. Pipeline: presets → variables (expression graph) → cabinet rules →
  parts → output writers.
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
```

## Rules

- Units are mm. Coordinates per DECISIONS.md D2.
- Never hard-code a size in a rule: every number comes from a variable in
  `catalog.ts` (with factory default, min, max) so the user can change it.
- New variable, option, role or diagnostic → add English and German text in
  `packages/i18n/src/locales/`. A coverage test checks this.
- Engine reports problems as `Diagnostic` (code + params), never throws on
  user data and never formats text.
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
| Dübel | dowel | (phase 1) |
| Lochreihe | system hole row | (phase 1) |
| Topfband | cup hinge | (phase 1) |
| Auszug | drawer slide | (phase 1) |
