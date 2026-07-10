# dieline CLI

Standalone command-line tool for generating FEFCO 0201 (Regular Slotted
Container / RSC) corrugated dielines as DXF or SVG. No FastAPI, uvicorn, or
frontend dependency — plain Python + [ezdxf](https://ezdxf.readthedocs.io/)
and [svgwrite](https://svgwrite.readthedocs.io/).

## Install / run

From the repo root:

```sh
uv run dieline generate --style 0201 --l 12 --w 9 --d 4 --flute C --units in --out box.dxf
```

`uv run` creates an isolated venv and installs the CLI's (small) dependency
set on first use — no separate install step needed.

## Usage

```sh
uv run dieline generate \
  --style 0201 \        # FEFCO style code. v1 supports only 0201 (RSC).
  --l 12 --w 9 --d 4 \   # inside length x width x depth, in --units
  --flute C \            # B | C | E | BC — selects board caliper, see below
  --units in \           # "in" (default) or "mm"
  --out box.dxf          # .dxf or .svg; defaults to ./dieline-0201-{L}x{W}x{D}.dxf
```

Full flag reference: `uv run dieline generate --help`.

- **Success**: prints the absolute path of the written file to stdout, exits 0. Nothing else.
- **Failure**: prints one line to stderr (invalid style, non-positive dimensions, unknown flute, bad `--out` extension, or a write error), exits nonzero. No stack traces.

## Flute caliper values

`--flute` selects a board caliper (thickness) from
[`backend/dieline_core/flutes.py`](../backend/dieline_core/flutes.py). Those
are generic placeholder values — **TODO(owner)**: confirm/replace with your
actual board specs before relying on CLI output for production.

## Geometry source of truth

All geometry math lives in [`backend/dieline_core/`](../backend/dieline_core/),
shared by this CLI and the FastAPI backend (`backend/app/services/dieline_generator.py`).
Never duplicate or fork the geometry logic — extend `dieline_core` and both
callers pick it up.

## Agent usage

See [`skills/dieline/SKILL.md`](../skills/dieline/SKILL.md) for how an agent
should decide when/how to invoke this tool, including house conventions for
flute choice, sizing checks, and dimension conventions.
