# Part drawings

Drawings are for people who drill by hand or prefer paper to files, so they
must be right and easy to read. This page describes the conventions
(DECISIONS.md D19, D20) and how shops adapt them.

## Views

| View | Use | Layout |
| --- | --- | --- |
| Machine | CNC operator, manual drilling with stops | Inner face up, **front edge on the reference** (bottom of the sheet = machine Y 0), origin at the bottom-left corner. A right side has its origin at the lower front corner; a left side at the upper front corner (true mirror, same face up). |
| Assembly | Workshop, checking parts against the cabinet | Parts as if the cabinet were unfolded: sides upright, seen from inside, folded outwards (front edge and banding on the left for a left side, on the right for a right side). Bottom flipped down (seen from above), top flipped up (seen from below). |

Each sheet states which face is shown and where the origin is, e.g.
"inner face shown · origin: front edge × bottom edge". Edge names (front,
rear, top, bottom …) and edgeband codes are written inside the part outline.

## Dimensioning

Based on ISO 129-1 practice for positions that must not drift:

- **Running dimensions from one origin** (default). Every position is
  measured from the reference corner, so errors do not add up. The origin
  carries the ISO origin mark (small circle).
- **Chain dimensions** (style `machine-chain`): feature to feature. Only
  where accumulated error does not matter.
- **Patterns**: rows and columns of at least 3 holes at one pitch are given
  once: first and last position on the axes, `row of 19 at 37, 32 apart,
  73.5 to 649.5` in the legend. This removes most numbers from a side.
- **Tags and legend**: every group of identical features (same source, Ø,
  depth and face) gets a letter at its first feature and a legend line:
  count, Ø × depth, what it is (system holes, dowels SL-BO, the hinge by
  name), which face.
- **Coordinate table** (style `assembly`): X/Y of every hole except
  patterned system holes, for drilling from a table.
- **Readable text**: numbers upright by default, all in one row below the
  part and one column left of it; labels that would touch are pushed apart
  and joined to their tick with a jogged leader. Style `machine-iso` writes
  values along the extension lines as ISO 129-1 does.
- **To scale** on A4/A3 (1:5 for most carcase parts), portrait or landscape
  to suit the part, 2.5 mm text, mm, up to two decimals (no rounding away
  of real positions such as a groove at 541.75).

## Styles

Factory styles: `machine` (default), `machine-iso`, `machine-chain`,
`assembly`. A shop defines its own in the shop file (or a project file)
under `library.drawingStyles`:

```json
{
  "id": "my-shop",
  "name": "My shop sheet",
  "extends": "machine",
  "dims": { "textHeight": 3 },
  "show": { "table": true },
  "rules": [
    { "match": { "source": ["joint"], "role": ["bottom", "top"] }, "positions": "none",
      "note": "Edge dowels in horizontal parts follow the side; no need to dimension them" }
  ]
}
```

Use it with `pnpm cp drawing project.json --shop shop.json --part B01-SL --style my-shop`.

### Rules

A rule has a selector and settings:

| Selector | Matches |
| --- | --- |
| `source` | `system`, `joint`, `hardware`, `back` |
| `ref` | source reference prefix, e.g. `SL-` (joints of the left side) or `grass-` (Grass hardware) |
| `where` | `face` (viewed face), `far` (opposite face), `edge` |
| `op` | `bore`, `pocket` |
| `d` | diameter |
| `role`, `part` | part roles (`side_left`, `bottom` …) or one part id |

| Setting | Effect |
| --- | --- |
| `positions` | `all`, `pattern` (first/last of rows), `none` |
| `tag` | letter tag and legend line |
| `table` | rows in the coordinate table |
| `hide` | do not draw |
| `label` | legend text instead of the generated one |

Settings cascade: for each setting, the first matching rule that sets it
wins. A rule therefore changes only what it names; everything else keeps
coming from the rules after it and finally from the factory style.

## Teaching (planned UI)

The rule format is designed so the app can learn from corrections made on a
drawing, without anyone writing JSON:

1. The user clicks a dimension, tag or feature and picks an action: *don't
   dimension*, *dimension as pattern*, *put in table*, *hide*, *rename*.
2. The app proposes the narrowest selector for what was clicked (the
   feature group: source, Ø, face, this part role) and asks how far it
   applies: **this part**, **all parts like this** (role), **everywhere**.
3. The answer becomes a rule placed in front of the style's rules, stored in
   the project or the shop file (with `note` saying who taught it and when).
4. Every taught rule is listed under the style and can be edited or
   removed; "reset to factory" removes them all.

Settings that are not per feature (text height, view, chain vs. running,
paper) are plain style settings, edited directly.

Later: layout corrections (dragging a dimension to the other side) map to
the same mechanism once dimension placement becomes rule-driven.
