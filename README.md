# Cabinet Planner

Parametric planner for frameless (32 mm system) cabinets, aimed at European kitchens in board material with dowel construction. Every dimension is a variable, every default lives in a preset, and cutlist, BOM, drawings, STEP and CNC-ready DXF all come from one model.

Status: **Phase 1 in progress (systems)**. The engine resolves presets and expressions, builds a parametric box cabinet, derives its machining (back grooves, dowel joints on the 32 mm grid, system holes, hinge drilling from hardware items), checks it for collisions and writes a cutlist from the command line. Machine exports and UI come later.

## Quick start

Requires Node 22 and pnpm.

```sh
pnpm install
pnpm check                      # typecheck + tests
pnpm cp cutlist examples/kitchen-basic.project.json --format table
pnpm cp cutlist examples/kitchen-basic.project.json --shop examples/shop.json --group --lang de --delimiter ";" --out cutlist.csv
pnpm cp resolve examples/kitchen-basic.project.json --cabinet W01   # every value and where it came from
pnpm cp check examples/kitchen-basic.project.json
pnpm cp ops examples/kitchen-basic.project.json --cabinet B01      # machining and hardware per part
```

## Repository

- `packages/engine` — TypeScript engine: expression language, variable graph, preset layers, box cabinet rule, machining (32 mm system, dowels, hardware), checks, cutlist writer.
- `packages/engine/library/hardware` — factory hardware items as JSON (generic, untested).
- `packages/i18n` — English and German texts for UI and CLI.
- `packages/cli` — `cabinet-planner` command.
- `reference/` — reference cabinets with golden cutlists.
- [`DECISIONS.md`](DECISIONS.md) — conventions outputs depend on (coordinates, edges, part numbers).
- [`CLAUDE.md`](CLAUDE.md) — working notes and DE/EN glossary.

## Documents

- [`docs/PLAN.md`](docs/PLAN.md) — product and development plan: market research, feature list (MVP / v1 / later), domain model, outputs, platforms and stack, roadmap, risks.
- [`design/`](design/) — first-pass UI mockups (desktop plan view, hardware editor, tablet, community browse and pack import).

Planned stack: TypeScript engine, Svelte UI, Three.js view, Tauri 2 for desktop and tablet, local-first storage with optional sync.

Licence: not decided yet. All rights reserved until a licence file is added.
