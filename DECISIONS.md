# Decisions

Conventions that outputs depend on. Changing one changes cutlists, drawings
or CNC files, so every change gets a new entry here (do not rewrite old
ones; mark them superseded) and regenerated golden files.

Format: number, date, decision, reason.

---

### D1 · 2026-11-09 · Units are millimetres everywhere

All lengths in the engine, files and outputs are mm. Display units may
differ later; conversion happens only in the UI.

### D2 · 2026-11-09 · Cabinet coordinate system

Origin at the **rear-left-bottom** corner of the carcase (without plinth and
without fronts). **X** to the right, **Y** up, **Z** towards the front.
Right-handed, so it maps 1:1 to Three.js with the camera in front. Fronts
sit at `z = D … D + t_front`. The plinth is below `y = 0`.

### D3 · 2026-11-09 · Part origin and faces (for DXF, phase 1)

Each part's local origin is its **front-left-bottom** corner as seen when
the part lies on the machine with face A up. Face naming and the exact
mapping per role are fixed when the DXF writer is built and recorded here
before the first machined part. The engine itself stores machining in a
neutral part frame (D13); the writer maps it.

### D4 · 2026-11-09 · Part length, width and edges

- `length` is the dimension along the grain (for grain-less materials, the
  dimension the role defines as length); `width` is the other face dimension.
- Edges: `l1`, `l2` are the long edges (parallel to the length) at width 0
  and width max; `w1`, `w2` are the short edges at length 0 and length max.
- Role mapping in phase 0: sides L = height, W = depth; bottom, top, rails,
  shelves L = cabinet width, W = depth; back and doors L = height, W = width.
  For carcase parts and shelves, `l2` is the front edge.

### D5 · 2026-11-09 · Cut size

Cut size = finished size minus the thickness of every edgeband on the
edges that close that dimension, when the option `edge.deduct` is on
(default). Pre-milling allowance is a machine setting, not part of the cut
size.

### D6 · 2026-11-09 · Stable part numbers

Part id = `<cabinet id>-<role code><index>`, e.g. `B01-SL`, `B01-SH2`.
Role codes: SL side left, SR side right, BO bottom, TO top, RF front rail,
RR rear rail, BK back, SH shelf, DO door. Indexes are 1-based and only for
repeated roles. Adding a shelf never renumbers a door.

### D7 · 2026-11-09 · Preset layers

Resolution order, last wins: Factory → Shop → Project → Cabinet; the Part
layer overrides material, edges and notes per part. Within a layer, its
named presets apply in list order, then the layer's own values. Every
resolved value records its layer and preset.

### D8 · 2026-11-09 · Board thickness follows the material

`t_carcase`, `t_back`, `t_shelf`, `t_front` default to the thickness of the
chosen material (`mat_*_t` constants). Overriding is allowed and produces a
warning.

### D9 · 2026-11-09 · Phase 0 box rules

- `H` is the carcase height without plinth; `D` the carcase depth without
  fronts. `D` defaults to `worktop_d − 40`.
- Back in groove: groove `back_groove_offset` from the rear, depth
  `back_groove_depth`; the back is undersized by `back_play` per edge. With
  rails, the back runs to `H − back_play` behind the rear rail.
- Back in rebate: same, but the back sits at `z = 0`.
- Surface back: covers `W × H`; carcase parts start at `z = t_back`.
- Doors: full overlay, bottom at `front_gap_bottom`, top gap
  `front_gap_top`, outer side gap `front_gap_side`, `front_gap` between doors.
- Only the front edges of carcase parts and shelves are banded by default;
  per-edge rules come with the edge-code feature (v1). The part layer can
  set any edge.

### D10 · 2026-11-09 · Machine-readable output formatting

Numbers use a dot as decimal separator, at most two decimals, no trailing
zeros. CSV uses LF line endings and RFC 4180 quoting. Same input gives
byte-identical files. Locale-specific formatting is only for display.

### D11 · 2026-11-09 · Localization

Code, identifiers and file keys are English. The engine emits message keys
and parameters, never text. All UI and CLI text lives in
`packages/i18n/src/locales`; English is the base, German must be complete
(enforced by the type checker), other languages may be partial and fall
back to English.

