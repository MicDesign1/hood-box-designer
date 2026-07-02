from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

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
        "round": 3.0,
    },
    "mm": {
        "label": "mm",
        "slotMin": 6.0,
        "folClear": 3.0,
        "chamferMax": 12.0,
        "hookMax": 12.0,
        "round": 1.0,
    },
}

HAIRLINE_CSS = """
.dieline-cut {
  fill: none;
  stroke: #dc2626;
  stroke-width: 0.75;
  vector-effect: non-scaling-stroke;
  shape-rendering: geometricPrecision;
}
.dieline-crease {
  fill: none;
  stroke: #16a34a;
  stroke-width: 0.75;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 4 3;
  shape-rendering: geometricPrecision;
}
"""

SVG_PAD = 0.125
COORD_PRECISION = 8


@dataclass
class LineSegment:
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass
class ArcSegment:
    x1: float
    y1: float
    x2: float
    y2: float
    cx: float
    cy: float
    r: float
    bulge: float
    sweep: int = 1


@dataclass
class DielineResult:
    ok: bool = False
    warnings: list[str] = field(default_factory=list)
    cuts: list[LineSegment | ArcSegment] = field(default_factory=list)
    creases: list[LineSegment] = field(default_factory=list)
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


def _fillet_radius(unit: str, caliper: float, slot: float) -> float:
    unit_values = _unit_constants(unit)
    base = float(unit_values["round"])
    if unit == "mm":
        radius = base
    else:
        radius = base / 64.0
    return min(slot / 4.0, max(radius, caliper * 2.0))


def _add_line(
    cuts: list[LineSegment | ArcSegment],
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> None:
    if math.isclose(x1, x2, abs_tol=1e-9) and math.isclose(y1, y2, abs_tol=1e-9):
        return
    cuts.append(LineSegment(x1, y1, x2, y2))


def _round_coord(value: float) -> float:
    return round(value, COORD_PRECISION)


def _arc_bulge(x1: float, y1: float, x2: float, y2: float, cx: float, cy: float) -> float:
    start_angle = math.atan2(y1 - cy, x1 - cx)
    end_angle = math.atan2(y2 - cy, x2 - cx)
    angle = end_angle - start_angle
    while angle <= -math.pi:
        angle += 2 * math.pi
    while angle > math.pi:
        angle -= 2 * math.pi
    return math.tan(angle / 4.0)


def _add_fillet(
    cuts: list[LineSegment | ArcSegment],
    corner_x: float,
    corner_y: float,
    from_x: float,
    from_y: float,
    to_x: float,
    to_y: float,
    radius: float,
) -> tuple[float, float]:
    """Connect from point -> filleted corner -> toward to point. Returns arc end."""
    if radius <= 0:
        _add_line(cuts, from_x, from_y, corner_x, corner_y)
        return corner_x, corner_y

    v1x, v1y = corner_x - from_x, corner_y - from_y
    v2x, v2y = to_x - corner_x, to_y - corner_y
    len1 = math.hypot(v1x, v1y)
    len2 = math.hypot(v2x, v2y)
    if len1 == 0 or len2 == 0:
        _add_line(cuts, from_x, from_y, corner_x, corner_y)
        return corner_x, corner_y

    v1x, v1y = v1x / len1, v1y / len1
    v2x, v2y = v2x / len2, v2y / len2
    trim = min(radius, len1 * 0.45, len2 * 0.45)

    start_x = _round_coord(corner_x - v1x * trim)
    start_y = _round_coord(corner_y - v1y * trim)
    end_x = _round_coord(corner_x + v2x * trim)
    end_y = _round_coord(corner_y + v2y * trim)

    theta = math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)
    half_angle = theta / 2.0
    sin_half = math.sin(abs(half_angle))
    if sin_half < 1e-9:
        _add_line(cuts, from_x, from_y, start_x, start_y)
        _add_line(cuts, start_x, start_y, end_x, end_y)
        return end_x, end_y

    bis_x = -v1x + v2x
    bis_y = -v1y + v2y
    bis_len = math.hypot(bis_x, bis_y)
    bis_x, bis_y = bis_x / bis_len, bis_y / bis_len
    center_dist = trim / sin_half
    center_x = _round_coord(corner_x + bis_x * center_dist)
    center_y = _round_coord(corner_y + bis_y * center_dist)
    arc_radius = math.hypot(start_x - center_x, start_y - center_y)
    bulge = _arc_bulge(start_x, start_y, end_x, end_y, center_x, center_y)

    _add_line(cuts, from_x, from_y, start_x, start_y)
    cuts.append(
        ArcSegment(
            x1=start_x,
            y1=start_y,
            x2=end_x,
            y2=end_y,
            cx=center_x,
            cy=center_y,
            r=_round_coord(arc_radius),
            bulge=_round_coord(bulge),
            sweep=1 if bulge > 0 else 0,
        )
    )
    return end_x, end_y


