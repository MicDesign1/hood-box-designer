"""Shared FEFCO dieline geometry engine.

This is the single source of truth for dieline geometry math. It has no
dependency on FastAPI, uvicorn, pydantic, or anything under `frontend/` —
both the FastAPI backend (`app/services/dieline_generator.py`) and the
`dieline` CLI (`cli/dieline_cli/main.py`) import from here.

Ported from the original `app/services/dieline_generator.py`
during the CLI extraction. Style 0201 panel/flap allowances are
table-driven (see `scoring.py` and scoring-allowances.md); other styles
still use caliper-based allowances. Update both callers and re-run parity
checks when changing geometry math.
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Any

import ezdxf
import svgwrite

from dieline_core.scoring import (
    DEFAULT_JOINT,
    RSC_0201_SCORING_FLUTES,
    fraction_to_unit,
    glue_tab_for_joint,
    hsc_0200_taped_allowances,
    normalize_scoring_flute,
    rsc_0201_scoring_error,
    rsc_0201_taped_allowances,
    scoring_flute_error,
)

if TYPE_CHECKING:
    from ezdxf.document import Drawing as DxfDrawing

TABLE_DRIVEN_FEFCO = frozenset({"0201", "hsc", "tube"})

UNITS: dict[str, dict[str, float | str]] = {
    "in": {
        "label": "in",
        "slotMin": 0.25,
        "folClear": 0.125,
        "chamferMax": 0.5,
        "hookMax": 0.5,
        "filletMin": 0.125,
        "labelSize": 0.13,
        "labelOffset": 0.18,
    },
    "mm": {
        "label": "mm",
        "slotMin": 6.0,
        "folClear": 3.0,
        "chamferMax": 12.0,
        "hookMax": 12.0,
        "filletMin": 3.2,
        "labelSize": 3.3,
        "labelOffset": 4.5,
    },
}

FILLET_CLAMP_MARGIN = 0.95
FILLET_MIN_RADIUS = 1e-6

STROKE_WIDTH_IN = 0.007  # ~0.5 pt at 72 dpi

HAIRLINE_CSS = f"""
.dieline-cut {{
  fill: none;
  stroke: #dc2626;
  stroke-width: {STROKE_WIDTH_IN};
  shape-rendering: geometricPrecision;
}}
.dieline-crease {{
  fill: none;
  stroke: #16a34a;
  stroke-width: {STROKE_WIDTH_IN};
  stroke-dasharray: 0.06 0.04;
  shape-rendering: geometricPrecision;
}}
.dieline-dim {{
  fill: #1f2937;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
}}
.dieline-dim-faint {{
  fill: #9ca3af;
}}
"""

SVG_PAD = 0.25
SVG_PAD_LEFT = 0.5
COORD_PRECISION = 8


@dataclass
class LineSegment:
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass
class ArcSegment:
    """A quarter-circle fillet replacing a sharp 90° corner between two
    axis-aligned segments. (x1,y1)/(x2,y2) are the trim points on each of
    the two adjacent lines; `sweep_flag` is the SVG sweep-flag for the arc
    drawn from (x1,y1) to (x2,y2), computed once here and reused by both
    SVG and DXF export so they can't independently desync.
    """

    x1: float
    y1: float
    x2: float
    y2: float
    cx: float
    cy: float
    radius: float
    sweep_flag: int


@dataclass
class LabelMark:
    """A dimension callout anchored to a point on the dieline, in drawing units.

    Numeric formatting (fractions vs decimals, in vs mm) is left to the
    caller so the same mark data can back both the preview and any future
    export annotations.
    """

    x: float
    y: float
    kind: str  # "panel" | "tab" | "flap" | "glue" | "height" | "blank" | "reference"
    value: float | None = None
    # Second value for two-part callouts (currently only "blank": value=width,
    # value2=height). Unused by every other kind.
    value2: float | None = None
    # Panel letter ("L"/"W") for "panel" kind; the user-supplied label text
    # for "reference" kind. Unused by every other kind.
    letter: str | None = None
    panel_index: int | None = None
    small: bool = False
    faint: bool = False


@dataclass
class DielineResult:
    ok: bool = False
    warnings: list[str] = field(default_factory=list)
    cuts: list[LineSegment | ArcSegment] = field(default_factory=list)
    creases: list[LineSegment] = field(default_factory=list)
    labels: list[LabelMark] = field(default_factory=list)
    total_w: float = 0.0
    total_h: float = 0.0
    unit: str = "in"
    derived: dict[str, Any] = field(default_factory=dict)


def parse_dim(value: float | str | None) -> float:
    """Faithful port of the reference parseDim helper."""
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return math.nan

    text = str(value).strip().lower()
    text = re.sub(r'(?:"|″|\'\'|in\.?|mm)\s*$', "", text).strip()

    fraction = re.match(r"^(?:(\d+(?:\.\d+)?)\s*[- ]\s*)?(\d+)\s*/\s*(\d+)$", text)
    if fraction:
        whole = float(fraction.group(1)) if fraction.group(1) else 0.0
        denominator = float(fraction.group(3))
        if denominator == 0:
            return math.nan
        return whole + float(fraction.group(2)) / denominator

    try:
        parsed = float(text)
    except ValueError:
        return math.nan
    return parsed if math.isfinite(parsed) else math.nan


def _unit_constants(unit: str) -> dict[str, float | str]:
    return UNITS.get(unit, UNITS["in"])


def _round_coord(value: float) -> float:
    return round(value, COORD_PRECISION)


def _seg(
    cuts: list[LineSegment],
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> None:
    if math.isclose(x1, x2, abs_tol=1e-9) and math.isclose(y1, y2, abs_tol=1e-9):
        return
    cuts.append(LineSegment(x1, y1, x2, y2))


def _cr(
    creases: list[LineSegment],
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> None:
    if math.isclose(x1, x2, abs_tol=1e-9) and math.isclose(y1, y2, abs_tol=1e-9):
        return
    creases.append(LineSegment(x1, y1, x2, y2))


def _away(cx: float, cy: float, nx: float, ny: float) -> tuple[float, float]:
    """Unit vector from corner (cx,cy) toward neighboring vertex (nx,ny)."""
    dx, dy = nx - cx, ny - cy
    length = math.hypot(dx, dy)
    return (dx / length, dy / length)


def _fillet(
    cuts: list[LineSegment | ArcSegment],
    corner: tuple[float, float],
    dir_a: tuple[float, float],
    dir_b: tuple[float, float],
    radius: float,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """Replaces a sharp 90° corner with a quarter-circle fillet.

    Appends the ArcSegment and returns the two trim points (on line A and
    line B respectively) so the caller can thread them verbatim into the
    adjacent _seg() calls, guaranteeing bit-identical shared endpoints.
    """
    cx0, cy0 = corner
    p_a = (cx0 + radius * dir_a[0], cy0 + radius * dir_a[1])
    p_b = (cx0 + radius * dir_b[0], cy0 + radius * dir_b[1])
    center = (cx0 + radius * dir_a[0] + radius * dir_b[0], cy0 + radius * dir_a[1] + radius * dir_b[1])
    a1 = math.degrees(math.atan2(p_a[1] - center[1], p_a[0] - center[0])) % 360
    a2 = math.degrees(math.atan2(p_b[1] - center[1], p_b[0] - center[0])) % 360
    sweep_flag = 1 if (a2 - a1) % 360 <= 180 else 0
    cuts.append(ArcSegment(p_a[0], p_a[1], p_b[0], p_b[1], center[0], center[1], radius, sweep_flag))
    return p_a, p_b


def build_dieline(spec: dict[str, Any]) -> DielineResult:
    """Faithful Python port of the reference buildDieline (sharp slot corners).

    `spec` is a plain dict (e.g. `{"fefco_code": "0201", "length": 12, ...}`)
    — this module has no pydantic dependency, so callers are responsible for
    validating/normalizing their own input shape before calling in.
    """
    payload = spec

    unit = payload.get("units", "in")
    unit_values = _unit_constants(unit)
    fefco_code = payload.get("fefco_code", "0201")

    length = parse_dim(payload.get("length"))
    width = parse_dim(payload.get("width"))
    height = parse_dim(payload.get("height"))
    caliper = parse_dim(payload.get("caliper"))
    glue_tab = parse_dim(payload.get("glue_tab"))
    joint = str(payload.get("joint", DEFAULT_JOINT)).strip().lower()
    overlap = parse_dim(payload.get("overlap"))
    slot_in = parse_dim(payload.get("slot"))
    flute_raw = payload.get("flute")
    if flute_raw is None:
        flute_raw = payload.get("flute_type")
    flute_specified = flute_raw is not None and str(flute_raw).strip() != ""
    scoring_flute = normalize_scoring_flute(str(flute_raw)) if flute_specified else None

    if fefco_code in TABLE_DRIVEN_FEFCO:
        tab_width_in = parse_dim(payload.get("tab_width"))
        if math.isfinite(glue_tab) and glue_tab >= 0:
            glue = glue_tab
        elif joint == "glued":
            glue = glue_tab_for_joint(
                "glued",
                unit,
                tab_width_in if math.isfinite(tab_width_in) and tab_width_in > 0 else None,
            )
        else:
            glue = 0.0
    else:
        glue = glue_tab if math.isfinite(glue_tab) and glue_tab > 0 else (1.25 if unit == "in" else 32.0)
    overlap_val = overlap if math.isfinite(overlap) and overlap > 0 else (1.375 if unit == "in" else 35.0)
    slot = (
        slot_in
        if math.isfinite(slot_in) and slot_in > 0
        else max(float(unit_values["slotMin"]), 2 * (caliper if math.isfinite(caliper) else 0.0))
    )

    warnings: list[str] = []
    if not (length > 0 and width > 0 and height > 0):
        warnings.append("Enter positive L × W × H")
    if not (caliper > 0):
        warnings.append("Caliper must be greater than zero.")
    if fefco_code in TABLE_DRIVEN_FEFCO:
        if joint not in ("taped", "glued"):
            warnings.append("joint must be 'taped' or 'glued'.")
        if scoring_flute is None:
            scoring_flute = "C"
        elif scoring_flute not in RSC_0201_SCORING_FLUTES:
            warnings.append(scoring_flute_error(scoring_flute, fefco_code))

    if warnings:
        return DielineResult(ok=False, warnings=warnings, unit=unit)

    fillet_radius_raw = payload.get("fillet_radius")
    if fillet_radius_raw is None:
        fillet_radius_cfg = max(0.75 * caliper, float(unit_values["filletMin"]))
    else:
        parsed_fillet = parse_dim(fillet_radius_raw)
        fillet_radius_cfg = parsed_fillet if math.isfinite(parsed_fillet) and parsed_fillet >= 0 else 0.0

    is_crash_lock = fefco_code == "0713"

    panel_length: float
    panel_width: float
    body_height: float
    flap_top: float
    flap_bottom: float

    if fefco_code == "0201":
        row = rsc_0201_taped_allowances(scoring_flute)  # type: ignore[arg-type]
        base_dims = (length, width, length, width)
        panels = [
            base + fraction_to_unit(adder, unit)
            for base, adder in zip(base_dims, row.wcc_panel_adds, strict=True)
        ]
        panel_length, panel_width = panels[0], panels[1]
        body_height = height + fraction_to_unit(row.depth_add, unit)
        half_flap = width / 2 + fraction_to_unit(row.flap_half_add, unit)
        flap_top = flap_bottom = half_flap
    elif fefco_code == "hsc":
        row = hsc_0200_taped_allowances(scoring_flute)  # type: ignore[arg-type]
        base_dims = (length, width, length, width)
        panels = [
            base + fraction_to_unit(adder, unit)
            for base, adder in zip(base_dims, row.wcc_panel_adds, strict=True)
        ]
        panel_length, panel_width = panels[0], panels[1]
        body_height = height + fraction_to_unit(row.depth_add, unit)
        half_flap = width / 2 + fraction_to_unit(row.flap_half_add, unit)
        flap_top = 0.0
        flap_bottom = half_flap
    elif fefco_code == "tube":
        row = rsc_0201_taped_allowances(scoring_flute)  # type: ignore[arg-type]
        base_dims = (length, width, length, width)
        panels = [
            base + fraction_to_unit(adder, unit)
            for base, adder in zip(base_dims, row.wcc_panel_adds, strict=True)
        ]
        panel_length, panel_width = panels[0], panels[1]
        body_height = height
        flap_top = flap_bottom = 0.0
    else:
        panel_length = length + caliper
        panel_width = width + caliper
        body_height = height + caliper
        panels = [panel_length, panel_width, panel_length, panel_width]
        if fefco_code == "0200":
            flap_top = 0.0
            flap_bottom = (width + caliper) / 2
        elif fefco_code == "0202":
            flap_top = flap_bottom = (width + caliper + overlap_val) / 2
        elif fefco_code == "0203":
            flap_top = flap_bottom = max(0.0, width + caliper - float(unit_values["folClear"]))
        elif fefco_code == "0713":
            flap_top = (width + caliper) / 2
            flap_bottom = 0.0
        else:
            flap_top = flap_bottom = (width + caliper) / 2

    hook = min(float(unit_values["hookMax"]), panel_width * 0.15)
    major_depth = panel_width / 2 + hook
    minor_depth = panel_width / 2 - float(unit_values["folClear"])
    if is_crash_lock:
        flap_bottom = major_depth

    x0 = glue
    x_boundaries = [x0]
    for panel in panels:
        x_boundaries.append(x_boundaries[-1] + panel)
    x_right = x_boundaries[4]

    total_h = flap_top + body_height + flap_bottom
    y_top = flap_top
    y_bottom = flap_top + body_height
    chamfer = min(float(unit_values["chamferMax"]), body_height / 4)
    half_slot = slot / 2

    cuts: list[LineSegment | ArcSegment] = []
    creases: list[LineSegment] = []
    labels: list[LabelMark] = []

    # Top edge + slot notches, root corners filleted where the slot wall
    # meets the flap-top crease (the stress point during erection).
    if flap_top > 0:
        cursor_x = x0
        top_fillet_r = min(fillet_radius_cfg, half_slot * FILLET_CLAMP_MARGIN, flap_top * FILLET_CLAMP_MARGIN)
        if top_fillet_r > FILLET_MIN_RADIUS and top_fillet_r < fillet_radius_cfg - 1e-9:
            warnings.append(
                f"Top slot fillet radius reduced to fit narrow slot/shallow flap "
                f"(requested {fillet_radius_cfg:.4g}{unit}, used {top_fillet_r:.4g}{unit})."
            )
        for index in range(1, 4):
            boundary = x_boundaries[index]
            left_x, right_x = boundary - half_slot, boundary + half_slot
            _seg(cuts, cursor_x, 0.0, left_x, 0.0)
            if top_fillet_r > FILLET_MIN_RADIUS:
                p1, p2 = _fillet(
                    cuts, (left_x, y_top), _away(left_x, y_top, left_x, 0.0), _away(left_x, y_top, right_x, y_top), top_fillet_r
                )
                _seg(cuts, left_x, 0.0, p1[0], p1[1])
                p3, p4 = _fillet(
                    cuts, (right_x, y_top), _away(right_x, y_top, left_x, y_top), _away(right_x, y_top, right_x, 0.0), top_fillet_r
                )
                _seg(cuts, p2[0], p2[1], p3[0], p3[1])
                _seg(cuts, p4[0], p4[1], right_x, 0.0)
            else:
                _seg(cuts, left_x, 0.0, left_x, y_top)
                _seg(cuts, left_x, y_top, right_x, y_top)
                _seg(cuts, right_x, y_top, right_x, 0.0)
            cursor_x = right_x
        _seg(cuts, cursor_x, 0.0, x_right, 0.0)
    else:
        _seg(cuts, x0, 0.0, x_right, 0.0)

    # Right edge
    _seg(cuts, x_right, 0.0, x_right, y_bottom if is_crash_lock else total_h)

    # Bottom edge: crash-lock gets the alternating major/minor self-locking
    # base (ported from the reference implementation); everything else gets
    # the RSC-style slot notches, root corners filleted (mirror of the top loop).
    if is_crash_lock:
        def _minor_flap(xa: float, xbnd: float) -> None:
            """A short trapezoidal tuck-under flap (45° cut, no glue diagonal)."""
            _seg(cuts, xbnd - caliper, y_bottom, xbnd - caliper, y_bottom + minor_depth)
            _seg(cuts, xbnd - caliper, y_bottom + minor_depth, xa + caliper + minor_depth, y_bottom + minor_depth)
            _seg(cuts, xa + caliper + minor_depth, y_bottom + minor_depth, xa + caliper, y_bottom)
            _cr(creases, xa + caliper, y_bottom, xbnd - caliper, y_bottom)

        def _major_flap(xa: float, xbnd: float) -> None:
            """A deeper flap with an integrated glue diagonal for self-locking."""
            _seg(cuts, xbnd - caliper, y_bottom, xbnd - caliper, y_bottom + major_depth)
            _seg(cuts, xbnd - caliper, y_bottom + major_depth, xa + caliper, y_bottom + major_depth)
            _seg(cuts, xa + caliper, y_bottom + major_depth, xa + caliper, y_bottom)
            _cr(creases, xa + caliper, y_bottom, xbnd - caliper, y_bottom)
            _cr(creases, xa + caliper, y_bottom, xa + caliper + major_depth, y_bottom + major_depth)
            labels.append(
                LabelMark(
                    x=xa + caliper + major_depth * 0.32,
                    y=y_bottom + major_depth * 0.72,
                    kind="glue",
                    small=True,
                    faint=True,
                )
            )

        _seg(cuts, x_right, y_bottom, x_boundaries[4] - caliper, y_bottom)
        _minor_flap(x_boundaries[3], x_boundaries[4])
        _seg(cuts, x_boundaries[3] + caliper, y_bottom, x_boundaries[3] - caliper, y_bottom)
        _major_flap(x_boundaries[2], x_boundaries[3])
        _seg(cuts, x_boundaries[2] + caliper, y_bottom, x_boundaries[2] - caliper, y_bottom)
        _minor_flap(x_boundaries[1], x_boundaries[2])
        _seg(cuts, x_boundaries[1] + caliper, y_bottom, x_boundaries[1] - caliper, y_bottom)
        _major_flap(x_boundaries[0], x_boundaries[1])
        _seg(cuts, x_boundaries[0] + caliper, y_bottom, x0, y_bottom)
    elif flap_bottom > 0:
        cursor_x = x_right
        bottom_fillet_r = min(fillet_radius_cfg, half_slot * FILLET_CLAMP_MARGIN, flap_bottom * FILLET_CLAMP_MARGIN)
        if bottom_fillet_r > FILLET_MIN_RADIUS and bottom_fillet_r < fillet_radius_cfg - 1e-9:
            warnings.append(
                f"Bottom slot fillet radius reduced to fit narrow slot/shallow flap "
                f"(requested {fillet_radius_cfg:.4g}{unit}, used {bottom_fillet_r:.4g}{unit})."
            )
        for index in range(3, 0, -1):
            boundary = x_boundaries[index]
            right_x, left_x = boundary + half_slot, boundary - half_slot
            _seg(cuts, cursor_x, total_h, right_x, total_h)
            if bottom_fillet_r > FILLET_MIN_RADIUS:
                p1, p2 = _fillet(
                    cuts,
                    (right_x, y_bottom),
                    _away(right_x, y_bottom, right_x, total_h),
                    _away(right_x, y_bottom, left_x, y_bottom),
                    bottom_fillet_r,
                )
                _seg(cuts, right_x, total_h, p1[0], p1[1])
                p3, p4 = _fillet(
                    cuts,
                    (left_x, y_bottom),
                    _away(left_x, y_bottom, right_x, y_bottom),
                    _away(left_x, y_bottom, left_x, total_h),
                    bottom_fillet_r,
                )
                _seg(cuts, p2[0], p2[1], p3[0], p3[1])
                _seg(cuts, p4[0], p4[1], left_x, total_h)
            else:
                _seg(cuts, right_x, total_h, right_x, y_bottom)
                _seg(cuts, right_x, y_bottom, left_x, y_bottom)
                _seg(cuts, left_x, y_bottom, left_x, total_h)
            cursor_x = left_x
        _seg(cuts, cursor_x, total_h, x0, total_h)
    else:
        _seg(cuts, x_right, total_h, x0, total_h)

    # Left edge + glue-tab chamfer
    _seg(cuts, x0, y_bottom if is_crash_lock else total_h, x0, y_bottom)
    _seg(cuts, x0, y_bottom, 0.0, y_bottom - chamfer)
    _seg(cuts, 0.0, y_bottom - chamfer, 0.0, y_top + chamfer)
    _seg(cuts, 0.0, y_top + chamfer, x0, y_top)
    if flap_top > 0:
        _seg(cuts, x0, y_top, x0, 0.0)

    # Creases
    _cr(creases, x0, y_top, x0, y_bottom)
    for index in range(1, 4):
        _cr(creases, x_boundaries[index], y_top, x_boundaries[index], y_bottom)

    for index in range(4):
        left = x_boundaries[index] + (0.0 if index == 0 else half_slot)
        right = x_boundaries[index + 1] - (0.0 if index == 3 else half_slot)
        if flap_top > 0:
            _cr(creases, left, y_top, right, y_top)
        if not is_crash_lock and flap_bottom > 0:
            _cr(creases, left, y_bottom, right, y_bottom)

    # Dimension callouts, ported 1:1 from the reference implementation's label
    # placement (panel centers, glue tab, flap depth). GLUE labels for
    # crash-lock were already appended above, inline with each major flap.
    mid_y = y_top + body_height / 2
    names = ["L", "W", "L", "W"]
    for index in range(4):
        center_x = (x_boundaries[index] + x_boundaries[index + 1]) / 2
        labels.append(
            LabelMark(
                x=center_x,
                y=mid_y,
                kind="panel",
                value=panels[index],
                letter=names[index],
                panel_index=index + 1,
            )
        )
    if glue > 0:
        labels.append(LabelMark(x=glue / 2, y=mid_y, kind="tab", value=glue, small=True))
    if not is_crash_lock and flap_bottom > 0:
        flap_left = x_boundaries[0]
        flap_right = x_boundaries[1]
        labels.append(
            LabelMark(
                x=(flap_left + flap_right) / 2,
                y=y_bottom + flap_bottom / 2,
                kind="flap",
                value=flap_bottom,
                small=True,
            )
        )
    elif is_crash_lock:
        flap_left = x_boundaries[2]
        flap_right = x_boundaries[3]
        labels.append(
            LabelMark(
                x=(flap_left + flap_right) / 2,
                y=y_bottom + major_depth / 2,
                kind="flap",
                value=major_depth,
                small=True,
            )
        )

    # H callout (box height, not just the L/W panel labels above) and the
    # overall blank-size callout -- both computed but never drawn before
    # Phase 4; placed in the left margin / below the drawing respectively,
    # which _shift_geometry's asymmetric SVG_PAD_LEFT already reserves room
    # for. Anchored at the true left edge (x=0), not x0 -- x0 is the glue
    # tab's own right edge for a glued joint (0 only for taped), so anchoring
    # there would land the callout inside the tab, on top of its "TAB" label.
    label_offset = float(unit_values["labelOffset"])
    labels.append(
        LabelMark(
            x=-label_offset,
            y=mid_y,
            kind="height",
            value=body_height,
        )
    )
    labels.append(
        LabelMark(
            x=x_right / 2,
            y=total_h + label_offset,
            kind="blank",
            value=x_right,
            value2=total_h,
        )
    )

    derived = {
        "panel_L": panels[0],
        "panel_W": panels[1],
        "panel_L2": panels[2],
        "panel_W2": panels[3],
        "depth_score": body_height,
        "flap_top": flap_top,
        "flap_bottom": flap_bottom,
        "major_flap_depth": major_depth,
        "minor_flap_depth": minor_depth,
        "slot_width": slot,
        "glue_tab": glue,
        "blank_w": x_right,
        "blank_h": total_h,
        "overlap": overlap_val,
        "fillet_radius": fillet_radius_cfg,
        "units": unit,
        "joint": joint if fefco_code in TABLE_DRIVEN_FEFCO else None,
        "scoring_flute": scoring_flute if fefco_code in TABLE_DRIVEN_FEFCO else None,
    }

    if is_crash_lock:
        warnings.append(
            "0713 crash-lock uses simplified bottom geometry; validate locks on press before production."
        )

    return DielineResult(
        ok=True,
        warnings=warnings,
        cuts=cuts,
        creases=creases,
        labels=labels,
        total_w=x_right,
        total_h=total_h,
        unit=unit,
        derived=derived,
    )


def _shift_geometry(result: DielineResult, dx: float, dy: float) -> DielineResult:
    def shift(segment: LineSegment | ArcSegment) -> LineSegment | ArcSegment:
        if isinstance(segment, ArcSegment):
            return ArcSegment(
                segment.x1 + dx,
                segment.y1 + dy,
                segment.x2 + dx,
                segment.y2 + dy,
                segment.cx + dx,
                segment.cy + dy,
                segment.radius,
                segment.sweep_flag,
            )
        return LineSegment(
            segment.x1 + dx,
            segment.y1 + dy,
            segment.x2 + dx,
            segment.y2 + dy,
        )

    return DielineResult(
        ok=result.ok,
        warnings=result.warnings,
        cuts=[shift(segment) for segment in result.cuts],
        creases=[shift(segment) for segment in result.creases],
        labels=[
            LabelMark(
                x=label.x + dx,
                y=label.y + dy,
                kind=label.kind,
                value=label.value,
                value2=label.value2,
                letter=label.letter,
                panel_index=label.panel_index,
                small=label.small,
                faint=label.faint,
            )
            for label in result.labels
        ],
        total_w=result.total_w + dx,
        total_h=result.total_h + dy,
        unit=result.unit,
        derived=result.derived,
    )


def append_reference_legend(result: DielineResult, reference_dimensions: list[tuple[str, float]]) -> DielineResult:
    """Appends one LabelMark(kind="reference") per (label, raw_inches) pair,
    stacked in a left-aligned block below the blank-size callout. Purely
    additive to `labels` -- does not touch cuts, creases, or derived, so it
    cannot affect golden-file geometry parity.

    Takes plain (label, raw_inches) tuples, not the backend's pydantic
    ReferenceDimension model -- this module (and the `dieline` CLI that also
    imports it) has no pydantic dependency, by design (see module docstring).
    Converting the pydantic model to plain tuples is the caller's job
    (app/services/dieline_generator.py).
    """
    if not reference_dimensions:
        return result
    unit_values = _unit_constants(result.unit)
    label_offset = float(unit_values["labelOffset"])
    label_size = float(unit_values["labelSize"])
    legend_y_start = result.total_h + label_offset * 2 + label_size
    new_labels = list(result.labels)
    for index, (label, raw_inches) in enumerate(reference_dimensions):
        new_labels.append(
            LabelMark(
                x=0.0,
                y=legend_y_start + index * label_size * 1.6,
                kind="reference",
                value=raw_inches,
                letter=label,
            )
        )
    return DielineResult(
        ok=result.ok,
        warnings=result.warnings,
        cuts=result.cuts,
        creases=result.creases,
        labels=new_labels,
        total_w=result.total_w,
        total_h=result.total_h,
        unit=result.unit,
        derived=result.derived,
    )


# Faithful port of frontend/src/lib/imperial.ts's formatFractionInches /
# snapToFraction, so dimension callouts on the exported dieline read
# identically to the app's own on-screen/PDF formatting. Display-only: never
# used by any geometry or allowance math in this module.
FRACTION_DENOMINATORS = (2, 4, 8, 16, 32, 64)


def _gcd(a: int, b: int) -> int:
    a, b = abs(a), abs(b)
    while b:
        a, b = b, a % b
    return a


def _snap_to_fraction(inches: float, max_denominator: int) -> tuple[int, int, int]:
    sign = -1 if inches < 0 else 1
    absolute = abs(inches)
    whole = math.floor(absolute)
    fractional = absolute - whole

    best_numerator = 0
    best_denominator = 1
    best_error = math.inf
    for denominator in FRACTION_DENOMINATORS:
        if denominator > max_denominator:
            break
        numerator = round(fractional * denominator)
        error = abs(fractional - numerator / denominator)
        if error < best_error:
            best_error = error
            best_numerator = numerator
            best_denominator = denominator

    adjusted_whole = whole
    numerator = best_numerator
    denominator = best_denominator
    if numerator == denominator:
        adjusted_whole += 1
        numerator = 0

    divisor = _gcd(numerator, denominator)
    reduced_numerator = numerator // divisor
    reduced_denominator = denominator // divisor

    return adjusted_whole * sign, reduced_numerator, reduced_denominator


def format_fraction_inches(inches: float, max_denominator: int = 32) -> str:
    whole, numerator, denominator = _snap_to_fraction(inches, max_denominator)
    if numerator == 0:
        return str(whole)
    absolute_whole = abs(whole)
    fraction = f"{numerator}/{denominator}"
    if absolute_whole == 0:
        return f"-{fraction}" if whole < 0 else fraction
    return f"-{absolute_whole} {fraction}" if whole < 0 else f"{absolute_whole} {fraction}"


def _fmt_dim(value: float, unit: str) -> str:
    if unit == "mm":
        rounded = round(value * 10) / 10
        text = f"{rounded:g}"
        return f"{text} mm"
    return f'{format_fraction_inches(value, 32)}"'


def _label_lines(mark: LabelMark, unit: str) -> tuple[str, str | None]:
    """Same text a mark would show in the frontend live preview
    (dieline-preview.tsx's labelLines) -- kept in sync by hand since this
    module has no dependency on frontend code."""
    if mark.kind == "panel":
        return f"{mark.letter or ''} {_fmt_dim(mark.value or 0, unit)}", f"panel {mark.panel_index or ''}"
    if mark.kind == "tab":
        return "TAB", _fmt_dim(mark.value or 0, unit)
    if mark.kind == "flap":
        return f"flap {_fmt_dim(mark.value or 0, unit)}", None
    if mark.kind == "glue":
        return "GLUE", None
    if mark.kind == "height":
        return f"H {_fmt_dim(mark.value or 0, unit)}", None
    if mark.kind == "blank":
        return f"Blank {_fmt_dim(mark.value or 0, unit)} x {_fmt_dim(mark.value2 or 0, unit)}", None
    if mark.kind == "reference":
        return f"{mark.letter or ''}: {_fmt_dim(mark.value or 0, unit)}", None
    return "", None


def _apply_export_label_layout(result: DielineResult) -> DielineResult:
    """Export-only label repositioning: H moves to the margin opposite the
    glue tab (when one exists), and the blank-size callout gets extra
    clearance below the drawing. Operates on `result`'s own coordinate
    space (unshifted, matching build_dieline()'s own output) so the same
    override works unmodified for build_dxf (uses it directly) and for
    build_svg (which uniformly shifts everything afterwards via
    _shift_geometry, including these overridden positions).

    Purely a drawing decision, not a geometry one: doesn't touch
    cuts/creases/derived, and is never exposed outside build_svg/build_dxf
    -- the API's own `geometry` response (which the live preview reads)
    keeps build_dieline()'s original per-spec label positions unmodified.
    This is a port of the frontend live preview's own, independently
    implemented layout choice for these same two kinds (dieline-preview.tsx)
    to the export renderers -- not a shared-code path between the two.
    """
    label_size = float(_unit_constants(result.unit)["labelSize"])
    has_tab = any(m.kind == "tab" for m in result.labels)
    new_labels: list[LabelMark] = []
    for mark in result.labels:
        if mark.kind == "height":
            clearance = label_size * 2.2
            x = result.total_w + clearance if has_tab else -clearance
            new_labels.append(replace(mark, x=x))
        elif mark.kind == "blank":
            new_labels.append(replace(mark, y=result.total_h + label_size * 1.8))
        else:
            new_labels.append(mark)
    return DielineResult(
        ok=result.ok,
        warnings=result.warnings,
        cuts=result.cuts,
        creases=result.creases,
        labels=new_labels,
        total_w=result.total_w,
        total_h=result.total_h,
        unit=result.unit,
        derived=result.derived,
    )


def build_svg(result: DielineResult) -> str:
    """Layered SVG (cuts + creases + dimension callouts) with physical inch
    sizing and margin padding."""
    padded = _shift_geometry(_apply_export_label_layout(result), SVG_PAD_LEFT, SVG_PAD)
    label_max_x = max((label.x for label in padded.labels), default=padded.total_w)
    label_max_y = max((label.y for label in padded.labels), default=padded.total_h)
    view_w = max(padded.total_w + SVG_PAD, label_max_x + SVG_PAD)
    view_h = max(padded.total_h + SVG_PAD, label_max_y + SVG_PAD)
    width_pt = view_w * 72
    height_pt = view_h * 72

    drawing = svgwrite.Drawing(
        size=(f"{width_pt}pt", f"{height_pt}pt"),
        viewBox=f"0 0 {view_w} {view_h}",
        profile="full",
    )
    drawing.attribs["overflow"] = "visible"

    defs = drawing.defs
    defs.add(drawing.style(HAIRLINE_CSS))

    crease_group = drawing.g(id="crease-lines")
    for segment in padded.creases:
        crease_group.add(
            drawing.line(
                start=(segment.x1, segment.y1),
                end=(segment.x2, segment.y2),
                class_="dieline-crease",
            )
        )
    drawing.add(crease_group)

    cut_group = drawing.g(id="cut-lines")
    for segment in padded.cuts:
        if isinstance(segment, ArcSegment):
            d = (
                f"M {segment.x1} {segment.y1} "
                f"A {segment.radius} {segment.radius} 0 0 {segment.sweep_flag} {segment.x2} {segment.y2}"
            )
            cut_group.add(drawing.path(d=d, class_="dieline-cut"))
        else:
            cut_group.add(
                drawing.line(
                    start=(segment.x1, segment.y1),
                    end=(segment.x2, segment.y2),
                    class_="dieline-cut",
                )
            )
    drawing.add(cut_group)

    label_size = float(_unit_constants(padded.unit)["labelSize"])
    dim_group = drawing.g(id="dimensions")
    for mark in padded.labels:
        main, sub = _label_lines(mark, padded.unit)
        if not main:
            continue
        size = label_size * 0.62 if mark.small else label_size
        # TAB and H render as vertical text -- matches the frontend live
        # preview's own choice for these same two kinds.
        rotated = mark.kind in ("tab", "height")
        # "reference" grows rightward from its anchor point instead of
        # centering, so it can't overflow left past x=0 into the SVG's
        # narrow left margin. Rotated marks always center on their own
        # vertical run (matches the preview).
        anchor = "middle" if rotated else ("start" if mark.kind == "reference" else "middle")
        css_class = "dieline-dim dieline-dim-faint" if mark.faint else "dieline-dim"
        main_attrs: dict[str, Any] = {
            "insert": (mark.x, mark.y),
            "text_anchor": anchor,
            "font_size": size,
            "class_": css_class,
        }
        if rotated:
            main_attrs["transform"] = f"rotate(-90 {mark.x} {mark.y})"
        dim_group.add(drawing.text(main, **main_attrs))
        if sub:
            # For rotated marks the main label's own glyphs already run
            # vertically for several character-heights, so offsetting the
            # sub-line vertically (as unrotated marks do) lands it inside
            # that span, not below it. Offset horizontally instead -- after
            # rotation that reads as a second, parallel vertical column
            # beside the main label. Matches the preview's identical fix.
            sub_x, sub_y = (mark.x + size * 0.9, mark.y) if rotated else (mark.x, mark.y + size * 0.9)
            sub_attrs: dict[str, Any] = {
                "insert": (sub_x, sub_y),
                "text_anchor": anchor,
                "font_size": size * 0.5,
                "class_": "dieline-dim",
                "fill": "#6b7280",
            }
            if rotated:
                sub_attrs["transform"] = f"rotate(-90 {sub_x} {sub_y})"
            dim_group.add(drawing.text(sub, **sub_attrs))
    drawing.add(dim_group)

    return drawing.tostring()


def _configure_dxf_units(doc: DxfDrawing, unit: str) -> None:
    """Declare drawing units for CAD importers (ArtiosCAD, etc.)."""
    doc.header["$MEASUREMENT"] = 0 if unit == "in" else 1
    doc.header["$INSUNITS"] = 1 if unit == "in" else 4


def build_dxf(result: DielineResult) -> bytes:
    """Port of reference buildDXF — simple LINE entities, no display padding."""
    from ezdxf.enums import TextEntityAlignment

    result = _apply_export_label_layout(result)

    doc: DxfDrawing = ezdxf.new("R2010")
    _configure_dxf_units(doc, result.unit)
    doc.layers.add("CUT", color=1)
    doc.layers.add("CREASE", color=3)
    doc.layers.add("DIMENSION", color=5)
    if "DASHED" not in doc.linetypes:
        doc.linetypes.add(
            "DASHED",
            pattern=[0.25, 0.125, -0.125],
            description="Dashed __ __",
        )

    msp = doc.modelspace()

    for segment in result.cuts:
        if isinstance(segment, ArcSegment):
            a1 = math.degrees(math.atan2(segment.y1 - segment.cy, segment.x1 - segment.cx)) % 360
            a2 = math.degrees(math.atan2(segment.y2 - segment.cy, segment.x2 - segment.cx)) % 360
            start, end = (a1, a2) if segment.sweep_flag == 1 else (a2, a1)
            msp.add_arc(
                (_round_coord(segment.cx), _round_coord(segment.cy)),
                _round_coord(segment.radius),
                start,
                end,
                dxfattribs={"layer": "CUT"},
            )
        else:
            msp.add_line(
                (_round_coord(segment.x1), _round_coord(segment.y1)),
                (_round_coord(segment.x2), _round_coord(segment.y2)),
                dxfattribs={"layer": "CUT"},
            )

    for segment in result.creases:
        msp.add_line(
            (_round_coord(segment.x1), _round_coord(segment.y1)),
            (_round_coord(segment.x2), _round_coord(segment.y2)),
            dxfattribs={"layer": "CREASE", "linetype": "DASHED"},
        )

    label_size = float(_unit_constants(result.unit)["labelSize"])
    for mark in result.labels:
        main, sub = _label_lines(mark, result.unit)
        if not main:
            continue
        size = label_size * 0.62 if mark.small else label_size
        # TAB and H render as vertical text -- matches the frontend live
        # preview's own choice for these same two kinds. DXF TEXT's native
        # `rotation` attribute survives set_placement() untouched (verified
        # directly against ezdxf), so it's set once at construction.
        rotated = mark.kind in ("tab", "height")
        align = TextEntityAlignment.LEFT if mark.kind == "reference" else TextEntityAlignment.MIDDLE_CENTER
        main_dxfattribs = {"layer": "DIMENSION", "height": size}
        if rotated:
            main_dxfattribs["rotation"] = 90
        msp.add_text(main, dxfattribs=main_dxfattribs).set_placement(
            (_round_coord(mark.x), _round_coord(mark.y)), align=align
        )
        if sub:
            # For rotated marks the main label's own glyphs already run
            # vertically for several character-heights, so offsetting the
            # sub-line vertically (as unrotated marks do) lands it inside
            # that span, not below it. Offset horizontally instead -- after
            # rotation that reads as a second, parallel vertical column
            # beside the main label. Matches build_svg's identical fix.
            #
            # For unrotated marks: matches build_svg's sub-line offset
            # exactly (+size*0.9, not flipped) -- this codebase already
            # feeds the same Y-down data straight into DXF as SVG (no axis
            # flip anywhere else in this file), so a flip here would
            # misplace text relative to the cut/crease geometry it's meant
            # to sit beside.
            sub_x, sub_y = (mark.x + size * 0.9, mark.y) if rotated else (mark.x, mark.y + size * 0.9)
            sub_dxfattribs = {"layer": "DIMENSION", "height": size * 0.5}
            if rotated:
                sub_dxfattribs["rotation"] = 90
            msp.add_text(sub, dxfattribs=sub_dxfattribs).set_placement(
                (_round_coord(sub_x), _round_coord(sub_y)), align=align
            )

    buffer = io.StringIO()
    doc.write(buffer)
    return buffer.getvalue().encode("utf-8")
