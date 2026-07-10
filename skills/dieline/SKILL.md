---
name: dieline
description: Generate and reverse-engineer production-ready corrugated dielines (DXF/SVG) using the `dieline` CLI. Use this skill whenever the user asks for a dieline, box template, RSC, 0201, HSC, half slotted, tube, taped tube, TT, stitched tube, ST, sleeve, wrap, liner, KDF, corrugated box, carton, case, "cut and score" file, or DXF/SVG for packaging — OR when the user has a physical box sample (often described as "torn open", "flattened", "a blank", "a sample") with rough measurements and wants to know its spec or price it. Trigger even when nobody says "dieline": box dimensions like "12x9x4 C-flute" and sample descriptions like "the blank is about 42 by 13 with a 4-inch flap" both belong here.
---

# Dieline Generator & Sample Solver

Two tools behind one command, backed by scoring-allowance tables extracted from two
industry manuals (see `references/scoring-allowances.md` — that file is the ground
truth for all allowance math; never invent or approximate allowances).

- **`dieline generate`** — the user already knows the spec (style, L×W×D, flute)
  and wants a file.
- **`dieline solve`** — the user has a physical sample or measurements and wants
  the spec recovered (optionally generating the file too with `--generate`).

Supported styles: **RSC (0201)**, **HSC**, and **tube**. Anything else: say it
isn't supported yet rather than approximating (see Known limits).

## Generating — when the spec is known

```
uv run dieline generate --style <0201|hsc|tube> --l <length> --w <width> --d <depth> \
  --flute <B|C|BC> --units <in|mm> [--joint taped|glued] --out <path.dxf|path.svg>
```

- Style aliases accepted: `rsc` → 0201; `tt`, `st`, `sleeve`, `wrap` → tube.
- Dimensions are always **inside dimensions**, order L × W × D, with **L ≥ W** by
  convention. If the user gives three unlabeled numbers, confirm which is depth —
  never silently assume.
- `--joint` defaults to `taped` (no tab). `glued` adds a **1.5″ manufacturer's tab**.
- Flutes with scoring data: **B, C, BC** (BC = doublewall). Requesting another
  flute on a table-driven style produces a clear error — relay it; do not retry
  with a substituted flute.
- Output format is inferred from the `--out` extension (.dxf or .svg).
- On success the tool prints the absolute path of the written file — report that
  path to the user. On failure it prints a one-line error to stderr and exits
  nonzero — relay the error; do not retry with guessed values.

## Solving — when the user has a sample or measurements

```
uv run dieline solve --flute <B|C|BC> [--style rsc|hsc|tube] \
  --blank-w <in> --blank-h <in> [--flap-h <in>] [--panel-1 <in>] \
  [--scores-x a,b,c] [--scores-y a,b] [--joint taped|glued] [--generate]
```

Identifying the style from the sample (glance-level questions the user can answer):
- Flaps on **both** long edges of the blank → `rsc`
- Flaps on **one** edge only → `hsc`
- **No flaps** → ask: *"Is there a taped or stitched seam anywhere?"*
  Yes → `tube`. No → it's a **liner** — solve it as `tube` (blanks are
  dimensionally identical) but label the result "liner" when reporting.
  If style is omitted entirely, the solver ranks all three and reports a
  `runner_up`.

Minimum inputs for a fully determined answer:
- All styles: `--blank-w`, `--blank-h`, `--flute`
- RSC / HSC: **plus** `--flap-h` (distance from the blank's edge to the first
  horizontal crease — the flap) *or* `--panel-1`
- Tube: **plus** `--panel-1` (distance from the blank's edge to the first
  vertical crease). `--flap-h` is invalid for tube.
More inputs (`--scores-x`, `--scores-y`, `--panels-x`) tighten the fit.
Measurements are treated as noisy tape-measure values; the solver snaps to
1/16″ (preferring ¼″ specs) — do not pre-round or "correct" the user's numbers.

Output is one JSON object: style, flute, joint, L/W/D, predicted blank and score
positions, `rms_error_in`, `confidence`, and `runner_up` / `suggested_input`
when relevant. With `--generate`, a file is also produced at medium/high
confidence and its path printed after the JSON.

### Acting on confidence — required behavior

- **high / medium** — trust the result. Report the spec plainly ("That's a
  12 × 9 × 4 RSC, C-flute, taped") and offer/produce the file.
- **ambiguous** — the measurements were mathematically insufficient (e.g. blank
  size alone: 2 equations, 3 unknowns). The JSON includes `suggested_input`.
  Ask the user for exactly that one measurement, then re-run. Do not present
  the returned representative dimensions as an answer.
- **low** — poor fit; the sample may be a style we don't support or the numbers
  are inconsistent. Say so, hand the user everything gathered (measurements,
  best guess, runner-up) and recommend routing to a designer. Never force a fit.

## Before generating — checks to run every time

1. **Dimension order.** Unlabeled numbers → confirm which is depth.
2. **Inside vs outside.** Dimensions are inside. If the user measured a product
   (not a box), the box ID must exceed the product — flag if they seem equal.
   <!-- TODO(owner): standard product-to-ID clearance, if the shop has one. -->
3. **Flute.** No default guessing when the user names a flute we lack data for —
   error honestly. When the user gives no flute at all, ask; C is the most
   common shipper but confirm rather than assume.
4. **Size limits.** <!-- TODO(owner): min/max blank your vendors/equipment accept,
   e.g. "flag blanks over ___ × ___". -->
5. **Board grade vs weight.** <!-- TODO(owner): when to warn, e.g. "contents over
   ___ lb on C-flute → suggest BC". -->

## Conventions (house rules)

- All allowance math is **table-driven** from `references/scoring-allowances.md`.
  If a needed value isn't in that file, stop and say so — never derive allowances
  from caliper or invent them.
- **Glue/stitch tab: 1.5″**, taped joints have none. Taped is the default.
- **L ≥ W** always; depth is the flap-direction dimension.
- Flute affects allowances *and* caliper (slot width, fillet radius). Calipers:
  B 0.125″, C 0.1563″, BC 0.2813″.
- A no-flap sample without a seam is a **liner**, not a tube — same solved
  dimensions, different label; liner *generation* (with box-ID clearances) is
  not implemented yet.
- Layer/line conventions in output: <!-- TODO(owner): e.g. cut = layer CUT (red),
  crease = layer CREASE (blue); vendor-specific requirements. -->

## After generating

1. Report the output file path.
2. State the blank (flat sheet) size so the user can check it against sheet
   stock — the CLI's predicted blank for solves, or compute from the tables
   for generates.
3. If anything in the request contradicted a house rule above, say what you
   flagged and what you did about it.

## Known limits

- Styles: **RSC (0201), HSC, tube only.** No FOL/full-overlap, CSSC, telescopes,
  folders, die-cut mailers, trays, or partitions yet — decline and say which
  styles are supported instead of approximating.
- **Liner generation** not implemented (solving as tube is fine). Reject with
  the CLI's message if asked; the box-ID clearance math is documented in the
  reference file for when it's built.
- Flutes: B, C, BC only for table-driven styles (no A or E scoring data).
- No nesting/layout — one blank per file.
- Solver assumes taped-joint tables; a glued sample's tab is handled via
  `--joint glued`.
- <!-- TODO(owner): anything else the agent should refuse or escalate. -->
