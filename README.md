# Cabinet Planner

Parametric planner for frameless (32 mm system) cabinets, aimed at European kitchens in board material with dowel construction. Every dimension is a variable, every default lives in a preset, and cutlist, BOM, drawings, STEP and CNC-ready DXF all come from one model.

Status: engine, web app, desktop shell and a first account/community server exist; nothing has been machined from it yet, and all factory hardware data is untested.

## Try it

| Where | How |
| --- | --- |
| Browser, on this machine | `pnpm install`, then `pnpm app` → http://localhost:5173 |
| Web app, hosted | GitHub Actions workflow **Web app** publishes the PWA with GitHub Pages (once: Settings → Pages → Source "GitHub Actions") |
| Windows (also macOS, Linux) | workflow **Desktop builds** → download the installer from the run's artifacts (unsigned: SmartScreen warns) |
| Android | workflow **Android build** → download the APK from the run's artifacts and side-load it |
| Accounts and community | `pnpm server` starts the server on port 8787; enter its address in the app's account dialog (see `packages/server/README.md`) |

The app works without an account and offline. The account server is optional; set the repository variable `CLOUD_URL` to build its address into the apps.

## Command line

Requires Node 22 and pnpm.

```sh
pnpm install
pnpm check                      # typecheck + tests
pnpm cp cutlist examples/kitchen-basic.project.json --format table
pnpm cp cutlist examples/kitchen-basic.project.json --shop examples/shop.json --group --lang de --delimiter ";" --out cutlist.csv
pnpm cp bom examples/kitchen-basic.project.json --shop examples/shop.json --format table --per-cabinet   # bill of materials with prices
pnpm cp sheets examples/kitchen-basic.project.json --zip sheets.zip   # all drawing sheets (SVG): plan, elevations, assembly, parts
pnpm cp resolve examples/kitchen-basic.project.json --cabinet W01   # every value and where it came from
pnpm cp check examples/kitchen-basic.project.json
pnpm cp ops examples/kitchen-basic.project.json --cabinet B01      # machining and hardware per part
pnpm cp dxf examples/kitchen-basic.project.json --zip kitchen.zip  # CNC DXF per part side (docs/CNC.md)
```

## Repository

- `packages/engine` — TypeScript engine: expression language, variable graph, preset layers, box cabinet rule, machining (32 mm system, dowels, hardware), checks, writers for cutlist, bill of materials, drawings and DXF.
- `packs/` — the bundled packs: factory materials, edgebands, surfaces, presets, templates and hardware items as JSON, one folder per pack with a `pack.json` (D76; brand items untested).
- `packages/i18n` — English and German texts for UI and CLI.
- `packages/cli` — `cabinet-planner` command.
- `packages/app` — web app (Svelte, three.js), also the UI of the desktop and Android apps.
- `packages/desktop` — Tauri 2 shell: Windows, macOS, Linux, Android.
- `packages/server` — optional account, sync and community server (Node, SQLite).
- `reference/` — reference cabinets with golden cutlists.
- [`DECISIONS.md`](DECISIONS.md) — conventions outputs depend on (coordinates, edges, part numbers).
- [`CLAUDE.md`](CLAUDE.md) — working notes and DE/EN glossary.

## Documents

- [`docs/PLAN.md`](docs/PLAN.md) — product and development plan: market research, feature list (MVP / v1 / later), domain model, outputs, platforms and stack, roadmap, risks.
- [`design/`](design/) — first-pass UI mockups (desktop plan view, hardware editor, tablet, community browse and pack import).

Planned stack: TypeScript engine, Svelte UI, Three.js view, Tauri 2 for desktop and tablet, local-first storage with optional sync.

Licence: not decided yet. All rights reserved until a licence file is added.
