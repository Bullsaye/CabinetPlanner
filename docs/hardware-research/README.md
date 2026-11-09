# Hardware research

Raw data collected from manufacturers' public documents (product pages,
catalogues, assembly instructions), one JSON file per brand group. Each item
lists its values, drilling, rules, the source URLs and a confidence level.
Values with `null` were not found in a readable source.

These files are research notes, not library items. Library items are built
from them in `packages/engine/library/hardware/`, with the sources named in
each item's `source` field and `trust: "untested"` until a part has been
machined and checked.

| File | Brands | Collected |
| --- | --- | --- |
| blum.json | Blum CLIP top, plates, LEGRABOX, MOVENTO, TANDEMBOX | 2026-11-09 |
| hettich.json | Hettich Sensys, plates, AvanTech YOU, Actro 5D, Rastex, VB, Duplo | 2026-11-09 |
| lamello-keku.json | Lamello Clamex P, Tenso P, Divario, Cabineo; Keku (not reachable) | 2026-11-09 |
| grass-hafele.json | Grass Tiomos, plates, Dynapro, Nova Pro Scala, Vionaro; Häfele Minifix, Symo, AXILO, shelf supports | 2026-11-09 |
