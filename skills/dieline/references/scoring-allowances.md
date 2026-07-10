# Scoring Allowance Reference — Corrugated Box Styles

Extracted from the Acorn Scoring Manual (scanned shop copy) and cross-checked against the
Container Corporation of America (CCA) Scoring Allowance Manual, January 1966 — including the
shop appendix bound into that PDF (OM-numbered pages + "Page 1–27" X-notation formula sheets,
1985-era). **Status: extracted, checksum-verified, cross-checked against a second source.
4 of 7 original flags resolved; 4 items remain for owner adjudication (see bottom).**

Repo location: `skills/dieline/references/scoring-allowances.md`

Source tags used below: **[Acorn]** = Acorn shop manual · **[CCA]** = CCA 1966 printed tables ·
**[Appendix]** = shop pages appended to the CCA PDF (same X-notation as Acorn).

---

## How to read this file

- **All values are inches.** Dimensions are **inside dimensions** unless stated otherwise: L = length, W = width, D = depth.
- **ACC score** = score positions in the across-corrugation direction. **WCC score** = score positions in the with-corrugation direction (the long dimension of the blank; corrugation runs vertically on the blank per the manual's diagrams).
- Each formula is a **panel sequence**, written here as `panel | panel | panel`. Each panel is a base dimension plus its scoring allowance. Score positions are the cumulative sums.
- **Checksum**: the manual's "Sheet Size" equals the sum of the panel sequence. Every row below was verified this way against its own source; the same method was applied to every CCA row used in the cross-check.
- **TAB** = glue/stitch tab (manufacturer's joint). **Shop standard tab = 1½″** per the Appendix pages, which print `... X 1 1/2` as the final panel on every stitched/glued formula. [CCA] instead scales the lap by grade: 1⅜″ single wall, 1⅝″ gov't-grade SW and 200–350 DW, 1⅞″ DW 500+. `TODO(owner): confirm 1½″ is current practice, or adopt the CCA grade-based laps.`
- Flutes: B, C, DW (doublewall). The Acorn tables' values correspond to **CCA's 125–200 lb test class** for single wall and **200–350 lb CB** for doublewall. CCA specifies heavier allowances for 275–350 and 500–600 lb boards — a validation dimension the CLI could add later (see Cross-check notes).

---

## RSC — Regular Slotted Container (0201-family)

Flaps: ½W top and bottom on all panels.

### Taped
| Flute | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|
| B | ½W+1/16 \| D+¼ \| ½W+1/16 | L+1/16 \| W+⅛ \| L+⅛ \| W+1/16 | W+D+⅜ | 2L+2W+⅜ |
| C | ½W+⅛ \| D+⅜ \| ½W+⅛ | L+⅛ \| W+3/16 \| L+3/16 \| W+⅛ | W+D+⅝ | 2L+2W+⅝ |
| DW | ½W+¼ \| D+⅝ \| ½W+¼ | L+¼ \| W+5/16 \| L+5/16 \| W+¼ | W+D+1⅛ | 2L+2W+1⅛ |

**Cross-check:** C row matches [CCA] 125–200 C **exactly** (both directions and both sheet sizes) — the 0201 parity ground truth now has two independent authorities agreeing. B row: [CCA] prints D+5/16 → W+D+7/16, but this copy is hand-corrected to ¼ / ⅜, matching [Acorn]; see Cross-check notes. DW: [CCA] 200–350 CB gives D+11/16 → W+D+1 3/16 (1/16 heavier than [Acorn]).

### Stitch or Glue Inside
ACC identical to Taped.
| Flute | WCC panels | WCC sheet |
|---|---|---|
| B | TAB \| L+1/16 \| W+⅛ \| L+⅛ \| W+1/16 | TAB+2L+2W+⅜ |
| C | TAB \| L+⅛ \| W+3/16 \| L+3/16 \| W+⅛ | TAB+2L+2W+⅝ |
| DW | TAB \| L+¼ \| W+5/16 \| L+5/16 \| W+¼ | TAB+2L+2W+1⅛ |

**Cross-check:** [Appendix] RSC STI page prints the C row identically with a 1½″ tab. (The corresponding [CCA] printed page is missing from the scan.)

### Stitch or Glue Outside
ACC identical to Taped.
| Flute | WCC panels | WCC sheet |
|---|---|---|
| B | TAB \| L+3/16 \| W+⅛ \| L+⅛ \| W+0 | TAB+2L+2W+7/16 |
| C | TAB \| L+¼ \| W+3/16 \| L+3/16 \| W+1/16 | TAB+2L+2W+11/16 |
| DW | TAB \| L+7/16 \| W+5/16 \| L+5/16 \| W+⅛ | TAB+2L+2W+1 3/16 |

**Cross-check:** C and DW rows match [CCA] stitched-outside (125–200 C and 200–350 CB) **exactly**. B row: [CCA] prints the last panel as W+1/16 → +½ total (vs [Acorn] W+0 → +7/16); see Cross-check notes.

---

## FOL — Full Overlap Container
*(= CCA "FFSC", Full Flap Slotted Container.)*

Flaps: full W top and bottom (flaps overlap completely). Depth panel carries the entire flute allowance; flap panels get +0.

### Taped
| Flute | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|
| B | W+0 \| D+⅜ \| W+0 | L+1/16 \| W+⅛ \| L+⅛ \| W+1/16 | 2W+D+⅜ | 2L+2W+⅜ |
| C | W+0 \| D+½ \| W+0 | L+⅛ \| W+3/16 \| L+3/16 \| W+⅛ | 2W+D+½ | 2L+2W+⅝ |
| DW | W+0 \| D+⅞ \| W+0 | L+¼ \| W+5/16 \| L+5/16 \| W+¼ | 2W+D+⅞ | 2L+2W+1⅛ |

**Cross-check:** [CCA] FFSC prints heavier depth allowances (B: D+½, C: D+⅝), but this copy carries handwritten annotations on those rows that appear to revise them to ⅜ and ½ — the [Acorn] values. [Appendix] FFSC pages carry `W − ⅛` flap notations that differ from both; see Cross-check notes.

### Stitch or Glue Inside
ACC identical to Taped.
| Flute | WCC panels | WCC sheet |
|---|---|---|
| B | TAB \| L+1/16 \| W+⅛ \| L+⅛ \| W+1/16 | TAB+2L+2W+⅜ |
| C | TAB \| L+⅛ \| W+3/16 \| L+3/16 \| W+⅛ | TAB+2L+2W+⅝ |
| DW | TAB \| L+¼ \| W+5/16 \| L+5/16 \| W+¼ | TAB+2L+2W+1⅛ |

**✔ Resolved (was Flag #1):** the C-flute first panel is **L+⅛**, not the Acorn scan's printed 3/16. Settled by [Appendix] page 5 (FFSC stitched-inside), which prints `L plus 1/8 X W plus 3/16 X L plus 3/16 X W plus 1/8 X 1 1/2` — agreeing with the checksum and the taped/RSC pattern.

### Stitch or Glue Outside
ACC identical to Taped.
| Flute | WCC panels | WCC sheet |
|---|---|---|
| B | TAB \| L+3/16 \| W+⅛ \| L+⅛ \| W+0 | TAB+2L+2W+7/16 |
| C | TAB \| L+¼ \| W+3/16 \| L+3/16 \| W+1/16 | TAB+2L+2W+11/16 |
| DW | TAB \| L+7/16 \| W+5/16 \| L+5/16 \| W+⅛ | TAB+2L+2W+1 3/16 |

---

## HSC — Half Slotted Container
*(= CCA "½ RSC".)*

Flaps: ½W on bottom only; top open.

### Taped
| Flute | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|
| B | ½W+1/16 \| D+⅛ | L+1/16 \| W+⅛ \| L+⅛ \| W+1/16 | ½W+D+3/16 | 2L+2W+⅜ |
| C | ½W+⅛ \| D+3/16 | L+⅛ \| W+3/16 \| L+3/16 \| W+⅛ | ½W+D+5/16 | 2L+2W+⅝ |
| DW | ½W+¼ \| D+5/16 | L+¼ \| W+5/16 \| L+5/16 \| W+¼ | ½W+D+9/16 | 2L+2W+1⅛ |

**Cross-check:** all three ACC rows match [CCA] ½RSC **exactly** (B: D+⅛ → 3/16; C: D+3/16 → 5/16; CB 200–350: D+5/16 → 9/16). Strong corroboration.

### Stitch or Glue Inside
ACC identical to Taped. WCC identical to RSC Stitch/Glue Inside (TAB variants), sheets TAB+2L+2W+{⅜, ⅝, 1⅛}.

### Stitch or Glue Outside
ACC identical to Taped. WCC identical to RSC Stitch/Glue Outside, sheets TAB+2L+2W+{7/16, 11/16, 1 3/16}.

---

## CSSC — Center Special Slotted Container
*(Manual note: use for Inner-Flaps-Meet cartons also.)*

Flaps: ½L on the L panels (inner flaps meet), ½W on the W panels. ACC has two flap formulas; **sheet height is governed by the taller ½L flaps**.

### Taped
| Flute | ACC panels (L-flap line) | ACC panels (W-flap line) | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|---|
| B | ½L+1/16 \| D+¼ \| ½L+1/16 | ½W+1/16 \| D+¼ \| ½W+1/16 | L+1/16 \| W+⅛ \| L+⅛ \| W+1/16 | L+D+⅜ | 2L+2W+⅜ |
| C | ½L+1/16 \| D+⅜ \| ½L+1/16 | ½W+⅛ \| D+⅜ \| ½W+⅛ | L+⅛ \| W+3/16 \| L+3/16 \| W+⅛ | L+D+½ | 2L+2W+⅝ |
| DW | ½L+⅛ \| D+⅝ \| ½L+⅛ | ½W+¼ \| D+⅝ \| ½W+¼ | L+¼ \| W+5/16 \| L+5/16 \| W+¼ | L+D+⅞ | 2L+2W+1⅛ |

Note: C-flute L-flap allowance is 1/16 (not ⅛) per the printed formula and checksum (1/16+⅜+1/16 = ½ ✓).
**Cross-check:** [Appendix] CSSC page confirms the ½L+1/16 flap allowance and the L+D+½ A-score total for C. [CCA] prints **zero** allowance on the ½L flaps (L/2 | D+⅜ | L/2 → L+D+⅜); this file keeps the shop value — see Cross-check notes.

### Stitch or Glue Inside / Outside
ACC identical to Taped. WCC follows the RSC pattern for the corresponding joint (Inside: TAB + taped allowances; Outside: TAB + {3/16 or ¼ or 7/16 first-L pattern}), sheets match RSC TAB sheets. Verified against printed pages.

---

## Full Telescope — two-piece (Body + Cover)

All four styles share body allowances; covers differ by style. All checksums pass.
**Cross-check note:** [CCA] carries two FT constructions (cover end-slotted, pp. 38–39; cover side-slotted, pp. 40–41). Its printed body W-line matches [Acorn] exactly (C: D+⅛ | W+⅜ | D+⅛ → 2D+W+⅝); its printed body L-line reads L+¼ vs [Acorn] L+3/16 — and this CCA copy is hand-corrected toward 3/16 on those rows.

### Style A ⚠ page is crossed out by hand in the Acorn manual — see Adjudication item A
| Flute | Piece | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|---|
| B | Body | D+1/16 \| L+¼ \| D+1/16 | D+1/16 \| W+⅛ \| D+1/16 | 2D+L+⅜ | 2D+W+¼ |
| B | Cover | D+1/16 \| L+⅝ \| D+1/16 | D+1/16 \| W+⅜ \| D+1/16 | 2D+L+¾ | 2D+W+½ |
| C | Body | D+⅛ \| L+⅜ \| D+⅛ | D+⅛ \| W+3/16 \| D+⅛ | 2D+L+⅝ | 2D+W+7/16 |
| C | Cover | D+⅛ \| L+15/16 \| D+⅛ | D+⅛ \| W+9/16 \| D+⅛ | 2D+L+1 3/16 | 2D+W+13/16 |
| DW | Body | D+3/16 \| L+11/16 \| D+3/16 | D+3/16 \| W+5/16 \| D+3/16 | 2D+L+1 1/16 | 2D+W+11/16 |
| DW | Cover | D+3/16 \| L+1 7/16 \| D+3/16 | D+3/16 \| W+⅞ \| D+3/16 | 2D+L+1 13/16 | 2D+W+1¼ |

### Style B
| Flute | Piece | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|---|
| B | Body | D+1/16 \| W+¼ \| D+1/16 | D+1/16 \| L+⅛ \| D+1/16 | 2D+W+⅜ | 2D+L+¼ |
| B | Cover | D+1/16 \| W+⅝ \| D+1/16 | D+1/16 \| L+⅜ \| D+1/16 | 2D+W+¾ | 2D+L+½ |
| C | Body | D+⅛ \| W+⅜ \| D+⅛ | D+⅛ \| L+3/16 \| D+⅛ | 2D+W+⅝ | 2D+L+7/16 |
| C | Cover | D+⅛ \| W+1⅛ \| D+⅛ | D+⅛ \| L+⅝ \| D+⅛ | 2D+W+1⅜ | 2D+L+⅞ |
| DW | Body | D+3/16 \| W+11/16 \| D+3/16 | D+3/16 \| L+5/16 \| D+3/16 | 2D+W+1 1/16 | 2D+L+11/16 |
| DW | Cover | D+3/16 \| W+1 11/16 \| D+3/16 ⚠ Adjudication item C | D+3/16 \| L+⅞ \| D+3/16 | 2D+W+2 1/16 | 2D+L+1¼ |

### Style C *(appears twice in the Acorn manual — duplicate pages, values identical)*
Body identical to Style A body.
| Flute | Piece | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|---|
| B | Cover | D+1/16 \| W+9/16 \| D+1/16 | D+1/16 \| L+11/16 \| D+1/16 | 2D+W+11/16 | 2D+L+13/16 |
| C | Cover | D+⅛ \| W+11/16 \| D+⅛ | D+⅛ \| L+15/16 \| D+⅛ | 2D+W+15/16 | 2D+L+1 3/16 |
| DW | Cover | D+3/16 \| W+1 5/16 \| D+3/16 | D+3/16 \| L+1½ \| D+3/16 | 2D+W+1 11/16 | 2D+L+1⅞ |

### Style D
Body identical to Style B body. (Acorn's B-flute body WCC prints `D × 1/16 × L` — typo for `D + 1/16`; checksum confirms.)
| Flute | Piece | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|---|
| B | Cover | D+1/16 \| L+9/16 \| D+1/16 | D+1/16 \| W+11/16 \| D+1/16 | 2D+L+11/16 | 2D+W+13/16 |
| C | Cover | D+⅛ \| L+11/16 \| D+⅛ | D+⅛ \| W+1 \| D+⅛ | 2D+L+15/16 | 2D+W+1¼ |
| DW | Cover | D+3/16 \| L+1 5/16 \| D+3/16 | D+3/16 \| W+1 11/16 \| D+3/16 | 2D+L+1 11/16 | 2D+W+2 1/16 |

---

## CSF — Center Seam Folder

Flaps: full W top and bottom. Blank runs ½L | W | L | W | ½L (seam at center of an L panel).

| Flute | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|
| B | W+0 \| D+⅜ \| W+0 | ½L+1/16 \| W+⅛ \| L+⅛ \| W+⅛ \| ½L+1/16 | 2W+D+⅜ | 2L+2W+½ |
| C | W+0 \| D+½ \| W+0 | ½L+1/16 \| W+3/16 \| L+3/16 \| W+3/16 \| ½L+1/16 | 2W+D+½ | 2L+2W+11/16 |
| DW | W+0 \| D+⅞ \| W+0 | ½L+⅛ \| W+5/16 \| L+5/16 \| W+5/16 \| ½L+⅛ | 2W+D+⅞ | 2L+2W+1 3/16 |

**Cross-check:** [CCA]'s "Center Seam Wrapper" and the [Appendix] CSW page use a different blank layout (½W | D | W | D | ½W by D | L | D) — not directly comparable; no conflict recorded.

---

## 5PF — Five Panel Folder

Blank runs W | L | W | L | W. Flaps: full W top and bottom.

| Flute | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|
| B | W+0 \| D+⅜ \| W+0 | W+1/16 \| L+⅛ \| W+⅛ \| L+¼ \| W+1/16 | 2W+D+⅜ | 3W+2L+⅝ |
| C | W+0 \| D+½ \| W+0 | W+⅛ \| L+3/16 \| W+3/16 \| L+⅜ \| W+⅛ | 2W+D+½ | 3W+2L+1 |
| DW | W+0 \| D+⅞ \| W+0 | W+3/16 \| L+5/16 \| W+5/16 \| L+9/16 \| W+3/16 | 2W+D+⅞ | 3W+2L+1 9/16 |

**Cross-check:** [Appendix] 5-Panel Folder pages corroborate the C row (same allowance set, mirrored panel order: W+⅛ | L+⅜ | W+3/16 | L+3/16 | W+⅛ — identical sum). [CCA]'s printed "5PF" is a different construction (tuck + telescoping W/D panels) — not comparable.

---

## Bookfold
*(= CCA "One Piece Folder", 1PF.)*

Manual note: **tuck is usually 2½″.**

| Flute | ACC panels | WCC panels | ACC sheet | WCC sheet |
|---|---|---|---|---|
| B | TUCK \| D+⅛ \| L+⅛ \| D+⅛ \| TUCK | ½W+1/16 \| D+3/16 \| W+⅛ \| D+3/16 \| ½W+1/16 | 2TUCK+2D+L+⅜ | 2W+2D+⅝ |
| C | TUCK \| D+3/16 \| L+3/16 \| D+3/16 \| TUCK | ½W+⅛ \| D+5/16 \| W+3/16 \| D+5/16 \| ½W+⅛ | 2TUCK+2D+L+9/16 | 2W+2D+1 1/16 |
| DW | TUCK \| D+5/16 \| L+5/16 \| D+5/16 \| TUCK | ½W+3/16 \| D+9/16 \| W+5/16 \| D+9/16 \| ½W+3/16 | 2TUCK+2D+L+15/16 | 2W+2D+1 13/16 ⚠ Adjudication item B |

**✔ Resolved (was Flag #2):** C-flute WCC sheet is **2W+2D+1 1/16**. [CCA] 1PF 125–200 C prints the identical panel formula (½W+⅛ | D+5/16 | W+3/16 | D+5/16 | ½W+⅛) with sheet 2W+2D+1 1/16 — the Acorn "1 1/6" was a typo, as the checksum indicated.

**Cross-check on DW:** the tuck line matches [CCA] 200–350 CB exactly (T | D+5/16 | L+5/16 | D+5/16 | T → +15/16). The WCC line does **not**: [CCA] 200–350 CB gives D+½ inner scores → 2W+2D+**1 11/16**, while Acorn prints D+9/16 → 1 13/16 (checksum-consistent) with the sheet size hand-struck. See Adjudication item B.

---

## Die-Cut Self-Locking Cartons (B-flute allowances)

These two pages are dimensioned drawings, not panel formulas — the geometry is positional (radii, hooks, lock slots) and should be read from the drawings directly. Keep the source PDF pages as the reference; key envelope dimensions extracted:

**Die Cut Self Locking Carton:** overall blank = (3D + 2W + ⅝) high × (L + 4D + 2 5/16) wide. Top panel L+¾ with D-radius corners and ½″ R notches; panel widths step W+¼ / W+⅛; depth panels D+1/16 / D+⅛; lock slots ⅜ × 5/16 placement per drawing.

**Die Cut Self Locking (Indestructo), B-flute:** overall blank = (3D + 2W + 15/16) high × (L + 2W + 1¼) wide. Lid L+0 with 1″ R corners and ⅜ shoulders; panel sequence heights D+1/16, W+⅛, D+¼, W+¼, D+¼ pattern per drawing; W+5/16 side panels flanking L+⅝.

`TODO(owner): if these styles enter the generator, we should redraw them parametrically from the source pages together rather than trust this summary.`

---

## Quick-Reference Data (handwritten page)

### ID → OD adders (to find outside dimensions from inside dimensions)
| Flute | L + | W + | RSC D + | FOL D + |
|---|---|---|---|---|
| A | 7/16 | 7/16 | ⅞ | 1⅜ |
| B | ¼ | ¼ | ⅝ ⚠ Adjudication item D | ⅞ |
| C | ⅜ | ⅜ | ¾ | 1⅛ |
| DW | ⅝ | ⅝ | 1¼ | 1⅞ |

### Flute caliper (approximate)
| Flute | Caliper (in) | Fraction | Corr/linear ft |
|---|---|---|---|
| A | 0.2188 | 7/32 | 36 |
| B | 0.1250 | ⅛ | 50 |
| C | 0.1563 | 5/32 | 40 |
| E | 0.0781 | 5/64 | 90 |
| B/C DW | 0.2813 | 9/32 | — |

### Unit conversions
- mm × 0.03937 = in;  mm ÷ 25.4 = in
- in × 25.4 = mm;  in ÷ 0.03937 = mm

---

## Cross-check notes — CCA 1966 manual vs Acorn shop manual

Method: the CCA PDF's sheet sizes were checksummed against its panel formulas the same way as the
Acorn extraction; every CCA row cited here passes its own checksum, so disagreements below are
real inter-source differences, not scan errors.

**Where the sources agree exactly (high confidence rows):**
- RSC Taped C — the 0201 parity row — matches [CCA] 125–200 C in both directions and both sheet sizes.
- RSC Stitched-Outside C and DW match [CCA] exactly.
- HSC (½RSC) ACC matches [CCA] for B, C, and DW.
- Bookfold/1PF C matches [CCA] exactly, including the sheet size that resolved Flag #2.
- Bookfold DW tuck line matches [CCA] 200–350 CB exactly.
- FT body W-lines match [CCA]'s printed FT bodies.

**Systematic differences (recorded as shop practice; CLI should follow this file, not raw CCA):**
1. **B-flute runs 1/16 lighter in shop practice.** [CCA] prints RSC-B depth D+5/16 (→ W+D+7/16), stitched-outside-B last panel W+1/16 (→ +½), and 1PF-B inner scores D+¼ (→ 2W+2D+¾). The Acorn/shop values are D+¼, W+0, and D+3/16 respectively. Notably, this copy of the CCA manual is **hand-corrected on the RSC-B row toward the shop values** — the annotations reconcile CCA to Acorn, not the other way around.
2. **FFSC/FOL depth allowances.** [CCA] prints B: D+½ and C: D+⅝; Acorn uses D+⅜ and D+½. The CCA copy again carries handwritten revisions on exactly these rows, apparently toward the Acorn values. (The [Appendix] FFSC pages additionally show `W − ⅛` flap notations — a construction where flaps are cut ⅛ short — recorded here as an observation only.)
3. **CSSC ½L flap allowance.** [CCA] prints zero (L/2 → L+D+⅜ for C); Acorn and the [Appendix] CSSC page both use 1/16 per flap (→ L+D+½). Shop value kept.
4. **DW is graded in CCA.** Acorn's single DW column sits between CCA's 200–350 CB and 500–600 CB rows (e.g., RSC-DW: Acorn D+⅝ vs CCA 200–350 CB D+11/16). If the CLI ever adds board-test awareness, CCA's 275–350 and 500–600 rows are the reference.
5. **CCA carries data Acorn lacks**: A-flute and E-flute allowances for every style, heavier test grades, OLSC/overlap variants, telescope trays, Bliss boxes, corner-cut trays, and the grade-based lap allowances (1⅜ / 1⅝ / 1⅞). Not extracted into tables here to keep this file single-standard; extract on demand when a style enters the generator.
6. **Corrugation-direction convention** [CCA intro]: the corrugation direction is the *first* dimension in the printed sheet size, and a reversed (horizontal-corrugation) RSC must be explicitly stated on the spec. Useful rule for the SKILL.md.

---

## Remaining items — owner adjudication needed

- **(A) Full Telescope Style A crossed out** (was Flag #5). [CCA] gives no basis for deprecation — both FT constructions remain standard in the 1966 manual. The cross-out is shop history only you can read: deprecated style, or stray mark? Data recorded either way (checksums pass).
- **(B) Bookfold DW WCC sheet** (was Flag #3), now sharper: Acorn prints D+9/16 → 1 13/16 (internally consistent) but the sheet size is hand-struck. [CCA] 200–350 CB uses **D+½ → 1 11/16**. Best hypothesis: the handwritten correction is **1 11/16**, aligning the shop to CCA's 200–350 grade. Confirm which value production actually uses; if 1 11/16, the WCC row becomes ½W+3/16 | D+½ | W+5/16 | D+½ | ½W+3/16.
- **(C) FT Style B DW cover ACC** (was Flag #4), now sharper: Acorn prints W+1 11/16 → 2D+W+2 1/16 (checksum-valid) with handwritten marks. The closest [CCA] row (side-slotted FT cover, 200–350 CB) reads **W+1⅝ → 2D+W+2**, while the same row's L-line (L+⅞ → 1¼) matches Acorn exactly. The annotation is plausibly a −1/16 revision to the CCA value. Owner call.
- **(D) ID→OD table, B-flute RSC D+** (was Flag #6): reads ⅝ with a possible handwritten alteration. [CCA] has no ID→OD table, so no cross-check available. Confirm from practice.
- **(E) Tab width** (was Flag #7), mostly settled: [Appendix] pages print a **1½″** tab throughout; [CCA] uses grade-based laps (1⅜ / 1⅝ / 1⅞). Confirm 1½″ is the current shop standard and whether heavy DW should step up per CCA.

Resolved and closed: Flag #1 (FOL stitched-inside C first panel = L+⅛, settled by [Appendix]) and Flag #2 (Bookfold C sheet = 1 1/16, settled by [CCA]).

---

## Immediate use

The **RSC Taped table is the ground truth for the 0201 CLI parity work**: the existing backend's C-flute output for a 12×9×4 should produce score positions matching `½W+⅛ | D+⅜ | ½W+⅛` (ACC) and `L+⅛ | W+3/16 | L+3/16 | W+⅛` (WCC), blank = 30⅝ × 13⅝. **This row is now confirmed by two independent sources** (Acorn shop manual and CCA 1966, 125–200 lb C-flute). If the backend doesn't match, that's a conversation to have before extracting the CLI — we'd be enshrining the wrong math.
