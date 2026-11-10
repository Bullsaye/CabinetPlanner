# Attic wardrobe – recreating a hand sketch

An exercise to find out what the planner can and cannot do: a wardrobe
drawn by hand ("Kleiderschrank", Nov 2026) was rebuilt in the app, the gaps
were fixed, and the build was repeated until it matched. Files:

- `examples/attic-wardrobe.project.json` – as sketched: bottom and top
  between the outer sides, the middle panel between bottom and top.
- `examples/attic-wardrobe-through.project.json` – the same wardrobe with
  the middle panel running through and two bottoms and tops.

Open them in the app (File → Open project or shop file) or with the CLI:

```sh
pnpm cp cutlist examples/attic-wardrobe.project.json --shop examples/shop.json --format table --group --lang de
```

## The sketch

1050 × 1720 × 475, 19 mm board, on 60 mm legs, under a 45° roof slope that
cuts the top right corner (280 across, 280 down). A middle panel divides two
sections of 496.5 clear width. Each section, top to bottom: an open
compartment (269 clear), a door 1025 × 521, two drawers 161 and 235 high
(four drawers in all). Left: three shelves; right: a hanging rail.
Clear heights 269 / 1000 / 375 (+ 4 × 19 = 1720). 4 mm gaps between
fronts, 2 mm at the outer edges, 4.5 mm at the bottom. Back in a groove
all round, also along the slope.

Read from the sketch with the author's answers: legs (not a plinth frame),
a real roof slope (room modelled), the top between the sides with mitres,
open compartments above the doors, the back cut along the slope.

## Round 1 – what the app could not do

| Sketch | First build | Why |
| --- | --- | --- |
| Middle panel 1682 × 455 | left out (warning) | middle panels were dropped as soon as a cabinet had drawers |
| 4 drawer fronts 521 wide | 2 fronts 1046 wide | fronts always spanned the whole cabinet |
| 3 shelves left, rail right | rail + hat shelf over the full width | follows from the dropped middle panel |
| Rail directly under the fixed shelf | always a hat shelf 330 below the top | no option |
| Right side 1440, top 769.9, slope 396.2 | rectangular carcase, warning "280 mm above the ceiling" | roof slopes only shaped the ceiling and the Passblende |
| Back cut along the slope | rectangular | – |
| Knobs on the drawers | one handle for the whole cabinet | – |
| 60 mm legs | error: legs 90–125 only | worked around: a 60 mm leg defined in the project's own library |

Also found along the way:

- **Bug:** with the shop's `dowel_pattern: sequence`, any cabinet with a
  middle panel and fixed shelves failed the check. The second face's dowel
  was moved onto the panel edge.