def _slot_top(
    cuts: list[LineSegment | ArcSegment],
    x: float,
    boundary: float,
    slot: float,
    y_t: float,
    radius: float,
) -> float:
    """Top-edge slot notch with filleted corners. Returns next x."""
    half = slot / 2
    left = boundary - half
    right = boundary + half

    end_x, end_y = _add_fillet(cuts, left, 0.0, x, 0.0, left, y_t, radius)
    end_x, end_y = _add_fillet(cuts, left, y_t, end_x, end_y, right, y_t, radius)
    end_x, end_y = _add_fillet(cuts, right, y_t, end_x, end_y, right, 0.0, radius)
    _add_line(cuts, end_x, end_y, right, 0.0)
    return right


def _slot_bottom(
    cuts: list[LineSegment | ArcSegment],
    x: float,
    boundary: float,
    slot: float,
    y_b: float,
    total_h: float,
    radius: float,
) -> float:
    """Bottom-edge slot notch with filleted corners. Returns next x."""
    half = slot / 2
    left = boundary - half
    right = boundary + half

    end_x, end_y = _add_fillet(cuts, right, total_h, x, total_h, right, y_b, radius)
    end_x, end_y = _add_fillet(cuts, right, y_b, end_x, end_y, left, y_b, radius)
    end_x, end_y = _add_fillet(cuts, left, y_b, end_x, end_y, left, total_h, radius)
    _add_line(cuts, end_x, end_y, left, total_h)
    return left


def build_dieline(spec: BoxSpec | dict[str, Any]) -> DielineResult:
    """Faithful Python port of the reference buildDieline geometry engine."""
    if isinstance(spec, BoxSpec):
        payload = spec.model_dump()
    else:
        payload = spec

    unit = payload.get("units", "in")
    unit_values = _unit_constants(unit)

    length = parse_dim(payload.get("length"))
    width = parse_dim(payload.get("width"))
    height = parse_dim(payload.get("height"))
    caliper = parse_dim(payload.get("caliper"))
    glue_tab = parse_dim(payload.get("glue_tab"))
    overlap = parse_dim(payload.get("overlap"))
    slot_in = parse_dim(payload.get("slot"))
    fefco_code = payload.get("fefco_code", "0201")

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
    _minor_depth = panel_width / 2 - float(unit_values["folClear"])
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
    fillet_r = _fillet_radius(unit, caliper, slot)

    cuts: list[LineSegment | ArcSegment] = []
    creases: list[LineSegment] = []

    # Top edge + slots
    if flap_top > 0:
        cursor_x = x0
        for index in range(1, 4):
            cursor_x = _slot_top(cuts, cursor_x, x_boundaries[index], slot, y_top, fillet_r)
        _add_line(cuts, cursor_x, 0.0, x_right, 0.0)
    else:
        _add_line(cuts, x0, 0.0, x_right, 0.0)

    # Right edge
    _add_line(cuts, x_right, 0.0, x_right, y_bottom if is_crash_lock else total_h)

    # Bottom edge + slots
    if not is_crash_lock and flap_bottom > 0:
        cursor_x = x_right
        for index in range(3, 0, -1):
            cursor_x = _slot_bottom(
                cuts, cursor_x, x_boundaries[index], slot, y_bottom, total_h, fillet_r
            )
        _add_line(cuts, cursor_x, total_h, x0, total_h)
    elif not is_crash_lock:
        _add_line(cuts, x_right, total_h, x0, total_h)

    # Left edge + chamfer on glue tab
    _add_line(cuts, x0, y_bottom if is_crash_lock else total_h, x0, y_bottom)
    _add_line(cuts, x0, y_bottom, 0.0, y_bottom - chamfer)
    _add_line(cuts, 0.0, y_bottom - chamfer, 0.0, y_top + chamfer)
    _add_line(cuts, 0.0, y_top + chamfer, x0, y_top)

    # Creases
    creases.append(LineSegment(x0, y_top, x0, y_bottom))
    for index in range(1, 4):
        creases.append(LineSegment(x_boundaries[index], y_top, x_boundaries[index], y_bottom))

    for index in range(4):
        left = x_boundaries[index] + (0.0 if index == 0 else slot / 2)
        right = x_boundaries[index + 1] - (0.0 if index == 3 else slot / 2)
        if flap_top > 0:
            creases.append(LineSegment(left, y_top, right, y_top))
        if not is_crash_lock and flap_bottom > 0:
            creases.append(LineSegment(left, y_bottom, right, y_bottom))

    derived = {
        "panel_L": panel_length,
        "panel_W": panel_width,
        "depth_score": body_height,
        "flap_top": flap_top,
        "flap_bottom": flap_bottom,
        "major_flap_depth": major_depth,
        "minor_flap_depth": _minor_depth,
        "slot_width": slot,
        "slot_fillet_radius": fillet_r,
        "glue_tab": glue,
        "blank_w": x_right,
        "blank_h": total_h,
        "overlap": overlap_val,
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
        total_w=x_right,
        total_h=total_h,
        unit=unit,
        derived=derived,
    )