### D12 · 2026-11-09 · Expression language

Numbers, variables, `+ − × ÷` (ASCII or typographic), comparisons,
`&& || !`, and the functions `min max abs round floor ceil clamp roundTo
floorTo ceilTo if`. No `eval`, no member access, no strings. Comparisons
return 1/0. `if()` is lazy. Any non-finite result is an error.

### D13 · 2026-11-09 · Part-local frame for machining

Operations are stored per part in local coordinates: `u` along the length,
`v` along the width, `w` along the thickness, origin at the part's minimum
corner in cabinet coordinates. Faces: `t0` (w = 0), `t1` (w = thickness),
`l1`/`l2` (v = 0 / width, same as the edge names in D4), `w1`/`w2`
(u = 0 / length). A bore is stored by its entry point on the face, diameter
and depth; grooves and rebates are rectangular pockets open to a face.
Machine faces (A/B), origins and mirroring are applied by the export
writers (D3), never in the model.

### D14 · 2026-11-09 · 32 mm system grid

- Vertical grid: `y = sys_grid_y0 + k · sys_pitch` in cabinet coordinates,
  `sys_grid_y0 = t_carcase / 2` by default, so bottom dowels, system holes
  and hinge plates share one grid.
- Front row `sys_row_front` (37) from the front edge of the sides. Rear row
  on the pitch from the front row, at least `sys_row_rear_min` in front of
  the back panel.
- Holes only between `sys_margin` above the bottom and below the top.
- Adjustable shelves rest `shelf_pin_rest` above the hole nearest to even
  spacing; height never changes the cutlist.

### D15 · 2026-11-09 · Hardware items and drilling frames

- Hardware items are JSON files (schema in `hardware/schema.ts`). Params are
  expressions that may read cabinet variables and placement context; a
  param must not reuse a cabinet variable name.
- Drilling is given per `mount` in a placement frame with `a` (along) and
  `b` (across). Hinge frames: `door` = face towards the carcase, `a` from
  the hinge centre upwards, `b` from the hinge edge inwards; `side` = inner
  face of the hinge side, `a` as above, `b` from the front edge backwards.
- Hinge count comes from the item's `count` param; centres start
  `end_offset` from the door ends, are spread evenly and, with system holes,
  snapped so that `centre − grid_offset` lies on the grid.
- Single door: hinge side from `door_hinge_side`; two doors hinge outwards.
- Factory items are generic and `untested`. They must be replaced or
  confirmed from datasheets before machining.

### D16 · 2026-11-09 · Dowel joints

Carcase joints run front to back. Dowels sit on the system pitch measured
from the front end of the joint, the first at `dowel_offset_front` (front
row), none closer than `dowel_offset_rear` to the rear end, at most
`dowel_max_spacing` apart. Positions whose hole would come within
`bore_min_wall` of existing machining (e.g. the back groove) are skipped.
Sides over: face bore in the side, edge bore in the horizontal part.
Sides between: face bore in the bottom/top, end bore in the side. Depths
come from the connector item (`face_depth`, `edge_depth`).

### D17 · 2026-11-09 · Machining checks

Every bore must leave `bore_min_wall` to every surface it does not enter
through; operations may not overlap except identical bores, which are
merged with all their sources (e.g. a hinge plate screw in a system hole).
Pockets may meet each other. Violations are errors and block output.
Overlap tests use axis-aligned bounds, so they are conservative.

### D18 · 2026-11-09 · Preferences are variables, product data lives in items

How a shop wants hardware placed is a cabinet variable, set once in the
shop preset and overridable per project or cabinet: e.g. `hinge_end_offset`
(factory 80 mm), `hinge_count` (0 = the manufacturer's recommendation for
the door height). Hardware items carry only product data: dimensions,
drilling patterns, nominal lengths and the manufacturer's selection rules.
Supersedes the `end_offset` item param from D15.

### D19 · 2026-11-09 · Drawing views

Every part edge and face is named by the cabinet direction it faces
(front, rear, left, right, top, bottom); the inner face is the one towards
the cabinet centre. A view puts one thickness face towards the viewer and
anchors one named edge to a side of the sheet. Views are never mirrored:
what is drawn is the real face.