- **Bug:** extra construction panels (used to place the fixed shelves at
  the sketch's 394 / 1413) were ignored by shelves, rails and drawers. They
  still used the switched-off automatic shelves.

## What was built (branch `claude/wardrobe-sections`)

| Decision | What |
| --- | --- |
| D45 | Blocked sequence dowels also move half a pitch and never closer than the end offset to an edge. |
| D46 | **Sections**: each with its own fronts, interior (shelves / hanging), shelf count, width and construction; the middle panel stays with drawers; hinges, slides and drawer front fixing use the section's panels. Option `hat_shelf`. Option `partition_joint: through` (middle panel full height and depth, bottom/top/rails and the back split per section). Zone ranges respect extra construction panels. Zones may set their own shelf count. |
| D47 | **Sloped top corners**: `slope_left/right_drop` and `_angle`. Side and top shortened and mitred, a sloped panel (TS) with the back's groove, the back cut to the slope, shelves, fixed shelves and middle panels under it cut to it. Mitres in the cutlist note and part sheets. Cross-sections in 3D and the assembly drawing. System holes stop below the cut. The room's ceiling check and wall elevation follow the cut outline. Under a room slope: `max(0, H + plinth_h - ceiling_h)`. |
| D48 | **Handle per front zone** (item or none). |
| App | Front builder: split into sections, per-section tabs (width, interior, shelves), per-section stacks, zone shelf count and handle; sloped-top fields with "slope to the ceiling"; preview shows sections and the slope. |

## Result – as sketched (variant A)

| Part | Sketch | App | |
| --- | --- | --- | --- |
| Side left | 1720 × 475 | 1720 × 475 | ✅ |
| Middle panel | 1682 × 455 | 1682 × 455 | ✅ |
| Side right | 1440 × 475 | 1440 × 475, mitre 22.5° | ✅ |
| Bottom | 1012 × 475 | 1012 × 475 | ✅ |
| Fixed shelves (Q mi) | 496.5 × 455 × 4 | 496.5 × 455 × 4 | ✅ |
| Top (Q ob) | 769.9 × 475 | 751 × 475, mitre 22.5° | see note 1 |
| Slope (Q Schräge) | 396.2 × 475 | 395.98 × 475, mitres 22.5° | see note 2 |
| Plinth | × 60 | 1050 × 57 | see note 3 |
| Doors | 1025 × 521 × 2 | 1025 × 521 × 2 | ✅ |
| Drawer fronts, upper | 521 × 161 × 2 | 521 × 161 × 2 | ✅ |
| Drawer fronts, lower | 521 × 235 × 2 | 521 × 235 × 2 | ✅ |
| Back | 1702 × 1032 | 1702 × 1032, cut along the slope | ✅ |
| Shelves | 495.5 × 445 × 3 | 495.5 × 445 × 3 | ✅ |

Plus everything the sketch leaves out: four wooden drawer boxes, 6 hinges,
4 slide sets, the rail cut to length, 6 legs, 12 shelf pins, 4 knobs,
2 bar handles and 65 dowels.

Notes:

1. With the top **between** the sides it ends 19 mm short of the sketch's
   769.87, which is measured from the outer left edge (1050 − 280.13). 769.9
   would be a top running over the left side, but then the left side would
   be 1701, not 1720.
2. The drop follows the modelled room: knee wall 1500 above the floor with
   60 mm legs gives 280.0; the sketch has 280.13.
3. Plinth panels stand `plinth_floor_gap` (3 mm) off the floor; set it to 0
   for 60.

## Variant B – middle panel through

`partition_joint: through`: middle panel 1720 × 475 (full height and
depth), bottoms and tops 496.5 each, the right top 235.5 up to the slope,
two backs 1698 × 512.5 grooved into the middle panel's faces. Building it
found two more problems, now fixed:

- The through middle panel stood in front of a one-piece back, leaving an
  open slot at the rear between the split tops and bottoms. Now it runs the
  full depth and the back is split per section.
- With sides *between* bottom and top, the through middle panel stood on the
  bottom pieces. Now it always runs from the bottom edge to the top edge.

New check: two back grooves of 10 mm from both faces of a 19 mm middle panel
cut through it (error `back_grooves_meet`), so variant B uses 8 mm grooves.

Comparison: A needs one long bottom, top and back (fewer parts, a stiffer
carcase, the sketch's cutlist). B has smaller parts (the bottoms and tops
fit offcuts), the middle panel takes the load straight to the legs, and the
sections can be assembled separately. It needs 75 instead of 65 dowels and
two backs.

Other combinations, all built without errors: sides between, connectors
(Minifix), connector + dowel with the middle panel through, back behind the
horizontals, rebate, surface back, grid dowels, hat shelf on.

## Still missing or cumbersome

- **Mitres are not drilled.** The three mitre joints (top/slope/side) would
  need angled bores (5-axis or an angle aggregate); the app warns and they
  are joined by hand (Clamex, biscuits, glue).
- **Parts under the slope** are now cut to it (shelves square, fixed
  shelves and middle panels bevelled), but their joint with the sloped
  panel is not drilled either. Rails, drawers and fronts are not cut: a
  door reaching above the slope gets a warning, and its top hinge then has
  no side to go into (error).
- **Slopes only across the width.** A roof sloping down towards the back
  wall (cutting the side's rear top corner) is not supported, and neither
  are slopes meeting in the middle (gable).
- **Bevels are not in the DXF.** They are saw operations; the cutlist note
  and part sheet show them.
- **The mitre in the top/slope part list** of the assembly drawing is not
  shown (cutlist and part sheets only).
- **With sections:** flaps, blind corners and backs left out per zone
  (`noBack`) are not supported yet (diagnostics say so).
- **Section construction in the app:** the construction editor edits the
  cabinet-wide construction (applied to every section) using the first
  section's zones; per-section construction only in the file.
- **Handle placement** rules (vertical/horizontal, offsets) are cabinet-wide;
  only the item can be set per zone.
- **3D view:** the camera fits the whole room, so a single cabinet looks
  small; there is no "zoom to cabinet".
- `svelte-check` does not run with the installed TypeScript 7 (needs TS 6
  alongside), so the app is checked with `vite build` and by driving it.
