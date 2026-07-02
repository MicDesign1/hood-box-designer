from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import ezdxf
import svgwrite

from app.models.box_spec import IMPLEMENTED_FEFCO_CODES, BoxSpec

if TYPE_CHECKING:
    from ezdxf.document import Drawing as DxfDrawing

UNITS: dict[str, dict[str, float | str]] = {
    "in": {
        "label": "in",
        "slotMin": 0.25,
        "folClear": 0.125,
        "chamferMax": 0.5,
        "hookMax": 0.5,
        "filletMin": 0.125,
    },
    "mm": {
        "label": "mm",
        "slotMin": 6.0,
        "folClear": 3.0,
        "chamferMax": 12.0,
        "hookMax": 12.0,
        "filletMin": 3.2,
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
    frontend so the same mark data can back both the preview and any future
    export annotations.
    """

    x: float
    y: float
    kind: str  # "panel" | "tab" | "flap" | "glue"
    value: float | None = None
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


def build_dieline(spec: BoxSpec | dict[str, Any]) -> DielineResult:
    """Faithful Python port of the reference buildDieline (sharp slot corners)."""
    if isinstance(spec, BoxSpec):
        payload = spec.model_dump()
    else:
        payload = spec

    unit = payload.get("units", "in")
    unit_values = _unit_constants(unit)
    fefco_code = payload.get("fefco_code", "0201")

    length = parse_dim(payload.get("length"))
    width = parse_dim(payload.get("width"))
    height = parse_dim(payload.get("height"))
    caliper = parse_dim(payload.get("caliper"))
    glue_tab = parse_dim(payload.get("glue_tab"))
    overlap = parse_dim(payload.get("overlap"))
    slot_in = parse_dim(payload.get("slot"))

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

    if warnings:
        return DielineResult(ok=False, warnings=warnings, unit=unit)

    fillet_radius_raw = payload.get("fillet_radius")
    if fillet_radius_raw is None:
        fillet_radius_cfg = max(0.75 * caliper, float(unit_values["filletMin"]))
    else:
        parsed_fillet = parse_dim(fillet_radius_raw)
        fillet_radius_cfg = parsed_fillet if math.isfinite(parsed_fillet) and parsed_fillet >= 0 else 0.0

    panel_length = length + caliper
    panel_width = width + caliper
    body_height = height + caliper
    is_crash_lock = fefco_code == "0713"

    flap_top: float
    flap_bottom: float
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

    panels = [panel_length, panel_width, panel_length, panel_width]
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

    # Bottom edge + slot notches, root corners filleted (mirror of the top loop).
    if not is_crash_lock and flap_bottom > 0:
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
    elif not is_crash_lock:
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
    # placement (panel centers, glue tab, flap depth).
    labels: list[LabelMark] = []
    mid_y = y_top + body_height / 2
    names = ["L", "W", "L", "W"]
    panel_dims = [panel_length, panel_width, panel_length, panel_width]
    for index in range(4):
        center_x = (x_boundaries[index] + x_boundaries[index + 1]) / 2
        labels.append(
            LabelMark(
                x=center_x,
                y=mid_y,
                kind="panel",
                value=panel_dims[index],
                letter=names[index],
                panel_index=index + 1,
            )
        )
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
        flap_left = x_boundaries[0]
        flap_right = x_boundaries[1]
        labels.append(
            LabelMark(
                x=(flap_left + flap_right) / 2,
                y=y_bottom + major_depth / 2,
                kind="flap",
                value=major_depth,
                small=True,
            )
        )
        labels.append(
            LabelMark(
                x=flap_left + major_depth * 0.32,
                y=y_bottom + major_depth * 0.72,
                kind="glue",
                small=True,
                faint=True,
            )
        )

    derived = {
        "panel_L": panel_length,
        "panel_W": panel_width,
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


def build_svg(result: DielineResult) -> str:
    """Layered SVG (cuts + creases only) with physical inch sizing and margin padding."""
    padded = _shift_geometry(result, SVG_PAD_LEFT, SVG_PAD)
    view_w = padded.total_w + SVG_PAD
    view_h = padded.total_h + SVG_PAD
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

    return drawing.tostring()


def _coming_soon_svg(spec: BoxSpec) -> str:
    drawing = svgwrite.Drawing(size=("320px", "120px"), viewBox="0 0 320 120", profile="full")
    drawing.add(drawing.rect(insert=(0, 0), size=("100%", "100%"), fill="#fafafa"))
    drawing.add(
        drawing.text(
            f"FEFCO {spec.fefco_code}",
            insert=("160", "52"),
            text_anchor="middle",
            fill="#525252",
            font_family="Arial, sans-serif",
            font_size="14px",
        )
    )
    drawing.add(
        drawing.text(
            "Dieline preview coming soon",
            insert=("160", "78"),
            text_anchor="middle",
            fill="#737373",
            font_family="Arial, sans-serif",
            font_size="12px",
        )
    )
    return drawing.tostring()


def generate_dieline_svg(
    spec: BoxSpec,
) -> tuple[str, bool, str | None, list[str], dict[str, Any], DielineResult | None]:
    """Returns (svg, generated, message, warnings, derived, geometry).

    `geometry` is the un-padded DielineResult used to drive the live preview;
    it is None when the style isn't implemented or the inputs don't resolve.
    """
    if spec.fefco_code not in IMPLEMENTED_FEFCO_CODES:
        return (
            _coming_soon_svg(spec),
            False,
            f"FEFCO {spec.fefco_code} is not implemented yet.",
            [],
            {},
            None,
        )

    result = build_dieline(spec)
    if not result.ok or not result.cuts:
        return (
            _coming_soon_svg(spec),
            False,
            "Unable to generate dieline from the provided dimensions.",
            result.warnings,
            result.derived,
            None,
        )

    return (
        build_svg(result),
        True,
        None,
        result.warnings,
        result.derived,
        result,
    )


def _configure_dxf_units(doc: DxfDrawing, unit: str) -> None:
    """Declare drawing units for CAD importers (ArtiosCAD, etc.)."""
    doc.header["$MEASUREMENT"] = 0 if unit == "in" else 1
    doc.header["$INSUNITS"] = 1 if unit == "in" else 4


def build_dxf(result: DielineResult) -> bytes:
    """Port of reference buildDXF — simple LINE entities, no display padding."""
    doc: DxfDrawing = ezdxf.new("R2010")
    _configure_dxf_units(doc, result.unit)
    doc.layers.add("CUT", color=1)
    doc.layers.add("CREASE", color=3)
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

    buffer = io.StringIO()
    doc.write(buffer)
    return buffer.getvalue().encode("utf-8")


def generate_dieline_dxf(spec: BoxSpec) -> tuple[bytes | None, str | None]:
    if spec.fefco_code not in IMPLEMENTED_FEFCO_CODES:
        return None, f"DXF export is not available for FEFCO {spec.fefco_code} yet."

    result = build_dieline(spec)
    if not result.ok or not result.cuts:
        return None, "Unable to build DXF geometry."

    return build_dxf(result), None