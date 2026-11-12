# Packs

Everything the engine builds with besides its rules comes in packs (D61):
materials, edgebands, surfaces, hardware items, presets and cabinet
templates. A pack is metadata plus a library fragment – the format community
packs have on the server (D49).

```
packs/<id>/pack.json        id, name {en,de}, description, version, licence,
                            author, kind, tags, requires, meta
packs/<id>/<kind>.json      an array of items of one library kind
                            (materials, edgebands, surfaces, presets, templates, …)
packs/<id>/hardware/<item-id>.json   one file per hardware item
packs/index.ts              generated: `pnpm packs` (a test checks it is current)
```

The single-file form of a pack is `{ ...pack.json, content: { <kind>: [...] } }`
(`PackSchema` in `packages/engine/src/packs.ts`); `cabinet-planner pack <dir>`
writes it, `--pack <dir|file>` reads either form.

All packs in this folder are **bundled**: compiled into the app and the CLI,
loaded as the bottom library layer, never copied into a shop file. `core` is
what a cabinet needs with the factory option defaults and cannot be switched
off; the others can be switched off per shop (items in use stay resolvable).

| Pack | Content |
| --- | --- |
| `core` | Generic boards and edgebands, generic fittings, the fittings factory options name (Minifix, Aventos HK top), presets base/wall/tall unit |
| `kitchen-templates` | Kitchen cabinet templates |
| `wardrobe-templates` | Wardrobe templates and the wardrobe preset |
| `storage-bath-templates` | Bookcase, sideboard, bench, vanity, bathroom tall unit |
| `surfaces-basic` | Lacquer tones and laminates |
| `hardware-hettich` | Hettich items |
| `hardware-blum` | Blum items |
| `hardware-grass` | Grass items |
| `hardware-lamello` | Lamello items |

## Hardware items

Schema: `packages/engine/src/hardware/schema.ts`. The file name is the item
id. Rules (DECISIONS.md D15, D18):

- Items hold product data only: dimensions, drilling, the manufacturer's own
  selection rules and limits. Placement preferences (hinge distance from the
  door end, fixed hinge count, …) are cabinet variables.
- Brand items name their sources and articles. Anything not taken from a
  source is stated as an assumption in `source`.
- All items start as `trust: "untested"`. Set `tested` only after a part
  has been machined and fitted.

| Item | Pack | Brand | Notes |
| --- | --- | --- | --- |
| blum-aventos-hk-top | core | Blum | Blum AVENTOS HK top lift mechanism (system screws) |
| dowel-8x35 | core | – | Generic dowel |
| generic-bar-128 | core | – | Bar handles, two through holes Ø5 |
| generic-bar-160 | core | – | Bar handles, two through holes Ø5 |
| generic-bar-192 | core | – | Bar handles, two through holes Ø5 |
| generic-cabinet-connector-screw | core | – | Cabinet connecting screw with sleeve, Ø5 (generic) |
| generic-chipboard-screw-4x50 | core | – | Chipboard screw 4 × 50, countersunk (generic) |
| generic-confirmat-7x50 | core | – | Confirmat screw 7 × 50 (generic) |
| generic-hinge-110 | core | – | Generic cup hinge, factory default |
| generic-knob | core | – | Knob, one through hole Ø5 |
| generic-leg-100-screwed | core | – | Adjustable leg 100, screwed on (generic) |
| generic-leg-100 | core | – | Adjustable leg 100 (generic) |
| generic-leg-150 | core | – | Adjustable leg 150 (generic) |
| generic-leg-knock-in | core | – | Leg with knock-in socket: one bore per leg; placeholder sizes, measure your leg |
| generic-leg-screw-plate | core | – | Leg with screw-on plate: four pilot holes per leg; placeholder sizes |
| generic-undermount | core | – | Generic concealed slide, wooden drawer, factory default |
| generic-wardrobe-rail | core | – | Wardrobe rail Ø25 with end supports (generic) |
| hafele-minifix-15 | core | Häfele | Häfele Minifix 15 cam connector, bolt S100 B (Ø5) |
| shelf-pin-5 | core | – | Generic Ø5 shelf pin |
| blum-cliptop-110-inserta | hardware-blum | Blum | 71B3590 + 173L6100; count rule generic |
| grass-dynapro-40 | hardware-grass | Grass | Dynapro EB 21 40 kg, wooden drawer |
| grass-nova-pro-scala-40 | hardware-grass | Grass | Nova Pro Scala 40 kg, metal sides, front hooks Ø10 × 12 |
| grass-tiomos-110-k3-screw | hardware-grass | Grass | F028138520 (cranking 3) + plate F058139756 (H0, Euro screws) |
| grass-tiomos-110-screw | hardware-grass | Grass | F028138519 + plate F058139757 (H2, Euro screws) |
| hettich-duplo-5 | hardware-hettich | Hettich | Shelf support 46642 |
| hettich-lift-advanced-hk | hardware-hettich | Hettich | Hettich Lift Advanced HK flap fitting with gas springs |
| hettich-rastex-15 | hardware-hettich | Hettich | Hettich Rastex 15 cam connector, Rapid S dowel |
| hettich-sah-130 | hardware-hettich | Hettich | Hettich SAH 130 cabinet hanger, mounting rail type B |
| hettich-sensys-8645i-flash | hardware-hettich | Hettich | Press-in (TH 52) + plate 9071615 (press-in Ø10) |
| hettich-sensys-8645i-screw | hardware-hettich | Hettich | Screw-on + plate 9071625 (Euro screws) |
| lamello-clamex-p14 | hardware-lamello | Lamello | Lamello Clamex P-14 (P-System groove, lever access Ø6) |
