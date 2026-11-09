# CNC export (DXF)

Every part becomes one DXF per machined side, in the same frame as its part
sheet: machined face up, front edge on the reference (machine Y 0), origin
at the reference corner, mm. A door with hinge cups inside and handle holes
outside gives `B01-DO1-side1.dxf` and `B01-DO1-side2.dxf`.

```sh
pnpm cp dxf project.json --shop shop.json --zip kitchen-dxf.zip
pnpm cp dxf project.json --cabinet B01 --out dxf/
pnpm cp dxf project.json --part B01-SL --out dxf/ --profile my-maestro
```

In the app: Drawings → CNC (DXF) → this part / this cabinet / whole project
(always a zip).

## Layers

| Feature | Entity | Layer (profile `generic`) |
| --- | --- | --- |
| Panel outline | closed POLYLINE, thickness −t | `CONTOUR` |
| Bore from the face | CIRCLE, thickness −depth | `DRILL_V_D5_Z13` |
| Through bore | CIRCLE, thickness −t | `DRILL_V_D5_THROUGH` |
| Bore into an edge | LINE from the edge inwards, length = depth | `DRILL_H_D8_Z25_XM` (edge XM/XP/YM/YP) |
| Groove, rebate, pocket | closed POLYLINE, thickness −depth | `POCKET_Z8` |

Decimal points in layer names become `P` (Ø5.5 → `D5P5`).

## Matching your CAM (e.g. SCM Maestro)

Maestro assigns machining technologies by layer name. Instead of renaming
layers by hand, add a profile to the shop file and pick it on export:

```json
"library": {
  "dxfProfiles": [
    {
      "id": "my-maestro",
      "name": "Maestro, our technologies",
      "layers": {
        "outline": "PANEL",
        "bore": "V_{d}_{depth}",
        "through": "V_{d}_T",
        "edgeBore": "H_{d}_{depth}_{z}_{edge}",
        "pocket": "GROOVE_{depth}"
      },
      "thickness": true
    }
  ]
}
```

Placeholders: `{d}` diameter, `{depth}`, `{z}` axis of a horizontal bore
below the top face, `{edge}` the edge it enters (`XM` X min, `XP` X max,
`YM` Y min = front edge, `YP` Y max), `{t}` panel thickness.

Native machine programs (post-processors) come later.
