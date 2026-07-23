# ArtiosCAD DXF Conventions — verified against a real exemplar export

Source: `skills/dieline/references/artios-exemplar.dxf` (owner-supplied ArtiosCAD
export, filename `SHIPPER-DW.dxf` — byte-identical copy kept under both names).
Everything below was independently re-verified against that file with `ezdxf`
(layer table, entity colors/linetypes, endpoint clustering, chain walk) — not
just read off a description. Where a number below came only from visual
inspection of the file's dimension text rather than a coordinate check, it's
marked **[unverified-by-script]**.

This file records what ArtiosCAD's own output looks like, as a validation
target and export-convention reference. It is not a request to change our own
export layer scheme (see Layers below) — that's a separate decision.

## Entity model

- **No `LWPOLYLINE` anywhere.** The entire cut outline is 42 independent `LINE`
  entities (no `ARC` — every corner in this exemplar is square, not filleted).
  Confirmed: `doc.modelspace()` entity type counts are `TEXT: 1, DIMENSION: 10,
  LINE: 57` — nothing else.
- Two conceptual layers hold everything: `Design` (all 57 `LINE` entities: cut,
  crease, corrugation-direction arrow) and `Annotation` (`DIMENSION` + `TEXT`).
  Both plus `0` and `Defpoints` all report layer-level color 7 — the
  distinguishing color is set **per-entity**, not per-layer.
- Linetype is `CONTINUOUS` on every single entity, including creases. ArtiosCAD
  does not use a dashed linetype to mark creases — it uses color only.

## Color coding (entity-level `color`, not layer color)

| Color | Meaning | Count in exemplar |
|---|---|---|
| 1 | Cut | 42 |
| 2 | Crease | 12 |
| 10 | Corrugation-direction arrow (not cut, not crease) | 3 |
| 20 | Annotation (`DIMENSION` + `TEXT`, on layer `Annotation`) | 11 |

This is a genuinely different convention from ours (`CUT`/`CREASE` layer names,
dashed linetype for creases — see `dieline_core/geometry.py`'s `build_dxf`).
**Do not migrate our export to this scheme** — it's recorded here so
`dieline validate` can recognize either convention (see R9) rather than
misreading a real Artios file as broken.

## The connectivity pattern — this is the reviewer's actual complaint

Verified by clustering every `LINE` endpoint within 1e-4 in and walking the
resulting graph: **the 42 cut entities form exactly one closed chain — every
vertex has degree exactly 2.** No dangling ends, no near-misses beyond the
wobble noted below.

The key structural fact: **every crease endpoint lands exactly on a point
where two separate cut `LINE` entities meet.** ArtiosCAD does not draw one
long cut line and let a crease touch its midpoint (a T-junction) — it splits
the cut into two entities at that exact point, so the crease's endpoint is a
genuine shared vertex among three entities (two cuts + one crease), not a
point lying on the interior of one longer cut segment.

Our own generator (`dieline_core/geometry.py::build_dieline`) currently does
the opposite: e.g. the top edge between two slot mouths is one continuous
`_seg()` call, and the panel-boundary crease's endpoint lands at the
*midpoint* of that segment. Numerically the point is exactly on the line (no
gap, no drift — Phase 0 confirmed our coordinate math is sound) — but
topologically it's a T-junction, not a shared vertex. That mismatch is what
"unresolved corners" / "not connected, just butted" describes. It is not a
coordinate bug; it's a missing split.

Confirmed by direct measurement, not assumption:
```
crease end (28.23862, 42.61491) -> cut endpoint at same point, dist=0.0
  cut-entities-touching = 2   (i.e. two distinct cut LINEs end there)
```
...repeated identically for all 12 crease endpoints in the file.

## Endpoint precision — real-world wobble exists, exact equality is wrong

ArtiosCAD's own export is **not** bit-exact between what should be the same
point. Directly observed:
```
(8.05112, 42.61491)
(8.05112, 42.6149)      <- same logical vertex, differs at 1e-5
```
Any validator that requires exact float equality for "shares a vertex" will
report false positives against ArtiosCAD's own output. Coincidence checks must
be tolerance-based (`--snap-tol`, default 1e-4 in — comfortably above this
1e-5 wobble), never exact equality.

## Glue tab and slot geometry **[unverified-by-script]**

The following came from visual/manual inspection of the exemplar's dimensioned
drawing, not from a coordinate-level check like the sections above — treat as
first-pass, cross-check before relying on it for production:

- Glue-tab fold line spans the depth panel exactly, terminating on the
  panel-corner vertices (not offset from them).
- Tab free edge is inset 0.25 in from each flap crease, with a straight taper
  from the fold corner to the free edge (not a curve, not a step).
- Tab crease (the tab's own fold line) is a crease entity, same color-2
  convention as every other crease.
- Slots are centered on the score; flaps are trimmed a half-slot-width at the
  joint end, flush (no trim) at the far end.

These feed `tab-and-slot-conventions.md`'s first-pass numbers — see that file
for the actual values and its own pending-review status.

## Units

`$MEASUREMENT` / `$INSUNITS` are unset (`None`) in the exemplar's header — it
does not declare drawing units at all. Don't assume ArtiosCAD always omits
this; just don't rely on header units being present when reading a real
Artios file, and don't treat their absence as a defect.
