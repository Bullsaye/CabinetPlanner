# Factory hardware library

One JSON file per item; the file name is the item id. Schema:
`packages/engine/src/hardware/schema.ts`. Every file must be registered in
`src/hardware/factory.ts` (a test checks this).

Rules (DECISIONS.md D15, D18):

- Items hold product data only: dimensions, drilling, the manufacturer's own
  selection rules and limits. Placement preferences (hinge distance from the
  door end, fixed hinge count, …) are cabinet variables.
- Brand items name their sources and articles. Anything not taken from a
  source is stated as an assumption in `source`.
- All items start as `trust: "untested"`. Set `tested` only after a part
  has been machined and fitted.

| Item | Brand | Notes |
| --- | --- | --- |
| generic-hinge-110 | – | Generic cup hinge, factory default |
| dowel-8x35 | – | Generic dowel |
| shelf-pin-5 | – | Generic Ø5 shelf pin |
| hettich-sensys-8645i-screw | Hettich | Screw-on + plate 9071625 (Euro screws) |
| hettich-sensys-8645i-flash | Hettich | Press-in (TH 52) + plate 9071615 (press-in Ø10) |
| hettich-duplo-5 | Hettich | Shelf support 46642 |
| blum-cliptop-110-inserta | Blum | 71B3590 + 173L6100; count rule generic |
| grass-tiomos-110-screw | Grass | F028138519 + plate F058139757 (H2, Euro screws) |
| grass-tiomos-110-k3-screw | Grass | F028138520 (cranking 3) + plate F058139756 (H0, Euro screws) |
| generic-undermount | – | Generic concealed slide, wooden drawer, factory default |
| grass-dynapro-40 | Grass | Dynapro EB 21 40 kg, wooden drawer |
| grass-nova-pro-scala-40 | Grass | Nova Pro Scala 40 kg, metal sides (front hooks not drilled yet) |
| generic-bar-128 / -160 / -192 | – | Bar handles, two through holes Ø5 |
| generic-knob | – | Knob, one through hole Ø5 |
