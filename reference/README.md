# Reference cabinets

Each `cabinets/<name>.project.json` must produce exactly
`expected/<name>.cutlist.csv` and `expected/<name>.ops.txt` (machining and
hardware, part-local mm, byte for byte). The test is
`packages/cli/test/reference.test.ts`.

**Status: unverified.** The expected values are derived from the rules in
`DECISIONS.md` and checked by hand for the base 600 (see
`packages/engine/test/box.test.ts` and `systems.test.ts`), not measured on a
built cabinet. Hinge, dowel and shelf-pin data are generic seed values. Replace
or confirm them with real shop cabinets as they become available, and mark
each confirmed file in the table below.

| Cabinet | Covers | Verified |
| --- | --- | --- |
| base-600-door | Factory defaults: rails, back in groove, 1 shelf, 1 door | – |
| base-450-open | No door, no shelf | – |
| base-500-oak | Grain material, 0.5 mm veneer edge | – |
| base-600-rebate-back | Back in rebate | – |
| base-600-surface-back | Surface back, no edge deduction | – |
| tall-600-sides-between | Sides between, full top, 4 shelves | – |
| wall-800-two-doors | Full top, 2 doors, shallow depth | – |
| base-600-drawers-3 | Front stack 150/150/rest, generic slide, wooden boxes | – |
| base-600-dynapro-drawer-door | Grass Dynapro drawer over a door, shelf in the door zone | – |
| base-800-novapro-3 | Grass Nova Pro Scala, fronts by formula, metal sides | – |

After an intended rule change: `pnpm test -u`, then review `git diff
reference/expected` line by line before committing.
