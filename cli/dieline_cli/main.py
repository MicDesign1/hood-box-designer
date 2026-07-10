"""`dieline` CLI — generate FEFCO corrugated dielines from the command line.

Generation supports table-driven 0201 (RSC), HSC, and tube styles.
`solve` recovers inside dimensions from flat blank measurements.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from dieline_core.flutes import SUPPORTED_FLUTES, caliper_for_flute
from dieline_core.geometry import build_dieline, build_dxf, build_svg
from dieline_core.scoring import RSC_0201_SCORING_FLUTES, normalize_scoring_flute, scoring_flute_error
from dieline_core.solver import Measurements, solve_measurements, validate_measurements, TUBE_FLAP_H_ERROR

PROG = "dieline"
GENERATE_STYLES = ("0201", "hsc", "tube")
SOLVE_STYLES = ("rsc", "hsc", "tube")
SOLVE_FLUTES = ("B", "C", "BC")

GENERATE_STYLE_ALIASES: dict[str, str] = {
    "0201": "0201",
    "rsc": "0201",
    "hsc": "hsc",
    "tube": "tube",
    "tt": "tube",
    "st": "tube",
    "sleeve": "tube",
    "wrap": "tube",
}

SOLVE_STYLE_ALIASES: dict[str, str] = {
    **GENERATE_STYLE_ALIASES,
    "rsc": "rsc",
    "liner": "tube",
}

LINER_GENERATE_ERROR = (
    "liner generation not implemented — solve as tube; liner blanks are dimensionally identical"
)

GENERATE_EXAMPLE = (
    "Examples:\n"
    "  dieline generate --style 0201 --l 12 --w 9 --d 4 --flute C --units in --out box.dxf\n"
    "  dieline generate --style hsc --l 10 --w 8 --d 6 --flute C --out hsc.dxf\n"
    "  dieline generate --style tube --l 14 --w 10 --d 4 --flute C --out tube.dxf\n"
)

SOLVE_EXAMPLE = (
    "Example:\n"
    "  dieline solve --flute C --style rsc --blank-w 42.625 --blank-h 13.625 "
    "--scores-x 12.125,21.3125,33.5 --scores-y 4.625,9.0\n"
)


def _normalize_generate_style(raw: str) -> str | None:
    key = raw.strip().lower()
    if key == "liner":
        return None
    return GENERATE_STYLE_ALIASES.get(key)


def _normalize_solve_style(raw: str | None) -> str | None:
    if raw is None:
        return None
    key = raw.strip().lower()
    return SOLVE_STYLE_ALIASES.get(key)


def _fefco_code_for_generate(style: str) -> str:
    return style


def _fefco_code_for_solve(style: str) -> str:
    if style == "rsc":
        return "0201"
    return style


def _fmt(value: float) -> str:
    return f"{value:g}"


def _fail(message: str) -> int:
    print(f"Error: {message}", file=sys.stderr)
    return 1


def _parse_float_list(raw: str | None, flag: str) -> tuple[float, ...] | None:
    if raw is None:
        return None
    values: list[float] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            value = float(part)
        except ValueError:
            raise ValueError(f"{flag} values must be numbers, got '{part}'.") from None
        if not math.isfinite(value):
            raise ValueError(f"{flag} values must be finite numbers.")
        values.append(value)
    return tuple(values) if values else None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=PROG,
        description=(
            "Generate or reverse-engineer FEFCO corrugated dielines. "
            "Generation supports 0201 (RSC), HSC, and tube; solve supports RSC, HSC, and tube blanks."
        ),
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
        epilog=GENERATE_EXAMPLE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    generate.add_argument(
        "--style",
        required=True,
        metavar="CODE",
        help=(
            f"Style code or alias. Supported: {', '.join(GENERATE_STYLES)} "
            "(aliases: rsc, tt, st, sleeve, wrap). Liner is solve-only."
        ),
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
            "allowances for table-driven styles (B, C, DW rows) and board caliper for slot/fillet "
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
            "Defaults to ./dieline-{style}-{L}x{W}x{D}.dxf in the current directory."
        ),
    )

    solve = subparsers.add_parser(
        "solve",
        help="Recover inside dimensions from flat blank measurements.",
        description=(
            "Inverse solver: given noisy measurements of a torn-open corrugated blank, "
            "recover the designed inside dimensions (L, W, D) and optionally generate a dieline."
        ),
        epilog=SOLVE_EXAMPLE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    solve.add_argument(
        "--flute",
        required=True,
        choices=SOLVE_FLUTES,
        help="Flute type: B, C, or BC (doublewall).",
    )
    solve.add_argument(
        "--style",
        default=None,
        help=(
            "Blank style or alias (rsc, hsc, tube, tt, st, sleeve, wrap, liner). "
            "If omitted, all three families are tried and ranked by fit."
        ),
    )
    solve.add_argument(
        "--joint",
        default="taped",
        choices=["taped", "glued"],
        help="Manufacturer's joint (default taped; glued adds 1.5 in to expected width).",
    )
    solve.add_argument("--blank-w", required=True, type=float, metavar="IN", help="Overall blank width (in).")
    solve.add_argument("--blank-h", required=True, type=float, metavar="IN", help="Overall blank height (in).")
    solve.add_argument(
        "--scores-x",
        default=None,
        metavar="A,B,C",
        help="Vertical score positions from the left edge, inches, comma-separated.",
    )
    solve.add_argument(
        "--scores-y",
        default=None,
        metavar="A[,B]",
        help="Horizontal score positions from the bottom edge, inches, comma-separated.",
    )
    solve.add_argument(
        "--panels-x",
        default=None,
        metavar="A,B,C,D",
        help="Individual WCC panel widths, inches, comma-separated (alternative to --scores-x).",
    )
    solve.add_argument(
        "--flap-h",
        default=None,
        type=float,
        metavar="IN",
        help=(
            "Distance from the blank bottom edge to the first horizontal score (flap height). "
            "RSC/HSC only; with blank-w and blank-h this fully determines the box."
        ),
    )
    solve.add_argument(
        "--panel-1",
        default=None,
        type=float,
        metavar="IN",
        dest="panel_1",
        help=(
            "Distance from the blank left edge to the first vertical score. "
            "Required third measurement for tube; alternative to --flap-h for RSC/HSC."
        ),
    )
    solve.add_argument(
        "--generate",
        action="store_true",
        help="On medium/high confidence, generate a dieline for the solved style and print its path.",
    )
    solve.add_argument(
        "--out",
        default=None,
        metavar="PATH",
        help="Output path for --generate (.dxf or .svg). Defaults to ./dieline-{style}-{L}x{W}x{D}.dxf.",
    )

    return parser


def _run_generate(args: argparse.Namespace) -> int:
    raw_style = args.style.strip().lower()
    if raw_style == "liner":
        return _fail(LINER_GENERATE_ERROR)

    style = _normalize_generate_style(args.style)
    if style is None or style not in GENERATE_STYLES:
        supported = ", ".join(GENERATE_STYLES)
        return _fail(f"unsupported style '{args.style}' (supported: {supported}; aliases: rsc, tt, st, sleeve, wrap).")

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

    out_arg = args.out if args.out else f"./dieline-{style}-{_fmt(length)}x{_fmt(width)}x{_fmt(depth)}.dxf"
    suffix = Path(out_arg).suffix.lower()
    if suffix not in (".dxf", ".svg"):
        return _fail(f"--out must end in .dxf or .svg, got '{out_arg}'.")

    caliper = caliper_for_flute(flute, args.units)
    scoring_flute = normalize_scoring_flute(flute)
    if scoring_flute not in RSC_0201_SCORING_FLUTES:
        return _fail(scoring_flute_error(scoring_flute or flute, style))

    payload = {
        "fefco_code": _fefco_code_for_generate(style),
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


def _run_solve(args: argparse.Namespace) -> int:
    flute = args.flute.strip().upper()
    if flute not in SOLVE_FLUTES:
        return _fail(f"unsupported flute '{args.flute}' (supported: {', '.join(SOLVE_FLUTES)}).")

    solve_style = _normalize_solve_style(args.style)
    if args.style is not None and solve_style is None:
        return _fail(
            f"unsupported style '{args.style}' (supported: {', '.join(SOLVE_STYLES)}; "
            "aliases: tt, st, sleeve, wrap, liner)."
        )
    if solve_style is not None and solve_style not in SOLVE_STYLES:
        return _fail(f"unsupported style '{args.style}' (supported: {', '.join(SOLVE_STYLES)}).")

    if not math.isfinite(args.blank_w) or args.blank_w <= 0:
        return _fail("--blank-w must be a positive number.")
    if not math.isfinite(args.blank_h) or args.blank_h <= 0:
        return _fail("--blank-h must be a positive number.")
    if args.flap_h is not None and (not math.isfinite(args.flap_h) or args.flap_h <= 0):
        return _fail("--flap-h must be a positive number.")
    if args.panel_1 is not None and (not math.isfinite(args.panel_1) or args.panel_1 <= 0):
        return _fail("--panel-1 must be a positive number.")
    if solve_style == "tube" and args.flap_h is not None:
        return _fail(TUBE_FLAP_H_ERROR)

    try:
        scores_x = _parse_float_list(args.scores_x, "--scores-x")
        scores_y = _parse_float_list(args.scores_y, "--scores-y")
        panels_x = _parse_float_list(args.panels_x, "--panels-x")
    except ValueError as exc:
        return _fail(str(exc))

    measurements = Measurements(
        blank_w=args.blank_w,
        blank_h=args.blank_h,
        scores_x=scores_x,
        scores_y=scores_y,
        panels_x=panels_x,
        flap_h=args.flap_h,
        panel_1=args.panel_1,
    )

    input_error = validate_measurements(solve_style, measurements)
    if input_error is not None:
        return _fail(input_error)

    result = solve_measurements(
        measurements,
        flute=flute,
        joint=args.joint,
        style=solve_style,
    )
    if result is None:
        return _fail("could not solve — no valid candidate for the given measurements.")

    if result.confidence in ("low", "ambiguous"):
        if result.confidence == "low":
            print(
                "Warning: poor fit — measurements may be inconsistent or style unsupported; "
                "route to a designer",
                file=sys.stderr,
            )

    print(json.dumps(result.to_dict(), indent=2))

    if args.generate:
        if result.confidence not in ("high", "medium"):
            return _fail("--generate requires medium or high confidence.")
        if result.style not in SOLVE_STYLES:
            return _fail(f"--generate is not supported for style {result.style}.")

        scoring_flute = normalize_scoring_flute(flute)
        if scoring_flute not in RSC_0201_SCORING_FLUTES:
            return _fail(scoring_flute_error(scoring_flute or flute, result.style))

        out_arg = (
            args.out
            if args.out
            else f"./dieline-{result.style}-{_fmt(result.length)}x{_fmt(result.width)}x{_fmt(result.depth)}.dxf"
        )
        suffix = Path(out_arg).suffix.lower()
        if suffix not in (".dxf", ".svg"):
            return _fail(f"--out must end in .dxf or .svg, got '{out_arg}'.")

        caliper = caliper_for_flute(flute, "in")
        payload = {
            "fefco_code": _fefco_code_for_solve(result.style),
            "length": result.length,
            "width": result.width,
            "height": result.depth,
            "caliper": caliper,
            "flute": flute,
            "joint": result.joint,
            "units": "in",
        }
        gen = build_dieline(payload)
        if not gen.ok or not gen.cuts:
            reason = "; ".join(gen.warnings) if gen.warnings else "could not build geometry."
            return _fail(reason)

        out_path = Path(out_arg)
        try:
            if suffix == ".dxf":
                out_path.write_bytes(build_dxf(gen))
            else:
                out_path.write_text(build_svg(gen), encoding="utf-8")
        except OSError as exc:
            return _fail(f"could not write '{out_arg}': {exc.strerror or exc}.")

        print(str(out_path.resolve()))

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "generate":
        return _run_generate(args)
    if args.command == "solve":
        return _run_solve(args)

    parser.print_usage(sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
