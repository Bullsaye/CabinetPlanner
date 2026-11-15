# Drawing conventions: research note

How cabinetmaker drawing standards and common planning software show
opening symbols, hinges, hatching, edgebanding, grain and dimensions, and
how Cabinet Planner compares. Written 2026-11-13 for D78.

**How this was researched.** Web search only. The standards themselves
(DIN 919-1, DIN 1356-1, ISO 7519, ISO 128, ISO 129) are paid documents
and the publishers' sites (din.de, dinmedia.de) could not be opened from
this environment, nor could most PDFs. Everything below comes from search
excerpts of the pages listed; "not verified" marks what no source
confirmed. Nothing here quotes a standard's text.

## 1. Opening symbol on doors and flaps

### What the sources say

| Source | Kind | Says |
| --- | --- | --- |
| [clean-invoice.com: DIN links oder rechts (Fenster)](https://www.clean-invoice.com/wissen/allgemein/din-links-oder-rechts-fenster) | German window guide | Triangle tip points to the **handle side**, the line ends run to the hinge side. Tilt: triangle from the bottom corners pointing up. Solid lines = opens inwards, dashed = outwards. Window drawings usually show the view from inside. |
| [fensterblick.de: DIN-links/rechts](https://www.fensterblick.de/fenster-din-links-rechts.html), [Öffnungsarten](https://www.fensterblick.de/fenster-oeffnungsarten.html) | German window maker | Tip always points to the handle; the wide side of the triangle is where the hinges are ("Spitze zeigt nach rechts = DIN links"). Tilt-and-turn: two triangles, the tilt one pointing up. |
| [fenster-schmidinger.at: Stulpfenster](https://www.fenster-schmidinger.at/stulpfenster/) | Austrian window maker | The only German-language source found with the opposite wording: tip points to the hinge side ("zur Bandseite"). |
| [Vectorworks forum: Fenster-Öffnungslinien in der Ansicht](https://www.vectorworksforum.eu/topic/9453-fenster-%C3%B6ffnungslinien-in-der-ansicht/page/2/) | German CAD forum | Opens towards the viewer: solid line; away from the viewer: dashed. "Not only one truth." |
| [Archicad 27 help: Öffnungslinien (Tür/Fenster)](https://help.graphisoft.com/AC/27/GER/_AC27_Help/151_DoorWindowCustomSettings/151_DoorWindowCustomSettings-14.htm) | Architectural CAD | Setting "Linienausrichtung: Bänder oder Griff": the software offers both directions. |
| [Graphisoft community: door open direction in elevation](https://community.graphisoft.com/t5/Modeling/Door-Open-Direction-in-Elevation-View/td-p/169780) | Forum | A user finds Archicad's triangle "opposite from our habit here". |
| [Winner Design support (Compusoft), DA](https://winnerdesign.support.compusoftgroup.com/hc/da/articles/360010892477-%C3%86ndre-udseendet-af-h%C3%A6ngselsymboler-i-opstalt-billedet-USA-Europa) | Kitchen planning software | Hinge symbols in elevation differ between the USA and Europe and are switched by a setting: US `\|<\|` for a left-hand door, Europe `\|>\|` for a left-hand door. Read with the usual meaning of "left-hand door" (hinges left), Europe puts the tip at the handle. The English page was not found; the reading of "left-hand" is ours. |
| [Chief Architect KB-03150](https://www.chiefarchitect.com/support/article/KB-03150/displaying-door-and-window-opening-indicators.html) | US home/cabinet CAD | Opening indicators point to the hinge side by default. |
| [CADTutor forum](https://www.cadtutor.net/forum/topic/37630-door-elevation-symbol), [CGarchitect forum](https://forums.cgarchitect.com/topic/19752-drawing-symbols) | English-language drafters | Dashed lines converge on the hinge side; others "do it the other way round". |
| [iDigHardware: vision panel alert](https://idighardware.com/2019/08/vision-panel-alert/) | US door hardware blog | In Australia and New Zealand the point goes to the latch side. |
| [Baunetzwissen: DIN-links und DIN-rechts](https://www.baunetzwissen.de/fenster-und-tueren/fachwissen/konstruktion-funktion/din-links-und-din-rechts-155269) | German reference | Handing (DIN 107) is named from the side where the hinges are visible. Says nothing about the symbol. |
| [DIN 919-1:2014-08 (catalogue)](https://www.dinmedia.de/de/norm/din-919-1/206892969), [draft of a new edition](https://www.dinmedia.de/en/draft-standard/din-919-1/405364762) | Standard | Current standard for woodworking drawings; a revision is in draft. **Its rule for opening symbols could not be read.** |
| [Holztechnik textbook, contents](https://beckassets.blob.core.windows.net/product/readingsample/12419885/9783808541173_excerpt_004.pdf) | Textbook (Europa) | Has sections "Möbel mit Klappen / Schiebetüren / Schubladen" and "Maßlinienbegrenzung bei Möbeltüren und Klappen" under furniture drawings to DIN 919. Only the contents were visible. |

### Reading

- No source showed what DIN 919-1 itself prescribes. **The claim in D68
  that "tip at the hinge" is the DIN form is not supported** by anything
  found; the German-language sources mostly say the opposite.
- German and European practice (window elevations, the European setting of
  a kitchen planning program) puts the **tip at the handle**, the base on
  the hinge side. US practice (Chief Architect default, most English forum
  answers) puts the tip at the hinge side. Australia/New Zealand: handle side.
  Architectural CAD offers both.
- So D73's default `tip_at_handle` agrees with the sources found for
  German practice. Not verified against the text of DIN 919-1.
- Line style: one forum source gives "solid = opens towards the viewer,
  dashed = away"; a window guide gives "solid = inwards" with the view from
  inside, which is the same rule. Cabinet fronts open towards the viewer,
  so by that rule the lines would be solid. Not verified for furniture
  drawings; US cabinet elevations commonly use long dashes.
- Tilt windows (hinges at the bottom) point up. By the same logic a
  lift-up flap (hinges at the top) points down with the tip at the handle,
  which is what we draw.
- Drawers: no standard symbol found. One German shop marks a small cross
  where the knob or handle goes ([woodworker.de: Planzeichen
  Schublade](https://www.woodworker.de/forum/threads/planzeichen-schublade.44770/)).
  Note: in DIN 919 drawings a diagonal cross marks a **flat surface**
  ([Europa-Lehrmittel sample](https://www.europa-lehrmittel.de/leseprobe/41113-11.pdf)),
  so drawing a cross on a drawer would be misleading.
- Sliding doors: an arrow in the sliding direction is common; no standard
  text was found. Not relevant yet (no sliding doors in the engine).
- Software not found: imos, Pytha, Polyboard, Cabinet Vision, Palette CAD,
  KD Max, Microvellum, Blum DYNAPLAN/E-Services and Hettich planning tools
  have no public documentation of their opening symbols that the search
  found. Not verified.

## 2. Hinge position marks

No standard rule found. Planning software shows hinges as symbols or
3D fittings; the [Winner Design article](https://winnerdesign.support.compusoftgroup.com/hc/articles/360011830637)
says its hinge symbols on door fronts are off by default. Our front views
draw a small bar at each cup bore on the hinge edge, which makes the
hinge side clear whichever way the triangle points.

## 3. Section hatching (DIN 919)

| Material | Rule found | Source |
| --- | --- | --- |
| Wood-based panels (particleboard, MDF, plywood, …) | Thin (freehand) lines **at right angles to the panel's length**, spacing about **half the panel thickness**; the material short code (e.g. P2, MDF) and the nominal thickness are written in the section. | [Tischlerinnung Braunschweig: Leitfaden normgerechtes Zeichnen](https://tischlerinnung-bs.de/material/leitfaden_normgerechtes_zeichnen.pdf), [Plakat DIN 919](https://s69cec94b4a87d33a.jimcontent.com/download/version/1480426216/module/13338627032/name/Plakat%20DIN%20919.pdf) |
| Solid wood, long grain | Hatched **parallel to the grain**. Two end-grain faces touching: one hatch turned by 90°; parts glued together: same hatch. | same |
| Coatings, veneers, edges | Two equal variants A and B; never both in one section. A suits melamine and veneer edges, B shows solid-wood lippings and partial coatings in detail. | [Holzwerkstoffplatten und Beschichtungen nach DIN 919 (O. Welzel)](http://www.tischler-ole-welzel.de/Holzwerkstoffplatten_und_Beschichtungen.pdf) |
| Short codes | Codes for wood species and panels per DIN 919-1 / DIN EN 13556 (P1–P7 particleboard, …). | [schreiner-bw.de: Kurzbezeichnungen](https://www.schreiner-bw.de/wp-content/uploads/2016/01/Kurzbezeichnungen_Holzarten_und_Holzwerkstoffe.pdf) |
| General engineering (ISO 128) | Single 45° hatch when the material is not shown. Disagrees with the wood rules above, which take precedence in woodworking. | [TU Darmstadt CAD-Norminfo](https://www.iim.maschinenbau.tu-darmstadt.de/CAD-Tutorial/CAD-Norminfo/2_basics_for_standardcompliant_design_of_technical_drawings/2_view_cuts_and_hatching/index.de.html) |

The exact hatch patterns for each panel type (e.g. whether MDF and
particleboard differ) were not visible. Not verified.

Line widths from the Braunschweig guide: visible edges wide solid 0.5 mm,
hidden edges narrow dashed 0.25 mm, hatching in wood 0.35/0.25 mm.

## 4. Edgebanding in drawings and cutlists

- DIN 919: see variants A/B above (sections). In views, the order of
  coatings on finished panels is shown by an arrow at the edge or a dot in
  the face (Welzel). Not verified in detail.
- Microvellum labels mark a banded edge with an "X" on the part image,
  one symbol for all edge types
  ([Microvellum community](https://community.microvellum.com/portal/en/community/topic/edgeband-symbol-on-product-label-image)).
- Cabinet Vision's standard labels have no indicator of which band goes on
  which edge (a user on the
  [Thermwood forum](https://www.thermwood.com/forums/viewtopic.php?p=82297)).
- Cutlists generally carry one column per edge (length 1/2, width 1/2);
  Polyboard's text cutlist adds a grain flag (0 = may rotate, 1 = grain)
  ([Wood Designer forum](https://wooddesigner.org/forum/polyboard/part-rotation-and-edgebanding-in-cutlist/)).

## 5. Grain direction

The DIN 919 poster shows the direction of the surface structure (grain) by
an **arrow or a cross** in the face. Microvellum users ask for a visual
grain marker on labels, i.e. there is none by default.

## 6. Dimensioning

DIN 919 and the textbooks dimension furniture in mm without unit, chains
along the views; the textbook contents list a separate rule for dimension
line terminations at furniture doors and flaps (content not visible).
Oblique strokes as terminations are permitted by ISO 129-1 (from
knowledge of that standard, not re-checked here). Thickness without
brackets is the finished size, in brackets the raw size (Welzel).

## 7. Comparison with Cabinet Planner

| Topic | What we draw | Assessment |
| --- | --- | --- |
| Door/flap symbol, app front views (cabinet view, front builder) | Dashed triangle, preference `tip_at_handle` (default) or `tip_at_hinge`; flaps point down with the tip at the handle; hinge bars at the cups; handles. | Matches German/European practice; both readings offered. |
| Door/flap symbol, wall elevation sheets (engine) | **Before D78: none.** Now the same triangle, same geometry function, following the app's preference (CLI: tip at the handle). | Fixed (D78). |
| Drawers, blind panels, open zones | No symbol. | Correct: no standard symbol found; a cross would read as "flat surface". |
| Floor plan, room doors | Leaf line and quarter arc, dashed. | Matches common plan practice. |
| Hatching | None (we draw no sections on sheets). | Proposal below. |
| Edgebanding, part sheets | Heavy line just outside the banded edge; edge name with band code and remark. | Clear; not a DIN 919 section symbol, but part sheets are views, not sections. |
| Edgebanding, cutlist | Columns per edge L1 L2 W1 W2 with codes, remarks. | Matches common cutlists. |
| Grain | The word "grain" in the part sheet's title line; cutlist column. | Proposal below (arrow). |
| Dimensions | Chains in mm; oblique ticks by default, arrows or dots per style. | Fine. |

## 8. Proposals (not built)

1. **Grain arrow on part sheets**: an arrow in the face along the grain
   (DIN 919 poster: arrow or cross), when `part.grain` is set; needs a free
   spot clear of machining and labels.
2. **Section hatching per DIN 919** for a future section sheet or for the
   app's section view: panels with thin lines across the length at half
   the thickness plus material code and thickness; solid wood along the
   grain.
3. **Line style of the opening symbol**: an option "solid" (opens towards
   the viewer, per the window rule) besides dashed. Wait for the user's
   word; not verified for furniture.
4. **Material short codes** (DIN EN 13556 / DIN 919-1, e.g. P2, MDF) as an
   optional field on materials, printed on sheets.
5. **CLI option** `--opening-symbol tip_at_handle|tip_at_hinge|none` for
   sheets (the engine already takes it).
6. **Drop-down flaps and sliding doors**, when the engine has them: base on
   the hinge edge, tip at the handle (drop-down points up); sliding doors
   an arrow in the sliding direction.
7. **Check DIN 919-1 itself** (or the Europa "Holztechnik" textbook) for
   its rule on furniture opening symbols; if it says tip at the hinge, keep
   the default and note the difference in the option text.
