---
name: dieline
description: Generate production-ready FEFCO corrugated dielines (DXF/SVG) using the `dieline` CLI. Use this skill whenever the user asks for a dieline, box template, RSC, 0201, corrugated box, carton, case, "cut and score" file, DXF or SVG for packaging, or gives box dimensions (L×W×D) and wants a file — even if they don't say the word "dieline." Also use it to sanity-check dimensions or flute choices before generating.
---

# Dieline Generator

Generates FEFCO-standard corrugated dielines as DXF or SVG via a command-line tool. v1 supports style **0201 (RSC)** only. If asked for any other style, say it isn't supported yet rather than approximating with 0201.

## How to run

```
uv run dieline generate --style 0201 --l <length> --w <width> --d <depth> --flute <B|C|E|BC> --units <in|mm> --out <path.dxf|path.svg>
```

Run from the repo root (`E:\hood-box-designer`). Full flag reference: `uv run dieline generate --help`.

- Dimensions are always **inside dimensions** in the order L × W × D (confirmed from the underlying `BoxSpec` schema: length/width/height are documented as "Inside length/width/height").
- `--flute` selects a board caliper (thickness) from a lookup table, not just a label. See "Flute caliper values" below — **these are placeholders**, not your real board specs.
- On success the tool prints the absolute path of the written file, and nothing else. Report that path to the user.
- On failure it prints one line to stderr and exits nonzero. Relay the error; do not retry with guessed values.
- The CLI does **not** print blank size, panel dims, or other derived numbers — only the output path. If the user needs the blank size, open the file or ask; don't guess (see "After generating" below for how to get it).

## Before generating — checks to run every time

1. **Confirm the dimension order.** If the user gives three numbers with no labels, confirm which is depth. Never silently assume.
2. **Flute sanity.** <!-- TODO(owner): your rules, e.g. "Default to C-flute for shippers unless told otherwise. E-flute only for retail/print-heavy. Never BC under 6in depth." -->
3. **Size limits.** <!-- TODO(owner): min/max panel sizes your vendors/equipment accept, e.g. "Flag anything with a blank over ___ × ___ — exceeds sheet size at ___." -->
4. **Board grade vs. weight.** <!-- TODO(owner): when to warn, e.g. "If contents weight is mentioned and exceeds ___ lb for C-flute, suggest ___." -->

## Flute caliper values (placeholder — TODO(owner))

`--flute` maps to caliper via `backend/dieline_core/flutes.py`. Current values (generic, commonly-cited nominal figures, **not** confirmed against real board specs):

| Flute | Caliper (in) | Caliper (mm) |
|-------|--------------|--------------|
| B     | 0.098        | 2.5          |
| C     | 0.140        | 3.6          |
| E     | 0.060        | 1.5          |
| BC    | 0.238        | 6.1          |

<!-- TODO(owner): replace with your mill/supplier's actual calipers, then update backend/dieline_core/flutes.py to match. Until then, treat any CLI-generated box as a rough-caliper draft, not production-ready. -->

## Conventions (the house rules)

<!-- TODO(owner): This section is the moat. Write the corrections you'd give a junior designer. Examples of the kind of rule that belongs here: -->

- **Glue tab:** Default width is 1.25in (32mm), applied on the left edge of panel 1 (the tool has no `--glue-tab` flag yet — it's always the default). <!-- TODO(owner): confirm this default is right for your standard shippers, and specify inside vs. outside glue / bevel angle — not encoded in the geometry, it's an assembly-time convention. -->
- **Flute/caliper allowances:** The CLI already applies caliper compensation to every panel and flap (each panel = nominal dim + caliper; flap depth = (width + caliper) / 2). No manual adjustment is needed on top of what `--flute` selects.
- **Slot widths:** Auto-computed as `max(0.25in, 2 × caliper)` in inches (`max(6mm, 2 × caliper)` in mm) — there's no `--slot` flag yet, so this always applies. <!-- TODO(owner): confirm this default slot formula matches your press/rule requirements. -->
- **Flap gap:** Top and bottom flaps are each exactly half of (width + caliper) — they meet with no intentional gap or overlap (this is a standard RSC split, not FOL). <!-- TODO(owner): flag if a specific job needs a manufacturing gap allowance instead — not currently supported, would need a new flag. -->
- **Grain/flute direction:** <!-- TODO(owner): e.g. "Flutes always vertical (parallel to depth) — if the layout implies otherwise, stop and ask." -->
- **Layer/line conventions in output:** Cut lines = layer `CUT` (AutoCAD color 1 / red, `#dc2626` in SVG). Score/crease lines = layer `CREASE` (AutoCAD color 3 / green, `#16a34a`, dashed `DASHED` linetype in DXF, dashed stroke in SVG). This is fixed by the tool, not configurable. <!-- TODO(owner): note if a vendor requires different layer names/colors — would need a new flag, not currently supported. -->

## After generating

1. Report the output file path.
2. State the blank size (flat sheet dimensions) so the user can check it against sheet stock. The CLI doesn't print this — compute it as `blank width = L + W + L + W + glue_tab + 2×caliper` and `blank height = D + flap_top + flap_bottom + 2×caliper` (roughly; flap depths follow the formulas above), or open the DXF/SVG and read its bounding box.
3. If anything in the request contradicted a house rule above, say what you flagged and what you did about it.

## Known limits (v1)

- 0201 RSC only. No FOL, HSC, die-cut mailers, trays, or partitions yet.
- No nesting/layout — one blank per file.
- Only B, C, E, BC flutes supported, and their calipers are unconfirmed placeholders (see above).
- No flags yet for glue tab width, slot width, fillet radius, or overlap — all use the tool's built-in defaults.
- <!-- TODO(owner): anything else the agent should refuse or escalate. -->
