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

### D35 · 2026-11-09 · Back behind the horizontals, dowel sequence, front gaps, top choice

- `back_extent: behind_horizontals` (groove or rebate backs): the back runs
  the full carcase height between the sides, grooved/rebated in the sides
  only; bottom, top, rails and fixed shelves start at the back's front
  face. Needs `carcase_joint: sides_over` (error otherwise).
- `dowel_pattern: sequence`: from the joint's front end `dowel_offset_front`,
  then `dowel_second` behind it, then every `dowel_raster`. The rearmost
  raster position closer than `dowel_offset_rear` to the rear end moves
  forward in `sys_pitch` steps and is dropped when that brings it within
  one pitch of the dowel before. A position blocked by other machining
  moves forward in pitch steps. `grid` keeps the earlier rule.
- Vertical front joints: `front_gap_v` (factory = `front_gap`) feeds
  `front_gap_side` (= half), which feeds `front_gap_left` / `front_gap_right`;
  `front_gap_middle` (= `front_gap_v`) between doors side by side.
  `front_gap` stays the horizontal joint between stacked fronts.
- `top: auto` (new factory value) uses `top.base_unit` (rails or full) for
  base units and a full top for wall and tall units; the kind presets no
  longer set `top`, so a shop can choose its base unit top.

### D36 · 2026-11-09 · Connectors

- `joint_method`: `dowel`, `connector` (item `hardware.fastener`),
  `connector_dowel` (connectors at the first and last position of the
  dowel pattern, dowels at the others), `none`.
- Connector items (category connector) drill relative to a position on
  the joint line: mount `face` into the face part (side) from the joint
  plane, `edge` into the panel end, both `b` across from the panel's
  mid-thickness towards its inner face; `edge_face` into the panel's inner
  face (the face towards the cabinet centre), `b` from the joint plane;
  `a` along the joint towards the front. `op: groove` mills a slot `d`
  wide, `len` long and `depth` deep (P-System groove; undercut not
  modelled). Expressions see `t_edge` and `t_face`.