- **Machine view** (CNC and manual drilling): inner face up, front edge on
  the reference (drawing bottom = machine Y 0), origin at the bottom-left
  corner. Right side: origin lower front. Left side, same face up: origin
  upper front. Parts without a front edge use their bottom edge.
- **Assembly view** (workshop sheet): parts as if the cabinet were unfolded
  around the front view. Sides upright, seen from inside, folded outwards
  (left side: front edge on the left; right side: on the right). Bottom
  seen from above, top from below, left stays left.

Supersedes the face-view convention of the first part drawing.

### D20 · 2026-11-09 · Dimensioning and drawing styles

- Positions are dimensioned from the origin (running / parallel
  dimensioning, ISO 129-1), never accumulated, unless a style chooses chain
  dimensions.
- Regular hole rows and columns (≥ 3 at one pitch) are given as patterns:
  first and last position on the axes, count and pitch in the legend.
- Feature groups (same source, Ø, depth, face) get a letter tag and a
  legend line; a coordinate table is optional per style and per rule.
- Sheets are to scale (1:1, 1:2, 1:5, 1:10, 1:20, 1:50), A4/A3, text 2.5 mm.
- Styles are data with `extends` and selector rules; rule properties
  cascade (first matching rule that sets a property wins). User teaching
  adds rules in front, so the factory styles never change underneath.

### D21 · 2026-11-09 · Sheet types; assembly drawing

- **Part sheet** (per part): machine view by default. Flat parts (bottom,
  top, rails, shelves) use the same view in every part-sheet style, so two
  sheets of one part never show it turned around. Only the `upright` style
  differs, and only for sides (standing, folded outwards).
- **Assembly drawing** (per cabinet): exploded axonometric view (seen from
  front-right-above), flat-shaded, A3, to scale. Balloons in two columns
  point to a visible spot of each part; balloon numbers are the positions
  of the part list (identical parts share one position). Part list: pos,
  qty, part, finished L × W × T, material, edge codes (l1 l2 w1 w2).
  Hardware list below.
- Overall dimensions end with oblique ticks by default (ISO 129-1
  alternative to arrowheads); arrows or dots per style.

Supersedes the "assembly" part style of D19/D20 (renamed `upright`).

### D22 · 2026-11-09 · Which face a part sheet shows; two-sided parts

- Default face is `machined`: the inner face, unless only the outer face
  has machining; then the part is turned over so the machined face is up.
  The front edge stays on the reference either way (flat parts are flipped
  down, banding towards the origin).
- A part with machining on both thickness faces gets one sheet per side
  (style setting `show.bothSides`, on by default). Side 2 is the part turned
  over about the reference edge. Each sheet dimensions and tags only its
  own face; the other face's machining is drawn dashed for orientation.
- The same split will apply to CNC exports: one program per machined side.

### D23 · 2026-11-09 · Through holes and holes meeting from both faces

Two shop settings, because they are used for different things:

- `bore.through` (default `one_side`): holes that must go through, e.g.
  pull and knob screws. `one_side`: one bore through the full thickness
  from the mounting face. `both_sides`: drilled from both faces.
- `bore.opposite` (default `both_sides`): coaxial holes of equal Ø from
  opposite faces that would leave less than `bore_min_wall` between them,
  e.g. shelf-pin rows on both faces of a middle panel. `both_sides`: each
  drilled to the middle so both faces come out clean; `through`: one hole
  through from the face of the first bore; `error`: report the collision.
- Drilled from both faces, each half is `thickness / 2 + through_overlap / 2`
  deep (`through_overlap` default 1 mm). The halves are marked `split`, a
  through bore `through`; drawings say "through" or "from both faces", and
  a part with split holes gets a sheet per side (D22).

### D24 · 2026-11-09 · Front stack and drawers

- A cabinet may list its fronts top to bottom (`fronts`): drawers and door
  zones, each with a height (number or formula) or none to share the rest.
  Without a list the cabinet has one door zone over the full height, as
  before. Shelves go into the tallest door zone.