def _shift_geometry(result: DielineResult, dx: float, dy: float) -> DielineResult:
    def shift_line(line: LineSegment) -> LineSegment:
        return LineSegment(line.x1 + dx, line.y1 + dy, line.x2 + dx, line.y2 + dy)

    def shift_arc(arc: ArcSegment) -> ArcSegment:
        return ArcSegment(
            cx=arc.cx + dx,
            cy=arc.cy + dy,
            r=arc.r,
            x1=arc.x1 + dx,
            y1=arc.y1 + dy,
            x2=arc.x2 + dx,
            y2=arc.y2 + dy,
            sweep=arc.sweep,
        )

    shifted_cuts: list[LineSegment | ArcSegment] = []
    for primitive in result.cuts:
        if isinstance(primitive, LineSegment):
            shifted_cuts.append(shift_line(primitive))
        else:
            shifted_cuts.append(shift_arc(primitive))

    return DielineResult(
        ok=result.ok,
        warnings=result.warnings,
        cuts=shifted_cuts,
        creases=[shift_line(line) for line in result.creases],
        total_w=result.total_w + dx,
        total_h=result.total_h + dy,
        unit=result.unit,
        derived=result.derived,
    )


def _geometry_to_svg(result: DielineResult) -> str:
    padded = _shift_geometry(result, SVG_PAD, SVG_PAD)
    view_w = padded.total_w + SVG_PAD
    view_h = padded.total_h + SVG_PAD

    drawing = svgwrite.Drawing(
        size=("100%", "100%"),
        viewBox=f"0 0 {view_w} {view_h}",
        profile="full",
    )
    defs = drawing.defs
    defs.add(drawing.style(HAIRLINE_CSS))
    drawing.add(drawing.rect(insert=(0, 0), size=("100%", "100%"), fill="#fafafa"))

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
    for primitive in padded.cuts:
        if isinstance(primitive, LineSegment):
            cut_group.add(
                drawing.line(
                    start=(primitive.x1, primitive.y1),
                    end=(primitive.x2, primitive.y2),
                    class_="dieline-cut",
                )
            )
        else:
            start_angle = math.atan2(primitive.y1 - primitive.cy, primitive.x1 - primitive.cx)
            end_angle = math.atan2(primitive.y2 - primitive.cy, primitive.x2 - primitive.cx)
            angle = end_angle - start_angle
            while angle <= -math.pi:
                angle += 2 * math.pi
            while angle > math.pi:
                angle -= 2 * math.pi
            large_arc = 1 if abs(angle) > math.pi else 0
            sweep = 1 if angle > 0 else 0
            path_data = (
                f"M {primitive.x1} {primitive.y1} "
                f"A {primitive.r} {primitive.r} 0 {large_arc} {sweep} "
                f"{primitive.x2} {primitive.y2}"
            )
            cut_group.add(drawing.path(d=path_data, class_="dieline-cut"))
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