- Connector positions: the dowel position rule with
  `connector_offset_front/rear` (at least the item's `end_min`) and
  `connector_max_spacing` (at most the item's `spacing_max`).
- The operations of one connector share a `group` and may intersect each
  other (housing and bolt hole); the checker skips those pairs.
- Factory items: Häfele Minifix 15 (S100 B), Hettich Rastex 15 (Rapid S),
  Lamello Clamex P-14, generic confirmat 7 × 50 — untested.

### D37 · 2026-11-09 · Neighbours, visible sides, cabinet screws

- With a room, cabinets are built twice: the room layout tells each one
  which carcase sides are visible (no unit of the same height band
  against it, not against a wall end or a corner run). Options `side.left`
  / `side.right` (`auto`, `visible`, `hidden`) override it; without a room
  `auto` means hidden.
- `cabinet_link: screws`: through holes Ø (item `d`) in the right side of a
  cabinet and the left side of its right neighbour, `link_offset_front`
  behind the shallower carcase front, spread between `link_offset_end`
  from the shared top and bottom, at most `link_max_spacing` apart; a
  blocked position moves by the pitch. The left cabinet's settings apply
  and it carries the screws in its hardware list.

### D38 · 2026-11-09 · Construction elements

- A cabinet may carry `construction`: extra horizontal `panels` (bottom face
  at `y`, shortened by `setbackFront` / `setbackRear`), changes to the
  automatic fixed shelves under zone i (`fixed["i"]`: `panel: false` leaves
  it out, setbacks shorten it), and `noBack` zones. Expressions see
  `zone<i>_y0` / `zone<i>_y1`, the zone's front edges.
- Extra panels are fixed shelves (FS…, dowelled like the others). Panels
  with no rear setback are back stops: with `noBack`, the back splits into
  panels BK1, BK2, … between the stops around zones that keep a back, each
  grooved (or rebated) into the panels it ends at, which then reach into
  the groove. A back that only passes behind a panel does not groove it.
- The tall fridge template uses it: the shelf over the fridge set back at
  the rear (`fridge_vent_rear`), a full panel `fridge_vent` above it, no
  back behind the fridge, a back in the upper section.
- Cabinets record the template they came from (`template`), for the app's
  "save to template".

### D39 · 2026-11-09 · Cabinet hangers, side notches, lift-up flaps

- `hardware.hanger` (category hanger, nullable; wall units only): drilling
  mount `side` on the inside face of each side, `a` below the carcase top
  edge, `b` in front of the back's front face; limits may use
  `back_front_z`. Params `notch_h` × `notch_d` cut a through notch in the
  top rear corner of every hidden side for the wall rail (visible sides
  keep their corner; the rail must end short of them). The notch is cut
  before the joints so dowels keep clear of it. A top or rear rail
  reaching into the notch zone warns (`hanger_rail_blocked`).
- Hettich SAH 130 item: values from the product page and assembly
  instruction; the notch size 29 × 18 is read from an unlabelled drawing
  and must be checked before machining.
- Front zone `flap` (role `flap`, FL): full-width front lifting on
  `hardware.flap`. Front weight = front volume × material `density` +
  2 × `flap_handle_weight`; `LF` = H × weight; `front_kg`, `LF`, `FAo`
  (front overlap on the top) feed the item's params and limits. Drilling
  mount `side`: `a` below the top edge, `b` from the front edge. Items may
  list `variants` (article by a computed value); the hardware list carries
  the chosen article.
- Blum AVENTOS HK top item (system screws): LF ranges 420–9000 in four
  mechanisms, cabinet height 205–600, ≤ 18 kg. Front brackets are screwed
  on and not drilled.
- Materials may give `density` (kg/m³); factory boards carry typical values.

### D40 · 2026-11-09 · Cabinet design and construction editor

- The app splits a cabinet into design (size, material thickness, front
  stack with hinge side per door zone, gaps with advanced top/bottom/left/
  right/middle, handles, plinth or wall height, shelves) and construction
  (carcase, back, joints, panels and back per zone, fittings, all
  variables). Both write the cabinet layer; project and shop defaults have
  their own tabs.
- Front zones may set `hinge` (left/right) for a single door.
- Leaving the construction editor after a change asks: keep for this
  cabinet only, save to its template (asked twice; a factory template gets
  a shop version with the same id that replaces it in the add menu), save
  as a new shop template, or discard. Templates store the whole cabinet
  except id, name, place and template.
- `CabinetResult.layout` exposes the box layout (zones with their
  automatic fixed shelf) for the editor.

### D41 · 2026-11-09 · Rails, shortened bottom, no back, screws with the dowels

- With rails under the top, `rail.front` and `rail.rear` are each `flat`
  (in the top plane, `rail_w` deep), `upright` (standing, `rail_w` high,
  thickness along Z) or `none`. `rail.bottom` adds a rear rail at the
  bottom (`flat` behind the bottom, `rail_bottom_w` deep; or `upright`,
  `rail_bottom_w` high); it needs the bottom shortened by its depth.
  Upright rails need `carcase_joint: sides_over`.
- `bottom_setback_rear` / `bottom_setback_front` shorten the bottom (any
  formula, e.g. `D / 3`). Legs follow the shortened bottom.
- `back_mount: none`: no back panel, no grooves; the interior starts at
  the carcase rear edge.
- Joints run along a line axis: Z for flat panels, Y for upright rails,
  counted from the top for top rails and from the bottom for the bottom
  rail (the dowel rules see the joint as running from its front end).
  Middle panels join flat horizontals only.
- `joint_screws: between_dowels`: a screw (item `hardware.joint_screw`,
  connector drilling: clearance through the side, pilot into the panel
  end) halfway between consecutive dowels of every carcase joint, starting
  between the first two, in every `joint_screw_every`-th gap.

### D42 · 2026-11-09 · Hettich Lift Advanced HK, variant conditions, flap hinges

- Item variants may list further conditions (`and`); the first variant
  whose conditions all hold is chosen, so items list them in order of
  preference (Hettich: the stronger spring first). No match: error
  `hardware_no_variant`.
- Flap scope adds `H_in` (inside height H − 2t) and `flap_top`. Mount
  `front`: into the flap's inner face, `a` below its top edge, `b` from
  the side's inner face (both sides).
- A flap item with param `hinges > 0` hangs the flap on two cup hinges
  (hardware.hinge) at its top edge, at least `hinge_min_from_side` and
  hinge_end_offset from the sides: the hinge's door drilling in the flap,
  its side drilling in the underside of the top or a flat front rail.
- Hettich Lift Advanced HK item: gas spring by inside height and flap
  weight (47 table cells). Side holes from the drawing; the front sleeve
  positions (B + 158 / B + 190) come from a sketch and must be checked.

### D43 · 2026-11-09 · Non-rectangular parts

- A part may carry `outline`: its contour in part-local (u, v), counter-
  clockwise, inside the bounding rectangle. Sizes, cut sizes and the box
  stay the bounding rectangle; the cutlist row is flagged (`outline`) and
  only groups with parts of the same shape.
- DXF: the contour replaces the rectangle on the outline layer. Part
  sheets draw the contour, band along it, and label every corner off the
  bounding rectangle with its coordinates from the origin (X / Y). 3D:
  the contour extruded through the thickness. Assembly drawings still
  show the bounding box.

### D44 · 2026-11-09 · Ceilings, roof slopes, fillers

- Room `ceiling`: flat `height` (default room_height) and `slopes`, each
  starting at a wall's inner face at `knee` height and rising into the
  room at `angle`°. The ceiling at a point is the lowest of these planes.
- Constant `ceiling_h` (room constants like material constants: usable in
  expressions, not settable): the lowest ceiling over the cabinet's carcase
  (its four plan corners). Without a room, or in the first pass, the flat
  ceiling. A height under the roof is a formula, e.g.
  `ceiling_h - plinth_h - ceiling_gap`; the app's "fit height to the
  ceiling" writes it.
- The build runs: pass 1, room layout, per cabinet the ceiling and visible
  sides, pass 2, final room layout (heights changed), then links and room
  checks. Cabinets reaching above the ceiling warn.
- `ceiling_filler: front` (Passblende): flush with the fronts (front
  material, front edgeband all round), from one horizontal gap above the
  top front up to the ceiling line along the front plane minus
  `ceiling_filler_gap` (negative = oversize to scribe), across the fronts'
  width. Where the ceiling slopes it gets an outline with a corner at
  every kink. Below `ceiling_filler_min` it is left out (warning).
- Elevations draw the wall up to the ceiling line; the plan marks where
  each slope meets the flat ceiling; 3D shows the slopes.

> D59–D71 were D45–D57 on the audit branch (claude/repo-audit-multiplatform-n18kd0);
> they were renumbered when that branch was merged with D45–D58 from the
> wardrobe-sections work. Older commit messages use the old numbers.

### D59 · 2026-11-09 · Free construction: parameters, free parts, free bores

The box rule covers the usual carcase; it cannot foresee every way of
building. A cabinet (and so a template) can leave the rule behind step by
step, with everything still a formula:

- `params`: variables the author puts into the simple editor, each with
  name, label, default, limits, step and unit. The default sits under the
  cabinet's own values (source `cabinet` + `param`), limits are checked
  like catalogue limits. The name may be a catalogue variable; then the
  parameter only adds it to the simple editor. Formulas anywhere in the
  cabinet may use parameters.
- `construction.parts`: free parts, role `custom`. A board in one plane
  (`horizontal`: thickness along Y, `vertical`: along X, `frontal`: along
  Z), minimum corner `x`, `y`, `z` and sizes `dx`, `dy`, `dz` as formulas
  in cabinet coordinates (D2); the size across the board defaults to the
  material thickness (D8). `material` is a material option key or a
  material id. Length (and grain) runs along X, for vertical parts along
  Y, unless `grain` names another axis. Edges are named by the direction
  they face in the cabinet (`front`, `rear`, `left`, `right`, `top`,
  `bottom`) and hold an edge option key, an edgeband id or null. `when`
  (formula, 0 = absent) and `repeat` (count; formulas see `i` = 1…n and
  `n`) make parts conditional and repeated.
- Part code = the part's `id` (1–6 capitals/digits), plus the index with
  `repeat`; it must not be a code of the box rule and stays stable (D6).
  Part overrides (`parts.<code>`) apply as for every part. A `name` is
  shown in lists and drawings in place of the role name.
- `joint: auto` (default): wherever an end of the free part lies on the
  face of another panel (not fronts, loose shelves, backs, drawer parts)
  with its whole thickness, the two are joined over the stretch they
  share by the cabinet's construction method, like a fixed shelf (D16,
  D36). The joint is named `<face part>-<free part>`.
- `construction.omit`: codes of box-rule parts to leave out (with their
  joints, grooves and fittings), to replace them with free parts. With
  everything left out, a piece of furniture consists of free parts only
  (factory template `bench`).
- `construction.bores`: free bores in part-local coordinates (D13) on any
  part: `face` (`t0`/`t1` wide faces at the low/high end of the thickness
  axis; `l1`, `l2`, `w1`, `w2` edges, there `u` runs along the edge and
  `v` across the thickness), `u`, `v`, `d`, `depth` as formulas (they see
  `part_l`, `part_w`, `part_t`), `repeat`, `when`. Depth 0, `through` or
  at least the thickness drills through (D23). Source kind `custom`.
  They pass the same checks as every operation (D17).
- `construction.hardware`: extra items for the hardware list, quantity as
  a formula.
- A parameter has a function name (`name`, used in formulas, never
  translated), a display name (`label`) and a `description`; both texts
  may be changed or translated by whoever installs a shared pack without
  touching a formula. Presets carry `params` too: a preset can introduce
  its own variable (default under the preset's values) and use it in its
  values, e.g. `fixed_shelf_setback: board_inset`. `ResolvedCabinet.params`
  lists the parameters in effect (presets of every layer, then the
  cabinet's own; later ones replace earlier ones by name); the simple
  editor shows them.
- Formulas of free parts also see layout facts that follow the back and
  joint rules: `back_front_z`, `carcase_z0`, `inner_x0`, `inner_x1`,
  `inner_y0`, `inner_y1` (a variable of the same name wins).
- Bores and fittings name one part or several (`["SL", "SR"]`: the same
  local position on each, which on the two sides is a mirrored pair), and
  the faces `inner` / `outer` (towards / away from the cabinet centre).
- `construction.fittings`: a hardware item placed on a part at (u, v). Its
  drilling with mount `part` is drilled around that point, `a` along the
  part length and `b` along the width; `mirror` measures v from the
  opposite edge and flips `b` (the copy for the other hand). The item
  counts once per placement in the hardware list. Swapping the item swaps
  the holes.
- Not yet: free grooves/pockets and contours, system hole rows and
  hinges on free parts, angled parts, rotated fitting patterns.

### D60 · 2026-11-09 · DXF and part sheets: contour direction, through pockets

- The outline polyline runs counter-clockwise in every DXF file, also for
  a non-rectangular part (D43) seen from its t0 face, where the stored
  contour would come out clockwise. CAMs take the tool side from the
  direction; rectangle, contour and pockets (D32) now always agree.
- A pocket through the whole thickness (hanger notch D39, worktop cutout
  D31) is not machining of one face: it does not make a part two-sided
  (D22) and does not decide which face is shown. It is drawn solid on
  every sheet and written to the first side's DXF only, like edge bores.

### D61 · 2026-11-09 · Bill of materials and costing

- The BOM (`output/bom.ts`) is computed from the project result only:
  board per material, edgeband per type, hardware and consumables per
  library item, with section totals and the cost share per cabinet
  (worktops and plinth panels under "ROOM").
- Board: net area = finished length × width of every part (D4);
  non-rectangular parts (D43) count with their bounding rectangle, which
  is what is cut from the board. Gross area = net × (1 + `waste_pct` / 100).
- Edgeband: finished length of every banded edge (l1, l2 = length; w1, w2
  = width) plus `edge_allowance` per banded edge.
- `waste_pct` (15) and `edge_allowance` (50 mm) are catalogue variables
  (group costing). Each part uses the values of its cabinet, room parts
  those of the project.
- Hardware: `CabinetResult.hardware` summed per item and chosen variant
  article (two variants of one item are two rows); the article column is
  the variant's number, else all article numbers of the item. Rows are
  ordered connectors and consumables first, then by item id (plain
  code-unit order, like materials and edgebands).
- Prices live on the library items: `pricePerM2`, `pricePerM`, `bom.price`
  (per unit of the item), without a currency (the shop's). Quantities are
  rounded to 0.01 (m², m) first; a row's cost is that quantity × unit
  price, rounded to 0.01; section totals are the sums of the row costs.
  Rows without a price are left out of the totals and counted
  ("n without price"); a sum without any priced row stays empty. The cost
  per cabinet comes from unrounded quantities and may differ from the
  totals by rounding.
- One table for CSV and text: section, item id, name, article no., count
  (parts or edges), net, quantity to order, unit, unit price, cost, note
  (cut lengths of rails). Numbers per D10.

### D62 · 2026-11-09 · Shaped parts in the cutlist, CSV downloads, sheet export

- Written cutlists (CSV, table) mark a non-rectangular part (D43) with a
  remark in the note column, after the part's own note: the sizes are the
  bounding rectangle, the contour is on the part sheet and in the DXF.
  Grouping compares the contour itself, so two different shapes with the
  same bounding rectangle stay two rows.
- CSV files downloaded from the app start with a UTF-8 byte order mark so
  spreadsheet programs read umlauts, ², Ø and × correctly. CLI output and
  the clipboard copy have none (D10 stays as it is for those).
- "All sheets" (`output/sheets.ts`): floor plan and wall elevations, then
  per cabinet the assembly drawing and its part sheets (two-sided parts:
  `-1`, `-2`), then worktops and plinth panels; file names
  `room/…`, `<cabinet>/<part>.svg`. The app offers them as a ZIP of SVGs
  and through the print dialog, one sheet per page, each page as large as
  its sheet (true to scale) or fitted to A4 / A3.

### D63 · 2026-11-09 · Accounts, community packs, library sync

- The cloud is our own small server (`packages/server`): Node 22,
  `node:http`, `node:sqlite`, scrypt, zod; no native modules, one SQLite
  file, self-hostable. (PocketBase/Supabase from PLAN.md could not be run
  and tested here.) The app never needs it: no server address, no account
  and no connection are normal states, shown as a status.
- Errors are `{ error: { code, message } }`; the app translates `code`
  (`cloud.error.<code>`) and never shows `message`.
- A community pack is metadata plus versions; a version's content is a
  library fragment (`LibraryFragmentSchema`, the shape of the library
  section), validated by the server with the engine's schema (unknown
  fields dropped), at most 512 kB. Default licence CC-BY-4.0.
- Trust: `community` → `tested` (author confirms a machined part) →
  `verified` (admin; ends with the next version). On install, hardware gets
  the pack's level as its `trust`, whatever the item said. The first DXF
  export using untested pack hardware asks for a confirmation.
- Installing copies the items into the shop library and records it in the
  shop file (`installedPacks`: pack id, version, item ids, a fingerprint per
  item, renames). Same id: an item unchanged since its install is replaced
  silently; an own or changed item asks – keep both (the pack's item gets
  `<id>-<suffix>` and references inside the pack follow), keep mine, or
  replace mine. A fork is install + publish with `forkedFrom`.
- Deleting an account deletes its packs; installed copies stay with their
  users.
- Sync: one document per user, kind and id with a server revision; a write
  names its base revision and gets 409 plus the server copy when that is
  stale. The app syncs the shop file (`shop/default`): pull at start, push
  2.5 s after a change. When both sides changed, the later change wins and
  the other copy is kept on the device (download / restore / discard). A
  device that still has the untouched example shop takes the server copy.
- No e-mail yet: no address verification, no reset by mail (admin command
  `set-password`). Admins are the accounts named in `ADMIN_EMAILS`.

### D64 · 2026-11-09 · Corrections from the rule audit

Refinements of earlier decisions where the output was geometrically wrong;
the earlier entries stay as written.

- Rear rail at the bottom (D41): a flat rail carries the back's groove or
  rebate like a bottom does. An upright rail stands in front of the back
  (at the back's front face, like the upright rear rail at the top), so
  the bottom must be shortened by the back's offset plus the rail
  thickness.
- Upright rails and the interior (D41): the clear interior ends at the
  lower edge of an upright top rail (`H − rail_w`) and starts at the upper
  edge of an upright bottom rail. Shelf zones, drawers and automatic or
  extra fixed shelves keep to it (`fixed_shelf_outside`,
  `construction_panel_outside` otherwise); a drawer whose floor lies below
  an upright bottom rail ends in front of the rail. Middle panels keep
  their size and get a through notch (pocket, source `joint:<rail>`) for
  every upright rail they cross.
- Dowel sequence (D35): no position moves in front of `dowel_offset_front`.
  A blocked position that cannot move forward moves to the rear in pitch
  steps (up to three, like forward); a rearmost position that cannot keep
  `dowel_offset_rear` without that is dropped.
- Connectors (D36): consecutive connectors of a joint keep at least their
  own length along the joint (slot length or largest Ø) plus
  `bore_min_wall` apart; positions closer than that are left out. A slot
  is only placed where it stays a pocket of its part and clear of bores.
- Item data that cannot be machined is `hardware_drill_invalid`: a
  diameter, blind depth or slot length that is not positive
  (`not_positive`), `through` on a connector's `edge` mount (`edge`).

### D65 · 2026-11-10 · Hinges keep clear of fixed panels

- A hinge whose mounting plate holes would fall on the end of a fixed
  panel (fixed shelf, or a lying free part ending at the hinge side),
  within the hole radius plus `bore_min_wall`, moves towards the middle of
  its door in steps of `sys_pitch` (at most eight) until the plate is
  clear. Cup and plate move together. If no clear position is found the
  hinge stays, and the usual checks report what collides.
- Fronts fixed to an appliance door (integrated fridge, dishwasher) carry
  no hinges (D30); this concerns the doors above and below them.

### D66 · 2026-11-10 · Door handles by grip height

- Door handles (and handles on appliance fronts) no longer follow the
  cabinet kind. `handle_grip_h` is the height above the floor where a
  handle is gripped; the handle sits as near to it as the door allows
  between `handle_end_offset` from its top and bottom ends. Base unit
  doors keep the handle at the top, wall unit doors at the bottom (as
  before); a door spanning the grip height gets it at that height (upper
  and full-height doors of tall units, which had it at their top end).

### D67 · 2026-11-10 · Surface finishes; cutlist columns

- The library holds `surfaces` (finishes on top of the board): id, name,
  kind (melamine, hpl, lacquer, veneer, oil, other), `ref` (RAL / NCS
  tone, decor number) and a display `color`. Materials may carry a display
  `color` too. Colours are for views only.
- Options `surface.carcase`, `surface.front`, `surface.visible_side`
  (surface id, or null: the board as it comes). Fronts (doors, drawer
  fronts, blind panels, appliance fronts, flaps, ceiling fillers) take
  the front surface; sides, bottom, top, rails, middle panels, fixed and
  loose shelves the carcase surface; a side that is visible (`side.left` /
  `side.right`, or seen from the room, D37) the visible-side surface when
  one is set. Backs, drawer boxes, worktops and plinths have none.
- A part override (`parts.<code>.surface`, null = none) wins; free parts
  may name a surface option or id, else they follow their material option.
- `Part.surface` holds the id. Parts that differ only in their surface
  are separate cutlist rows.
- Cutlist columns, in this order: part, cabinet, name, qty, L, W, T,
  material, surface, cut L, cut W, grain, edges L1 L2 W1 W2, note. The
  golden cutlists changed with this entry: column order and the new
  (empty) surface column; no size, quantity or edge changed.
- Not yet: surfaces per face (inside/outside), surface area and cost in
  the BOM.

### D68 · 2026-11-10 · Cabinet view, room optional in the app, wall visibility

- The main view has two modes: **cabinet** (the selected cabinet alone) and
  **room** (all cabinets, in the room when there is one). Without a stored
  choice the cabinet view is the default up to 1100 px width, the room view
  above. On narrow screens the cabinet view carries the cabinet's settings
  below the drawing instead of the slide-in pane.
- The cabinet view is a front elevation to scale, or the single cabinet in
  3D. The elevation is drawn from `frontViewOf(CabinetResult)` (engine,
  `output/frontview.ts`): the built parts as rectangles in cabinet X/Y (D2),
  back to front, hinge positions from the cup bores of the hinge item,
  handles from `CabinetResult.handles`, legs from the fittings. No front
  geometry is computed in the app. Clicking a front selects its zone
  (index into `layout.zones`) in the front builder.
- Opening symbol on doors: preference `hingeSymbol`, `tip_at_hinge` (DIN,
  default) or `tip_at_handle`. Both front drawings also show hinge marks on
  the hinge edge and the handle, so the direction is clear either way.
- A project may have no room in the app too: "work without a room" removes
  `project.room` (cabinets keep their `place` for a later room), and a new
  project can start without one. The 3D view then shows the simple run and
  fits the camera again when the cabinets change.
- Room 3D view: walls are shown `all`, `used` (default: walls named in
  `RoomLayout.placements`) or `none`; openings and roof slopes follow their
  wall. Floor, worktops and plinth panels stay.
- UI preferences kept (D33): language, drawing style, machining, fronts,
  view mode, cabinet 3D, walls, hinge symbol.

### D69 · 2026-11-10 · Arranging by dragging

- In the app's floor plan a cabinet without `place.x` is one of a run:
  dragging it changes the project order (and `place.wall`), never writes
  an x, so runs stay gap-free. A cabinet with `place.x` moves its x, with
  snapping to wall ends, neighbours of its level and opening edges. A
  drag does not turn one kind into the other; the table does.

### D70 · 2026-11-10 · Value rows show what applies

- A value row (variable or option, in every editor and layer) shows the
  value that applies: the resolved number, or the applying choice. There is
  no "inherited" entry and no placeholder. What a row writes is unchanged:
  a number, a formula, or nothing (= inherit).
- Own values of the layer are set in bold with "own" and a reset control;
  values from elsewhere are slightly muted with a short origin label
  (factory, shop, project, preset name, template/parameter). A tap on the
  label explains the origin in a sentence; nothing depends on hover.
- A formula shows its result in the field and `ƒ = formula` under it; with
  focus the field holds the formula. Variable names are offered while
  typing. Findings that carry `variable` are shown under their field.
- The project and shop panes show the values of their own layer (resolved
  without a cabinet), not those of the selected cabinet.
- The construction editor follows the furniture: carcase, top and bottom,
  back, panels and compartments, fronts, joints, fittings, free
  construction. Settings about the room (visible sides, linking to
  neighbours, ceiling filler, worktop cutout) sit in a collapsed "In the
  room" section at its end.
- While a row has focus, the parts it is about are highlighted in 3D
  (`store.ui.highlight`, by part role).
- `diagnosticText` (i18n) translates enumerated parameters of findings
  (opening kind, cutout kind, layer).

### D71 · 2026-11-10 · Fixed shelves between fronts, shelves per compartment, box height, blind panel fixing, leg fixing, through bores

Corrections from the first shop test. The earlier entries stay as written.

- Fixed shelves between fronts (supersedes the list of cases in D30): a
  fixed shelf lies at every boundary between two front zones, in every
  cabinet kind, except between two drawers. Position as in D30 (under /
  over an appliance niche, else centred on the gap). `construction.fixed["i"]`
  with `panel: false` leaves the shelf under zone i out; an entry with
  `panel: true` (the default of an entry) between two drawers, where the
  rule puts none, adds one. An entry for a boundary that does not exist
  warns (`construction_fixed_unknown`). A drawer over a shelf stands on it
  (slide `axisMin` above the shelf), so its box is lower than before.
- Flaps count like doors. The fitting sees the flap's compartment as its
  cabinet: `H` = from the underside of the panel below the flap to the top
  face of the panel above it (carcase bottom / top at the ends), and `LF`,
  `H_in`, `FAo`, `flap_top` follow; mount `side` measures `a` below that
  top face; cup hinges of a flap (D42) go into the underside of the panel
  above it (top, flat front rail or fixed shelf). A flap whose shelf above
  was left out is an error (`flap_no_panel_above`, nothing drilled for the
  fitting), one whose shelf below was left out a warning
  (`flap_no_panel_below`).
- Shelves per compartment: a door, open or flap zone may set `shelves`
  (number or formula, whole number from 0); it wins for that zone. Without
  it the rule of D30 applies (flap zones: none). Other zone types ignore
  the value. Extra panels (`construction.panels`, D38) inside a zone split
  it into compartments; the zone's shelves are shared out by compartment
  height (largest remainders, the lower compartment first on a tie), so no
  shelf lands on a panel. The simple editor adds such panels ("+ fixed
  shelf": middle of the tallest compartment between lying carcase panels).
- Drawer box height: `drawer_box_h` (0 = as high as fits, the factory
  value), per drawer zone `boxH` (number or formula; wins). Wooden boxes
  get exactly that side height when it fits under `drawer_clearance` and
  the panel above (`drawer_box_too_high` otherwise, built as high as fits)
  and is at least `drawer_box_min_h` (`drawer_box_too_small`). Metal sides:
  the largest height of the system that fits and is not above the value.
  An inner front too low for two rows of front screws (D26) gets one row
  at mid-height.
- Fixed blind panels (role `blind_panel`: blind corner, panel zones),
  option `blind_panel.fixing` = `auto` (factory) or `none`. A carcase part
  standing behind the panel with its face (upright front rail, free
  frontal part) is screwed through from inside like a drawer's inner front
  (D26): Ø `front_screw_d` through holes, `front_screw_side` /
  `front_screw_edge` inside the area both share, one row or column where
  that is too small. A part that meets the panel only with its front edge
  (side, bottom, top or flat front rail, fixed shelf, middle panel, lying
  or standing free part) is dowelled to it (item `hardware.connector`,
  face depth into the panel, edge depth into the edge), on the part's
  mid-thickness line where the panel covers it with Ø/2 + `bore_min_wall`:
  first and last `blind_dowel_offset` from the ends of the shared stretch,
  at most `blind_dowel_max_spacing` apart, on whole millimetres; a
  position meeting other machining is left out. The dowels are in the
  hardware list. A panel lying on nothing warns (`blind_panel_not_fixed`).
  Screws from inside into a panel that only lies on edges are not possible
  without an extra part; the box rule adds none (a post is a free part).
- Leg fixing: the item's `bottom` drilling (D31) is a list, so one item
  expresses a knock-in socket (one bore of the socket's Ø and depth per
  leg, `generic-leg-knock-in`), a plate with pilot holes (several bores
  around the leg centre, `generic-leg-screw-plate`) or nothing drilled
  (`generic-leg-100-screwed`). The two new items carry placeholder sizes,
  marked as such in `source`.
- Through bores: a through bore (D23) is an opening in both faces. Part
  sheets draw it solid on the sheet of the far face too (dimensioned only
  on its own sheet); the scene lists its far opening as a second entry
  (`exit`, same hole, opposite face and direction) and marks both
  `through`, so the 3D view shows it from both sides.
- Golden files changed: reference `base-600-dynapro-drawer-door` (fixed
  shelf FS1 between drawer and door, 8 dowels more, rail axis one grid
  line higher, drawer box 133 → 101 high) and the example kitchen's BOM
  (10 dowels more: the blind corner panel of B05).
