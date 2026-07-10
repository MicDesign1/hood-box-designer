"""`dieline` CLI — generate FEFCO corrugated dielines from the command line.

v1 supports style 0201 (Regular Slotted Container / RSC) only. All geometry
is delegated to `dieline_core` (shared with the FastAPI backend) — this
module only handles argument parsing, validation, and file I/O.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from dieline_core.flutes import SUPPORTED_FLUTES, caliper_for_flute
from dieline_core.geometry import build_dieline, build_dxf, build_svg

PROG = "dieline"
SUPPORTED_STYLES = ("0201",)

EXAMPLE = (
    "Example:\n"
    "  dieline generate --style 0201 --l 12 --w 9 --d 4 --flute C --units in --out box.dxf\n"
)


def _fmt(value: float) -> str:
    return f"{value:g}"


def _fail(message: str) -> int:
    print(f"Error: {message}", file=sys.stderr)
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=PROG,
        description=(
            "Generate FEFCO corrugated dielines as DXF or SVG. "
            "v1 supports style 0201 (Regular Slotted Container / RSC) only."
        ),
        epilog=EXAMPLE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser(
        "generate",
        help="Generate a single dieline file (DXF or SVG).",
        description=(
            "Generate a single FEFCO dieline (DXF or SVG) from inside box dimensions.\n"
            "Dimensions are always INSIDE dimensions, in the order length (L) x width (W) x depth (D)."
        ),
        epilog=EXAMPLE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    generate.add_argument(
        "--style",
        required=True,
        metavar="CODE",
        help=f"FEFCO style code. v1 supports only: {', '.join(SUPPORTED_STYLES)}.",
    )
    generate.add_argument(
        "--l",
        dest="length",
        required=True,
        metavar="LENGTH",
        help="Inside length, in --units. Must be a positive number.",
    )
    generate.add_argument(
        "--w",
        dest="width",
        required=True,
        metavar="WIDTH",
        help="Inside width, in --units. Must be a positive number.",
    )
    generate.add_argument(
        "--d",
        dest="depth",
        required=True,
        metavar="DEPTH",
        help="Inside depth, in --units. Must be a positive number.",
    )
    generate.add_argument(
        "--flute",
        required=True,
        metavar="TYPE",
        help=(
            f"Flute type - supported: {', '.join(SUPPORTED_FLUTES)}. Selects scoring "
            "allowances for 0201 (B, C, DW rows) and board caliper for slot/fillet "
            "geometry; see backend/dieline_core/scoring.py and flutes.py."
        ),
    )
    generate.add_argument(
        "--joint",
        default="taped",
        choices=["taped", "glued"],
        help=(
            "Manufacturer's joint style. 'taped' (default) has no glue tab; "
            "'glued' adds a 1.5 in glue tab per the scoring allowance reference."
        ),
    )
    generate.add_argument(
        "--units",
        default="in",
        choices=["in", "mm"],
        help="Unit system for --l/--w/--d and the output geometry. Default: in.",
    )
    generate.add_argument(
        "--out",
        default=None,
        metavar="PATH",
        help=(
            "Output file path. Format is inferred from the extension (.dxf or .svg). "
            "Defaults to ./dieline-0201-{L}x{W}x{D}.dxf in the current directory."
        ),
    )
    return parser


def _run_generate(args: argparse.Namespace) -> int:
    style = args.style
    if style not in SUPPORTED_STYLES:
        return _fail(f"unsupported style '{style}' (v1 supports only: {', '.join(SUPPORTED_STYLES)}).")

    flute = args.flute.strip().upper()
    if flute not in SUPPORTED_FLUTES:
        return _fail(f"unsupported flute '{args.flute}' (supported: {', '.join(SUPPORTED_FLUTES)}).")

    dims: dict[str, float] = {}
    for flag, raw in (("--l", args.length), ("--w", args.width), ("--d", args.depth)):
        try:
            value = float(raw)
        except ValueError:
            return _fail(f"{flag} must be a number, got '{raw}'.")
        if not math.isfinite(value) or value <= 0:
            return _fail(f"{flag} must be a positive number, got '{raw}'.")
        dims[flag] = value

    length, width, depth = dims["--l"], dims["--w"], dims["--d"]

    out_arg = args.out if args.out else f"./dieline-0201-{_fmt(length)}x{_fmt(width)}x{_fmt(depth)}.dxf"
    suffix = Path(out_arg).suffix.lower()
    if suffix not in (".dxf", ".svg"):
        return _fail(f"--out must end in .dxf or .svg, got '{out_arg}'.")

    caliper = caliper_for_flute(flute, args.units)
    payload = {
        "fefco_code": style,
        "length": length,
        "width": width,
        "height": depth,
        "caliper": caliper,
        "flute": flute,
        "joint": args.joint,
        "units": args.units,
    }

    result = build_dieline(payload)
    if not result.ok or not result.cuts:
        reason = "; ".join(result.warnings) if result.warnings else "could not build geometry from the given dimensions."
        return _fail(reason)

    out_path = Path(out_arg)
    try:
        if suffix == ".dxf":
            out_path.write_bytes(build_dxf(result))
        else:
            out_path.write_text(build_svg(result), encoding="utf-8")
    except OSError as exc:
        return _fail(f"could not write '{out_arg}': {exc.strerror or exc}.")

    print(str(out_path.resolve()))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "generate":
        return _run_generate(args)

    parser.print_usage(sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
