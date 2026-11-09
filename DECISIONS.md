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
before the first machined part.

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
