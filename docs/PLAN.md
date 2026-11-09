# Cabinet Planner – Product & Development Plan

Nov 9, 2026 · Jo

> Living version with diagrams: the Claude Docs plan this file was exported from. Diagrams are described in text here.

## Summary

Build a parametric, frameless (32 mm system) cabinet planner where every dimension is a variable, every default lives in a preset, and every output — cutlist, BOM, drawings, STEP, CNC-ready DXF — is generated from one model. Primary use: European kitchen carcases in board material with dowel construction; other joint systems plug in as "construction methods".

The core promise is speed without loss of control: type sizes, pick a preset, get production data that is right the first time. The differentiator versus existing tools is an open, user-editable hardware and construction library and no file lock-in.

It runs on desktop and tablet from one codebase, works offline, and an optional account syncs presets and libraries between devices. A community area lets users share presets, hardware data and templates.

Scope boundary for v1: carcase engineering and production data. Room design, quoting/ERP and nesting are later or left to existing tools via export. Realistic rendering and textures are out of scope for good.

Photoreal rendering is not needed, simple 3d is plenty. This is used for planning not making a sale.

## What users expect

Users of this category expect one thing above all: change a size and everything downstream — parts, drilling, cutlist, drawings, CNC — updates with no manual rework. Everything else is about how much setup that takes and how much of it they can control.

### Reference tools

