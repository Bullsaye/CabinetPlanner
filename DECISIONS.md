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
