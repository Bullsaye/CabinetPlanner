# UI mockups (first pass)

Source files of the design canvas "Cabinet Planner UI". Not final — they set the feel only. All dimensions, cutlist values, authors and counts are illustrative.

| File | Screen |
| --- | --- |
| `Main.dc.html` | Desktop · Plan: cabinet run, flat-shaded 3D view, live cutlist, inspector with value sources (Shop / Project / Override) |
| `Hardware.dc.html` | Desktop · Hardware editor: identity, parameters, selection rule, drilling pattern, preview on a test side panel, checks |
| `Tablet.dc.html` | Tablet · Plan (landscape, 1180 × 820): touch steppers, zone chips, expression keypad, offline indicator |
| `Community.dc.html` | Desktop · Community browse: search, type tabs, trust/brand/construction/machine filters, pack cards |
| `Pack.dc.html` | Desktop · Pack detail + import: preview on your cabinet, contents vs. your library with conflict choices, import target, trust warning |
| `canvas.json` | Layout of the artboards on the canvas |

The `.dc.html` files are Design Component sources: they render inside the Claude Design canvas (they load its `support.js` runtime), not as standalone pages. Treat them as visual reference for the real Svelte UI.

Design decisions to carry over:

- Neutral greys, one blue accent, monospace for every dimension.
- Flat-shaded boxes only, no textures, no realistic rendering.
- Every value shows where it comes from and can be reset to inherited.
- Touch targets ≥ 44 px on tablet; expressions typed on a keypad.
- Community data is labelled by trust level; untested drilling data warns before the first CNC export.