def generate_dieline_svg(spec: BoxSpec) -> tuple[str, bool, str | None, list[str], dict[str, Any]]:
    if spec.fefco_code not in IMPLEMENTED_FEFCO_CODES:
        return (
            _coming_soon_svg(spec),
            False,
            f"FEFCO {spec.fefco_code} is not implemented yet.",
            [],
            {},
        )

    result = build_dieline(spec)
    if not result.ok or not result.cuts:
        return (
            _coming_soon_svg(spec),
            False,
            "Unable to generate dieline from the provided dimensions.",
            result.warnings,
            result.derived,
        )

    return (
        _geometry_to_svg(result),
        True,
        None,
        result.warnings,
        result.derived,
    )


def _points_close(x1: float, y1: float, x2: float, y2: float, tol: float = 1e-6) -> bool:
    return math.isclose(x1, x2, abs_tol=tol) and math.isclose(y1, y2, abs_tol=tol)


def _chain_cut_paths(
    cuts: list[LineSegment | ArcSegment],
) -> list[list[LineSegment | ArcSegment]]:
    """Group ordered cut primitives into connected paths for LWPolyline export."""
    if not cuts:
        return []

    paths: list[list[LineSegment | ArcSegment]] = [[cuts[0]]]
    current_end = (cuts[0].x2, cuts[0].y2) if isinstance(cuts[0], LineSegment) else (cuts[0].x2, cuts[0].y2)

    for primitive in cuts[1:]:
        start = (primitive.x1, primitive.y1)
        if _points_close(current_end[0], current_end[1], start[0], start[1]):
            paths[-1].append(primitive)
        else:
            paths.append([primitive])
        current_end = (primitive.x2, primitive.y2)

    return paths


def _export_cut_lwpolyline(
    msp,
    path: list[LineSegment | ArcSegment],
    layer: str,
) -> None:
    """Export a connected cut path as a single LWPolyline with bulge fillets."""
    if not path:
        return

    first = path[0]
    points: list[tuple[float, float, float, float, float]] = [
        (_round_coord(first.x1), _round_coord(first.y1), 0.0, 0.0, 0.0)
    ]

    for primitive in path:
        if isinstance(primitive, LineSegment):
            points.append(
                (
                    _round_coord(primitive.x2),
                    _round_coord(primitive.y2),
                    0.0,
                    0.0,
                    0.0,
                )
            )
        else:
            points[-1] = (
                points[-1][0],
                points[-1][1],
                0.0,
                0.0,
                _round_coord(primitive.bulge),
            )
            points.append(
                (
                    _round_coord(primitive.x2),
                    _round_coord(primitive.y2),
                    0.0,
                    0.0,
                    0.0,
                )
            )

    msp.add_lwpolyline(
        points,
        format="xyseb",
        dxfattribs={"layer": layer, "closed": False},
    )


def _configure_dxf_units(doc: DxfDrawing, unit: str) -> None:
    """Declare drawing units for CAD importers (ArtiosCAD, etc.)."""
    doc.header["$MEASUREMENT"] = 0 if unit == "in" else 1
    doc.header["$INSUNITS"] = 1 if unit == "in" else 4


def generate_dieline_dxf(spec: BoxSpec) -> tuple[bytes | None, str | None]:
    if spec.fefco_code not in IMPLEMENTED_FEFCO_CODES:
        return None, f"DXF export is not available for FEFCO {spec.fefco_code} yet."

    result = build_dieline(spec)
    if not result.ok or not result.cuts:
        return None, "Unable to build DXF geometry."

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

    for path in _chain_cut_paths(result.cuts):
        _export_cut_lwpolyline(msp, path, "CUT")

    for segment in result.creases:
        msp.add_line(
            (
                _round_coord(segment.x1),
                _round_coord(segment.y1),
            ),
            (
                _round_coord(segment.x2),
                _round_coord(segment.y2),
            ),
            dxfattribs={"layer": "CREASE", "linetype": "DASHED"},
        )

    buffer = io.StringIO()
    doc.write(buffer)
    return buffer.getvalue().encode("utf-8"), None