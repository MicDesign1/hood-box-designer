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

- Dimensions are always **inside dimensions** in the order L × W × D. <!-- TODO(owner): confirm — inside or outside dims? If callers sometimes give outside dims, state the conversion rule here. -->
- On success the tool prints the absolute path of the written file. Report that path to the user.
- On failure it prints a one-line error and exits nonzero. Relay the error; do not retry with guessed values.

## Before generating — checks to run every time

1. **Confirm the dimension order.** If the user gives three numbers with no labels, confirm which is depth. Never silently assume.
2. **Flute sanity.** <!-- TODO(owner): your rules, e.g. "Default to C-flute for shippers unless told otherwise. E-flute only for retail/print-heavy. Never BC under 6in depth." -->
3. **Size limits.** <!-- TODO(owner): min/max panel sizes your vendors/equipment accept, e.g. "Flag anything with a blank over ___ × ___ — exceeds sheet size at ___." -->
4. **Board grade vs. weight.** <!-- TODO(owner): when to warn, e.g. "If contents weight is mentioned and exceeds ___ lb for C-flute, suggest ___." -->

## Conventions (the house rules)

<!-- TODO(owner): This section is the moat. Write the corrections you'd give a junior designer. Examples of the kind of rule that belongs here: -->

- **Glue tab:** <!-- TODO(owner): width, which panel it attaches to, inside/outside glue, e.g. "1.25in tab on panel 4, glued inside, 15° bevel." -->
- **Flute/caliper allowances:** <!-- TODO(owner): your scoring allowances per flute, e.g. "C-flute: add ___ to W panels, ___ to L panels." If the CLI already applies these, say so and note that no manual adjustment is needed. -->
- **Slot widths:** <!-- TODO(owner) -->
- **Flap gap:** <!-- TODO(owner): e.g. "Outer flaps meet; allow ___ gap between inner flaps — flag if user expects full overlap (that's an FOL, not supported yet)." -->
- **Grain/flute direction:** <!-- TODO(owner): e.g. "Flutes always vertical (parallel to depth) — if the layout implies otherwise, stop and ask." -->
- **Layer/line conventions in output:** <!-- TODO(owner): e.g. "Cut lines = layer CUT (red), scores = layer CREASE (blue). Vendor ___ requires ___." -->

## After generating

1. Report the output file path.
2. State the blank size (flat sheet dimensions) so the user can check it against sheet stock. <!-- TODO(owner): if the CLI prints this, use it; otherwise compute L+W+L+W+tab by D+flaps. -->
3. If anything in the request contradicted a house rule above, say what you flagged and what you did about it.

## Known limits (v1)

- 0201 RSC only. No FOL, HSC, die-cut mailers, trays, or partitions yet.
- No nesting/layout — one blank per file.
- <!-- TODO(owner): anything else the agent should refuse or escalate. -->