- Drawer slides are hardware items with `slide` product data: available
  nominal lengths, depth allowance, rail fixing pattern per length (from
  the first fixing, 37 mm), minimum rail height, rail-to-box offset, box
  type (wood or metal sides), and formulas for box sizes (`inner_w`,
  `length` or `bottom_w`, `bottom_l`, `back_w`) over `LWK` (carcase inner
  width) and `NL`.
- NL: the longest length with NL + depthExtra ≤ clear inside depth (back
  panel front face to carcase front edge).
- Rail screw axis: `drawer_axis_offset` above the front's lower edge, moved
  down to a system-grid line, never below the slide's `axisMin` above the
  carcase bottom. Rail holes use the system hole Ø and depth.
- Box: underside = axis − axisToBox; top at most `drawer_clearance` below
  the front's top edge and inside the carcase. Wooden boxes: sides full
  length, inner front and back between them, bottom in a groove
  (`drawer_bottom_offset`, `drawer_bottom_groove`). Metal systems: bottom
  and back only, side height = the largest the slide offers that fits.
- Not yet: drawer front fixing drilling (front hooks/holders), back notches
  and rear hook holes — the catalogue data is incomplete for them.

### D25 · 2026-11-09 · Middle panels and handles

- `partition_count` vertical middle panels divide the interior into equal
  sections; they stand between bottom and top/rails, in front of the back,
  `partition_setback` behind the front edge, doweled like sides between.
  Shelves are made per section. System-hole rows go on both faces; where
  they meet, `bore.opposite` decides (default: from both faces, D23).
  Middle panels are left out (with a warning) when the cabinet has drawers.
- Handles are hardware items (category `handle`, params `cc` and
  `hole_d`; `cc` 0 = knob). Holes go through the front from the visible
  face (`bore.through`). Placement preferences are variables and options:
  doors at the opening edge (`handle_edge_offset`), nearest hole
  `handle_end_offset` from the top (wall units: from the bottom),
  vertical or horizontal (`handle.door`); drawer fronts centred or
  `handle_drawer_top` below the top (`handle.drawer`). Default: no handle.

### D26 · 2026-11-09 · Drawer front fixing; handle placements

- Slide items may carry `frontFixing` (holes in the back of the drawer
  front: Ø, depth, distance from the carcase side's inner face line, lowest
  hole above the box underside, row offsets). Nova Pro Scala: 2 × Ø10 × 12
  per side, 32 apart, 21.5 from the side line, lowest 40.5 above the slide
  underside (read from the catalogue drawing; check on a first part).
  The rail line is raised to the next grid line if the lowest hook would
  come closer than Ø/2 + bore_min_wall to the front's lower edge.
- Wooden drawers without a system fixing: `drawer_front.fixing` = screws
  (default) drills four Ø`front_screw_d` holes through the inner front,
  `front_screw_side` from its ends and `front_screw_edge` from top and
  bottom; `none` drills nothing.
- Machining records each handle/knob placement (hole positions on the outer
  face, plus display sizes from the item: length, bar Ø, knob size,
  standoff) for 3D and later drawings.

### D27 · 2026-11-09 · DXF export

- One ASCII DXF (R12 / AC1009, CRLF, mm) per machined side of a part, in
  the machine frame of the part sheet (D19, D22): machined face up, front
  edge on the reference (Y 0), origin at the reference corner. Parts
  machined on both faces give `<part>-side1.dxf` and `<part>-side2.dxf`;
  edge (horizontal) bores go into side 1.
- Entities: outline as closed POLYLINE (thickness = panel thickness, as
  negative group 39); face bores as CIRCLE (group 39 = −depth); through
  bores on their own layer; horizontal bores as LINE from the edge inwards,
  length = depth; pockets/grooves as closed POLYLINE (group 39 = −depth).
- Layer names come from a DXF profile (`library.dxfProfiles`, factory
  `generic`) with placeholders {d} {depth} {z} {edge} {t}; dots become "P",
  other characters "_". Group 39 can be switched off per profile.
- No post-processing: native CNC formats (e.g. Maestro .xcs) stay for later.
- Header comment (999) names project, revision, part, side, size; a
  timestamp only when asked (CLI --timestamp), so files are reproducible.

