# Tab & Slot Conventions — first-pass calibration, pending owner review

**Status: FIRST PASS.** Derived from the pattern observed in one ArtiosCAD
exemplar (`artios-exemplar.dxf` / `SHIPPER-DW.dxf`) plus the existing flute
caliper table, not from shop documentation. Recorded 2026-07-23 by Mic.
Every value here needs owner confirmation before it drives production output —
treat it the same as any other `TODO(owner)` item in this repo until
confirmed. See `artios-dxf-conventions.md` for the underlying exemplar
analysis.

## Glue tab

| Property | Value | Source |
|---|---|---|
| Tab width | 1.5 in | existing shop standard (`DEFAULT_TAB_WIDTH_IN`, `scoring-allowances.md`) |
| Free-edge set-back | 0.25 in, each end | exemplar pattern — linear taper from the fold corner to the free edge |
| Inward offset | one caliper of the specified flute | flute caliper table below — **never compute a caliper yourself** |
| Fold line | spans the depth panel exactly, terminates on panel-corner vertices | exemplar pattern |

Flute caliper for the inward-offset rule, from `scoring-allowances.md` /
`dieline_core/flutes.py`:

| Flute | Caliper |
|---|---|
| C | 5/32 in |
| B | 1/8 in |
| DW | 9/32 in |

## Slots

| Property | Value | Source |
|---|---|---|
| Width, B/C flute | 0.25 in | exemplar pattern |
| Width, DW flute | 0.5 in | exemplar pattern |
| Centering | centered on the score | exemplar pattern |
| Ends | square | exemplar pattern |
| Flap trim, joint end | half the slot width | exemplar pattern |
| Flap trim, far end | flush (no trim) | exemplar pattern |

## Rules for using this file

- All dimensional constants here are read from this file (or
  `scoring-allowances.md` for caliper) — no inline magic numbers in code, no
  deriving a value from arithmetic on the fly. Values disagreeing with this
  file are bugs, not improvements — this exact failure mode has bitten this
  project three times already (see `CLAUDE.md`).
- The taper/inset numbers are a first-pass reading of a single exemplar, not a
  cross-checked shop standard the way `scoring-allowances.md`'s allowances
  are. Flag this status in any output or commit message that depends on it,
  until the owner confirms.