| Tool | Positioning | What users rely on | Weak spots users mention |
| --- | --- | --- | --- |
| [PolyBoard](https://wooddesigner.org/polyboard-software-tools/) | Small/medium custom workshops, CNC or not | Type sizes and the model redraws; style sheets for hardware and construction applied in one click; hardware with full machining; native .xxl / .xcs for SCM Xilog / Maestro | Libraries are the real product; setup service sold separately |
| [Mozaik](https://www.mozaiksoftware.com) | Small residential shops, subscription | Shop drawings, cutlists, labels, pricing, built-in optimizer; tiers for saw-only vs CNC shops | Windows only; on cancellation old job files reportedly cannot be opened ([WOODWEB thread](https://www.woodweb.com/forum_fdse_files/cad/843166.html)) |
| Cabinet Vision (Hexagon) | Benchmark for design-to-CNC | Screen-to-machine output, automatic shop drawings, part edits that propagate | Expensive, steep learning curve, complex connection setup |
| imos, Palette CAD, PointLine, TopSolid Wood | DACH industrial and Schreiner market | Integrated Blum/Hettich libraries; CSV lists straight to the panel saw with barcode labels ([Palette CAD case](https://www.palettecloud.net/cache/links/003ebf48f0f1ad36b880f8de46fcdadc.pdf)) | Total cost with all modules can run into five figures |
| [SketchList 3D](https://theretailexec.com/de/tools/beste-holzwerkstatt-verwaltungssoftware/) | Solo makers | Live cutlist, shop drawings, PDF/CSV, DXF to separate CAM | No hardware or stock management |
| Blum DYNAPLAN, Hettich Plan | Free vendor configurators | Collision-checked fittings, parts lists, CAD data | Single-brand; Hettich Plan was [phased out on 1 Jan 2026](https://www.hettich.com/en-au/services/hettich-plan) |

### Expectations distilled

1. **Parametric resize** of cabinets and whole runs, with hardware re-positioning itself.
2. **Style sheets / presets** for construction, materials and hardware, applied project-wide and overridable per cabinet.
3. **Complete lists**: not just panels — drawer boxes with sizes, hardware with article numbers, edgebanding metres, dowel counts. German forum users specifically complain when drawer sizes are missing from the list ([woodworker.de](https://www.woodworker.de/forum/goto/post?id=276651)).
4. **Brand hardware out of the box** (Blum, Hettich, Häfele, Grass) plus the ability to add any fitting with its drilling pattern.
5. **Shop drawings**: cabinet views, part drawings with every bore, assembly sheets, labels.
6. **Machine output**: layer-named DXF per part as the universal route; native formats for the big CNC brands as a bonus. Maestro maps DXF layer names to machining "technologies" ([PolyBoard–Maestro guide](https://wooddesigner.org/help-centre/scm-maestro-set-up-with-polyboard-optinest/)).
7. **Saw/optimizer handoff**: CSV/XLSX lists for OptiCut, Schnitt Profi(t), MaxCut, or a beam saw.
8. **Costing**: material and hardware cost per cabinet and per job.
9. **Data ownership**: users are wary of subscriptions that lock files.

### Gaps to exploit

- Hettich's own configurator is gone; small shops lose a free carcase tool.
- No affordable tool treats the hardware library as an open, shareable, version-controlled data format.
- Few tools target SCM Maestro directly at the low end — your own machine is the first test bench.
- Blum's BXF exchange format is proprietary XML; an importer needs a partnership with Blum ([Blum FAQ](https://blum.com/su/en/services/faq)). Hettich offers drilling patterns as free 2D DXF per article ([Hettich CAD](https://web.hettich.com/en-ro/planning/hettich-cad)) — a cheaper starting point.

## Feature list

MVP = one correct cabinet from presets to a cutlist and DXF you can run on the Morbidelli. v1 = a full kitchen run in daily production use. Later = what makes it sellable to others.

| Area | MVP | v1 | Later |
| --- | --- | --- | --- |
| Cabinet types | Base, wall, tall; doors, drawers, fixed/adjustable shelves | Sink, oven/appliance housing, blind corner, drawer-in-door, open shelf, fillers, end panels | Diagonal/L corner, carousel, curved, free "panel mode" for non-cabinet furniture |
| Construction | Dowels on 32 mm grid; top/bottom between or over sides; back in groove, rebate or surface | Cam + dowel, confirmat, Lamello Clamex/Tenso style P-slots, dado | Pocket screws, face frame, mitred joints |
| Fronts | Full overlay; gaps as variables; front grid split for drawer stacks | Half overlay, inset, handleless (J/C profile), grain direction across a stack | Profiled fronts, glass frames |
| Parametrics | Expressions on any field (`H - plinth - 2*T`); live recalculation; min/max validation | Cabinet runs that distribute width; linked cabinets; "what changed" diff | Constraint solving for runs between walls |
| Presets | Hierarchical presets: factory → shop → project → cabinet → part; save, set default | Import/export presets as files; per-customer preset sets | Presets synced via account |
| Hardware library | Hinges, slides, connectors, legs, shelf supports from a small seed set (one Blum, one Hettich line each) | User editor for new hardware incl. drilling pattern and placement rules; article numbers and prices | Hettich DXF pattern import; Blum BXF with partnership |
| Materials | Sheet materials with thickness, grain, price; edgebanding with thickness | Edge codes per edge; thickness deduction from cut size | Stock / offcut tracking |
| 3D view | Flat-shaded boxes: orbit, section, explode, select part, show bores | Room walls as context, measurements, front open/close preview | Simple client view mode (still flat-shaded) |
| Platforms | Desktop (Windows first), offline, local files | Tablet app with touch-first layout | Browser PWA; macOS/Linux builds |
| Account and sync | — | Optional account; sync of presets and libraries | Project sync; team accounts |
| Community | Packs as files (export/import) | Community library: browse, install, rate | Forks, trust levels, verified packs |
| Outputs | Cutlist (CSV/PDF), BOM, per-part DXF with Maestro layers, STEP | Shop drawings PDF, labels with barcode, saw CSV profiles, costing | Maestro .xcs direct, other CNC post-processors, nesting, ERP export |
| Quality checks | Collision check: hinge vs. drawer, slide length vs. depth, dowel vs. edge | Machinability checks per tool library | Assembly instructions |

Keep the MVP small on purpose: one cabinet type done perfectly through to a run on the machine proves the whole pipeline.

## Domain model

The model is data, not geometry: a project is a tree of cabinets whose parts, joints and hardware are derived by rules from variables. Geometry and every output are pure functions of that tree, so they can never disagree.

### Core objects

| Object | Holds | Example |
| --- | --- | --- |
| Project | Presets in force, room context, cabinet list | "Kitchen Müller" |
| Cabinet | Type, overall W/H/D, variable overrides, sections | Base 600, 2 drawers + 1 door |
| Section / Zone | Subdivision of the interior: drawer stack, shelf zone, opening | Top 150 drawer, bottom 570 door |
| Part | Role (side, bottom, top rail, back, shelf, front, drawer side…), material, finished size, edges, grain | Left side 720 × 560 × 19 |
| Joint | Two parts + a construction method | Bottom ↔ side: dowel pattern A |
| Hardware instance | Library item + placement on one or two parts | Hinge ×2 on left side / door |
| Operation | Machining derived from joints and hardware: bore, groove, pocket, cut-out | Ø8 × 13 on face, Ø35 × 13 hinge cup |

### Variables and expressions

- Every numeric field is either a value or an expression referencing named variables: `side_h = H - plinth_h`, `shelf_w = W - 2*T_side - 2*shelf_gap`.
- A small, safe expression language (arithmetic, min/max, round-to-grid, if) — never `eval`.
- Variables form a dependency graph; recalculation is topological, cycles are reported, not silently broken.
- Units are mm internally, always. Display can differ.
- Each variable carries metadata: label (DE/EN), unit, min, max, step, group, "shown in quick panel" flag.

### Preset inheritance

Resolution order, last wins: **Factory → Shop default → Project → Cabinet → Part**. A preset is a named partial set of variables plus chosen library items (material, hinge, slide, connector). "Set as default" just marks which preset fills the Shop layer. The UI must always show where a value came from and allow "reset to inherited".

Typical preset groups: carcase construction, front gaps and overlay, plinth/legs, materials, edge rules, hardware set (e.g. "Blum Legrabox + Clip top" vs "Hettich AvanTech + Sensys").

### Construction methods

A construction method is a plugin that, given a joint (two parts, their contact face and length), returns operations and consumables. Dowel method parameters: diameter, length, depth split between parts, edge offset, spacing on the 32 mm grid, minimum count, max distance. Cam, confirmat, P-slot and dado are further methods with the same interface. Methods are selected per joint role in the construction preset, so "sides over bottom, back in 8 mm groove 10 mm from rear" is data.

### Hardware library schema

Each item is one human-readable file (JSON or YAML), versioned, stored in a user folder next to the factory library:

- **Identity**: id, manufacturer, series, article number(s), category (hinge, slide, connector, leg, shelf support, handle, hanger, lift system), variant fields.
- **Parameters**: what the item needs or offers, e.g. slide nominal lengths, required side clearance, min. inner depth; hinge opening angle, overlay range, plate distance.
- **Selection rules**: which variant to pick from cabinet variables (slide length from inner depth; hinge count from door height and weight).
- **Placement rules**: positions relative to part references (front edge, top edge, system-hole row), expressed with the same expression language.
- **Drilling pattern**: operations per mounting part — diameter, depth, face, position.
- **BOM data**: units per placement, price, supplier, ordering text.
- **Geometry**: optional STEP/GLB model for 3D view and export; a simple box proxy otherwise.

A guided editor creates these files, with a 2D preview of the drilling pattern on a test part. Because they are plain files, users can share packs and diff them in git.

## Outputs

Every output is a writer plugin reading the same resolved model; adding a format never touches the engine.

| Output | Content | Formats | Phase |
| --- | --- | --- | --- |
| Cutlist | Part no., cabinet, role, material, finished L × W × T, cut size (edge deduction), qty, grain, edge code per edge, notes | CSV, XLSX, PDF | MVP |
| BOM | Sheet m² per material with waste factor, edgeband metres per type, dowels/screws/connectors, hardware by article no., drawer boxes, price | CSV, XLSX, PDF | MVP |
| Part DXF | Outline + every operation on named layers (configurable mapping, Maestro preset first) | DXF R2010+ | MVP |
| 3D model | Assembly with one solid per part, names = part numbers, hardware as solids or proxies | STEP AP214/242; GLB/OBJ for viewers | MVP (STEP), v1 (GLB) |
| Shop drawings | Cabinet front/side/top with dimensions, part drawings with bore table, assembly sheet | PDF, DXF | v1 |
| Labels | Part no., cabinet, size, edge marks, barcode/QR | PDF for label printer, CSV | v1 |
| Saw / optimizer list | Column profiles for OptiCut, Schnitt Profi(t), MaxCut, generic | CSV / XLSX | v1 |
| Costing | Material + hardware + optional labour per cabinet and job | PDF, CSV | v1 |
| Native CNC | Maestro .xcs script import, later others | XCS, then post-processor API | Later |

Rules that make outputs trustworthy:

- Stable part numbering across regenerations, so labels and CNC files from yesterday still match.
- Configurable list layouts (columns, sort, grouping) stored as presets too.
- A part's DXF origin, face orientation and edge reference are explicit settings — the most common source of machine errors.
- Every export embeds project name, revision and timestamp.

## Platforms, architecture & tech stack

One TypeScript engine runs unchanged on desktop, tablet, browser and CLI; the UI is a web app packaged with Tauri 2; data lives locally first and an optional account syncs it. This replaces the earlier PySide6 plan: Python does not run natively on iPad or Android, and a web stack is the only realistic single codebase for both.

```
 Desktop (Tauri)   Tablet (Tauri mobile / PWA)   Browser (PWA)   CLI (Node)
        \                 |                          |              /
         +------------------- Engine (TypeScript, no UI) ----------+
         |  Preset resolver -> Expression graph -> Rules -> Resolved model
         +-----------------------------+------------------------------+
                                       |                              |
                     Writers (lazy-loaded)                   Local store (SQLite / IndexedDB)
                     cutlist, BOM, DXF, STEP, PDF                      |
                                |                          Cloud (optional, self-hostable)
                     Export files to Maestro,              Account + sync · Community packs
                     SOLIDWORKS, panel saw
```

Every client embeds the same engine, so a cabinet computes identically everywhere; the cloud stores and shares documents but never computes production data.

### Platforms

| Platform | Packaging | Role |
| --- | --- | --- |
| Windows, macOS, Linux | Tauri 2 desktop (system webview, small installer) | Main planning, all exports, CNC handoff |
| iPad, Android tablet | Tauri 2 mobile; PWA as zero-install fallback | Planning at the client or on site, offline; exports shared as files |
| Browser | Same build as a PWA | Try without installing; open shared projects |
| CLI | Node | Batch exports, snapshot tests, CI |

### Lightweight and fast: budgets

Targets, checked in CI on every merge:

- Full recompute of a 50-cabinet kitchen in under 50 ms on a mid-range tablet.
- 60 fps orbit with all parts visible: instanced boxes, flat shading, edge lines, no textures.
- Cold start under 2 s; desktop installer under 20 MB without the STEP module.
- The STEP kernel loads only when you export STEP.

### Stack

| Need | Choice | Note |
| --- | --- | --- |
| Engine | TypeScript, no DOM or framework imports | Same code in app, CLI and server; Rust to WASM only if profiling demands it |
| UI | Svelte 5 (or SolidJS) | Small bundles, fine-grained reactivity for property panels |
| 3D view | Three.js | Instanced boxes, section planes, explode, bore markers |
| Shell | Tauri 2 | Desktop and mobile from one project; Rust side for files and SQLite |
| Local store | SQLite (Tauri), IndexedDB (browser) | Documents stored as versioned JSON |
| Schemas | Zod or JSON Schema | Validates project, preset and hardware files; drives the hardware editor forms |
| DXF | Own writer | DXF ASCII is simple; full control of layer names for Maestro |
| STEP | opencascade.js (WASM), lazy-loaded | Heavy; fallback is an own writer for box parts with cylindrical bores |
| PDF, XLSX | pdf-lib, ExcelJS | Lists, drawings, labels |
| Backend | Supabase (Postgres, auth, storage) or PocketBase | Both open source and self-hostable |

### Sync

- Local-first: the app is fully usable offline, and the account is optional.
- Every preset, hardware item, template and project is a document with id, version, owner and timestamp.
- Presets and library items: last writer wins per document, with a kept conflict copy. They are rarely edited on two devices at once.
- Projects: same model at first; a CRDT (Automerge or Yjs) only if live collaboration becomes a goal.
- Export files are never synced; they are regenerated from the model.

### Community library

- Shared packs: presets, hardware items, cabinet templates, list layouts, DXF layer mappings.
- Each pack carries author, version, licence, changelog, downloads and rating.
- Installing copies the pack into your library with update notifications; anyone can fork and republish.
- Trust levels: community, tested (author confirms a machined part), verified (reviewed). Untested drilling data shows a warning before its first CNC export.
- Manufacturer CAD files are linked, not redistributed, unless the manufacturer's terms allow it.

### Licensing: the decision can wait

| Model | How | Revenue | Trade-off |
| --- | --- | --- | --- |
| Fully open source | MIT or Apache-2.0, everything public | Hosted sync, services, donations | Anyone can rebrand and sell it |
| Open-core | App and engine open (AGPL or MPL-2.0); hosted sync and community paid | Subscriptions for account features | The free app must stay genuinely useful |
| Closed commercial | Private repo, licence keys | One-time or subscription | You carry all development |

To keep all three open: stay sole copyright holder (or require a CLA for contributions), use only permissive or LGPL dependencies, and keep sync a separate service. OpenCascade is LGPL 2.1, and bundling it as WASM in a closed app needs checking; the own STEP writer avoids the question. Have a lawyer confirm the final model.

## Roadmap

Five phases, each closed by a gate you can test in the shop. The engine and its outputs come before the GUI, so the first real cabinet is machined from a CLI-generated file before any UI work starts.

| Phase | Content | Gate |
| --- | --- | --- |
| 0 · Foundations | Repo, TypeScript engine, Zod schemas, units, expression parser + graph; preset resolver, one parametric box cabinet, CLI, snapshot tests | Box cabinet to cutlist from the CLI |
| 1 · MVP engine + outputs | Base, wall, tall; doors, drawers, shelves; dowels on the 32 mm grid; seed hardware; cutlist, BOM, Maestro-layer DXF, STEP; collision checks | **First cabinet machined on the M200** |
| 2 · App shell, desktop + tablet | Svelte UI in Tauri, Three.js view, preset panels, touch-first layout; hardware picker, live validation, project save and load | Cabinet built on a tablet, offline |
| 3 · v1 production | Kitchen runs, corner/sink/appliance units, cam, confirmat, P-slot joints; hardware editor, shop drawings, labels, saw CSV profiles, costing | Reference kitchen built and installed |
| 4 · Accounts, sync, community | Account + sync, community library, licensing, DE/EN UI, docs; Maestro .xcs output, Hettich DXF pattern import, pilot users | First external pilot shop |

Gate 1 is the proof point: if a CLI-built cabinet drills correctly on the Morbidelli and assembles square, every later phase is UI and breadth.

Working rules for smooth development:

- Write the reference cabinets (with expected cutlists) before the code that produces them.
- One phase, one milestone branch; nothing merges without its snapshot tests green.
- Keep a `DECISIONS.md` log for every convention (origins, face naming, edge codes) — these are what break CNC output later.
- Give Claude Code a `CLAUDE.md` with the domain glossary (Korpus, Seite, Boden, Rückwand, Front, Sockel) and the coordinate conventions, so generated code stays consistent.

## Risks, open questions, dev practices

### Risks

| Risk | Why it bites | Mitigation |
| --- | --- | --- |
| Scope creep into a full CAD | Room design, nesting, sync edge cases each eat months | Hard MVP line; export to SOLIDWORKS/optimizers instead |
| Wrong drilling reaches the machine | Scrapped boards, lost trust | Golden-file tests per cabinet type; dry run on MDF offcuts; collision checks |
| Hardware data quality | Users enter patterns wrong | Editor with 2D preview + test cabinet; factory items marked verified |
| Bad community data | Shared packs spread errors to other shops | Trust levels; untested-data warning before CNC export; reporting |
| Tauri mobile is younger than desktop | Webview quirks on iPad and Android | Keep the app PWA-compatible; Capacitor as plan B |
| STEP kernel size | opencascade.js is a large WASM download | Lazy-load on export; own writer for box parts as fallback |
| Parametric edge cases | Tiny cabinets, extreme gaps break rules | Min/max on variables; property-based tests across random sizes |
| Sync conflicts | Same preset edited on two devices | Last writer wins plus conflict copy; clear UI to pick |
| Vendor formats | BXF and native CNC formats are closed | DXF-first; pursue partnerships only once there are users |

### Open questions

- [ ] Community moderation: who reviews packs marked verified, and which licence do shared packs carry by default?
- [ ] Licensing: fully open source, open-core, or closed commercial? Decide before the first public release.
- [ ] Which hardware lines seed the library — what do you actually use today?
- [ ] Is a Maestro .xcs file sample available from your machine to reverse the format later?
- [ ] Relation to Crafted CAM: shared geometry/toolpath core, or fully separate product?

### Dev practices

- Engine as a pure library with no GUI imports; CLI that turns a project file into all outputs — the GUI is a client of it.
- Project, preset and library files are versioned JSON with a schema version and migrations.
- Tests: unit tests for expressions; snapshot tests for cutlists/BOM/DXF of ~20 reference cabinets; property tests for resize invariants (no negative parts, no bore outside a part, no bore within X mm of an edge).
- Deterministic output: same input → byte-identical files, so diffs show real changes.
- One reference kitchen built for real from the tool before v1 is called done.

## Sources

- [PolyBoard software overview](https://wooddesigner.org/polyboard-software-tools/) · [PolyBoard kitchen design](https://wooddesigner.org/design-a-kitchen/) · [PolyBoard SCM/Morbidelli integration](https://wooddesigner.org/help-centre/scm-morbidelli-integration-polyboard/) · [PolyBoard + Maestro DXF setup](https://wooddesigner.org/help-centre/scm-maestro-set-up-with-polyboard-optinest/)
- [Mozaik Software](https://www.mozaiksoftware.com)
- [WOODWEB CAD forum thread on Mozaik file access](https://www.woodweb.com/forum_fdse_files/cad/843166.html)
- [Visualizee: Best cabinet design software 2026](https://visualizee.ai/blog/cabinet-design-software)
- [woodworker.de: Welches CAD-Programm](https://www.woodworker.de/forum/goto/post?id=276651)
- [Palette CAD case study (CSV to panel saw)](https://www.palettecloud.net/cache/links/003ebf48f0f1ad36b880f8de46fcdadc.pdf)
- [The Retail Exec: Holzwerkstatt-Software (SketchList 3D)](https://theretailexec.com/de/tools/beste-holzwerkstatt-verwaltungssoftware/)
- [Blum FAQ (BXF format)](https://blum.com/su/en/services/faq) · [Blum CAD/CAM interface](https://blum.com/al/en/services/industrial-production/cad-cam-interface)
- [Hettich Plan phase-out notice](https://www.hettich.com/en-au/services/hettich-plan) · [Hettich CAD data](https://web.hettich.com/en-ro/planning/hettich-cad)
- [32 mm cabinetmaking system (Wikipedia)](https://en.wikipedia.org/wiki/32_mm_cabinetmaking_system)