### D28 · 2026-11-09 · Room planning

- Plan coordinates: X east, Y north, mm; origin at the start of the first
  wall's inner face. Walls are listed in order, clockwise, so the room is
  on the right of each wall; lengths along the inner face; each wall
  turns right (default) or left into the next. Wall height defaults to
  `room_height`; thickness extends outwards.
- Openings (window, door, opening) on a wall: `x` from the wall's start
  to the left edge as seen from inside, width, sill, height; doors swing
  into the room with a hinge side.
- A cabinet stands with its back on its wall (`place.wall`): its X along
  the wall from `place.x`, its front into the room; without `x`, floor
  units and wall units each continue the run on that wall in project
  order. Cabinets without a place go on the first wall. Floor units stand
  on the plinth, wall units at `wall_bottom`.
- Room checks (warnings unless noted): cabinet past the wall's ends,
  cabinets overlapping in plan at overlapping heights (error), cabinets in
  front of an opening. Room findings never block parts, cutlists or CNC
  files; `check` fails on them.
- Drawings on A3, to scale (1:10 … 1:100): floor plan (walls, openings with
  door swing, floor units solid, wall units dashed, per wall the unit
  chain, inner length and opening positions, wall names outside) and an
  elevation per wall seen from inside (fronts, handles, plinth, openings,
  width chains below/above, height chain on the left).

### D29 · 2026-11-09 · Corner units and worktops

- Blind corner (`corner: blind_left | blind_right`, base/tall/wall units
  with doors): a fixed blind panel (role `blind_panel`, code BP, front
  material, front gaps as doors) covers `blind_w` (default `worktop_d + 50`)
  on the corner side; the doors cover the rest. A single door hinges on
  the side away from the blind panel. Error `blind_too_wide` when less than
  100 mm stay for the door; drawers ignore the setting (warning).
- Inside corners: walls are filled in order. When the previous wall turns
  right into this one, a floor (wall) unit run without explicit positions
  starts behind the deepest floor (wall) unit that reaches the previous
  wall's end, i.e. at its depth including fronts.
- Worktops: one per run of base units on a wall that touch (gap ≤ 1 mm)
  and share a top height; tall units interrupt a run. Depth `worktop_d`
  from the wall, thickness `worktop_t` (from `material.worktop`), underside
  on the carcase top. A run reaching a wall's end runs to the wall; in an
  inside corner the earlier wall's worktop runs through and the next one
  butts against its front edge. No overhang at open ends yet.
- Worktops are parts of the pseudo cabinet `ROOM` (`ROOM-WT1` …), length
  along the wall, no edgebanding, no machining; they appear on cutlists and
  DXF exports like cabinet parts.

### D30 · 2026-11-09 · Zones, fixed shelves, wardrobes, templates

- Front zone types: `door`, `drawer`, `open` (no front), `appliance` (a
  niche; with `front: true` a panel fixed to the appliance door, role
  `appliance_front`, handle like a door, no hinges) and `panel` (a fixed
  blind front, role `blind_panel`).
- Fixed shelves (role `fixed_shelf`, FS, carcase material, dowelled into
  the side or middle panel faces like the bottom): between zones where an
  appliance or open zone meets another zone, between stacked door zones,
  and in tall units between zones of different type. Under an appliance
  zone the shelf's top is the zone's lower edge; above it the shelf sits
  one front gap above the zone, so a niche is zone height + gap. Otherwise
  the shelf is centred on the gap. Depth from the back to
  `D − fixed_shelf_setback`. No system holes behind a shelf end (either
  face of a middle panel).
- Adjustable shelves: the tallest door/open zone gets `shelf_count`; when
  fixed shelves split the cabinet, other door/open zones get a share in
  proportion to their height.
- Drawers stop at fixed shelves (floor and ceiling of the drawer).
- Wardrobe interior (`interior`): `hanging` puts a hat shelf (fixed, top at
  `hat_shelf_drop` below the interior top) and a rail (`rail_drop` below
  it, centred in depth) in every section, `hanging_first` / `hanging_last`
  only in the first / last section; other sections get shelves. Rail
  items (category `rail`) are cut to the clear section width (`length`
  param over `LS`); their `end` drilling has `a` along the depth from the
  rail centre and `b` up from the rail axis. Cut lengths are listed with
  the hardware.
- Templates (`FACTORY_TEMPLATES`): plain cabinet input without id for the
  app's add menu, grouped kitchen / storage / wardrobe / bath. Sizes come
  from variables (`oven_h`, `fridge_h`, `wardrobe_h`, `wardrobe_d`, …) or
  presets (`wardrobe`).
- `door_min_w` replaces the fixed 100 mm minimum next to a blind panel.

### D31 · 2026-11-09 · Legs, plinth panels, worktop overhangs and cutouts

- Legs (`hardware.leg`, category `leg`, nullable): floor units (base, tall)
  with `plinth_h > 0`. Rows `leg_inset_side` from the outer sides,
  `leg_inset_front` from the front and `leg_inset_rear` in front of the
  back, with more legs when spacing would exceed `leg_max_spacing`. The
  item's `bottom` drilling goes into the bottom's underside (`a` along X,
  `b` along Z); a leg that meets other machining moves sideways in
  `sys_pitch` steps. The item's limits check `plinth_h`. A drilled leg
  makes the bottom a two-sided part; a screwed leg has no drilling.
- Plinth panels (role `plinth`, `material.plinth`): one per run of floor
  units on a wall with the same plinth height, front face
  `min(D) − plinth_setback` from the wall, height `plinth_h −
  plinth_floor_gap`. In an inside corner the next wall's panel starts at
  the earlier panel's front face and the earlier one ends in the next
  one's front plane. Parts of `ROOM` (PL1 …).
- Worktop open ends (no wall, no floor unit beside, no unit of the
  adjoining wall in the corner) overhang by `worktop_overhang_end`.
- Cutouts: base units with `worktop_cutout` sink/hob put a through pocket
  (`cutout_w` × `cutout_d`, `cutout_front` from the worktop front edge,
  centred over the unit plus `cutout_offset`) into the worktop above, on
  face t1. A cutout that does not fit warns.
- Worktops and plinth panels have part sheets and DXF like cabinet parts;
  the project DXF export includes them.

### D32 · 2026-11-09 · Corner radii on pockets

- A pocket may carry a corner radius `r` in its face plane (worktop
  cutouts: `cutout_r`, factory 10 mm, 0 = square). The outline stays the
  bounding rectangle; dimensions refer to it.
- Part sheets draw the rounded rectangle and add `R<r>` to the legend
  entry. DXF: the pocket polyline gets eight vertices, quarter arcs as
  bulges (tan 22.5° = 0.414214, written with six decimals whatever the
  profile's coordinate decimals), counter-clockwise.
- A radius over half the cutout's smaller side is an error
  (`worktop_cutout_radius`); the cutout is then left out.
- Not yet: radii in the 3D view; CAM tool radius checks.

### D33 · 2026-11-09 · App storage, templates in the shop library

- The app keeps projects locally (IndexedDB; localStorage when IndexedDB
  is unavailable), one document per project plus an index, the shop file
  and UI preferences. Project files stay the exchange format: export,
  import and "Save project" write the same JSON the CLI reads.
- Shop and project libraries may hold `templates`: cabinet input without
  id and place (`kind`, `presets`, `vars`, `options`, `fronts`, `parts`),
  shown in the add menu as "My templates". A preset saved from a cabinet
  takes its vars without `W` and its options.
- Undo/redo works on project snapshots (up to 100), grouped 0.4 s after
  the last change; shop edits are not part of the history.

### D34 · 2026-11-09 · Desktop shell

- Tauri 2 wraps the built web app (`packages/app/dist`); no planner logic
  in Rust. The app detects Tauri (`__TAURI_INTERNALS__`) and uses native
  open/save dialogs; the fs permissions only reach files picked in them.
- Projects live in the webview's IndexedDB inside the app data folder
  (same code path as the browser). SQLite (PLAN.md) waits until project
  sizes or sync need it.
- Installers are built in CI for Windows, macOS (arm64, x64) and Linux;
  unsigned until certificates exist.
