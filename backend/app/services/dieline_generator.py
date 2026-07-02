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
    },
    "mm": {
        "label": "mm",
        "slotMin": 6.0,
        "folClear": 3.0,
        "chamferMax": 12.0,
        "hookMax": 12.0,
    },
}

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
.dieline-label-text {{
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 600;
  fill: #1f2937;
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
    cuts: list[LineSegment] = field(default_factory=list)
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

    cuts: list[LineSegment] = []
    creases: list[LineSegment] = []

    # Top edge + sharp slot notches
    if flap_top > 0:
        cursor_x = x0
        for index in range(1, 4):
            boundary = x_boundaries[index]
            _seg(cuts, cursor_x, 0.0, boundary - half_slot, 0.0)
            _seg(cuts, boundary - half_slot, 0.0, boundary - half_slot, y_top)
            _seg(cuts, boundary - half_slot, y_top, boundary + half_slot, y_top)
            _seg(cuts, boundary + half_slot, y_top, boundary + half_slot, 0.0)
            cursor_x = boundary + half_slot
        _seg(cuts, cursor_x, 0.0, x_right, 0.0)
    else:
        _seg(cuts, x0, 0.0, x_right, 0.0)

    # Right edge
    _seg(cuts, x_right, 0.0, x_right, y_bottom if is_crash_lock else total_h)

    # Bottom edge + sharp slot notches
    if not is_crash_lock and flap_bottom > 0:
        cursor_x = x_right
        for index in range(3, 0, -1):
            boundary = x_boundaries[index]
            _seg(cuts, cursor_x, total_h, boundary + half_slot, total_h)
            _seg(cuts, boundary + half_slot, total_h, boundary + half_slot, y_bottom)
            _seg(cuts, boundary + half_slot, y_bottom, boundary - half_slot, y_bottom)
            _seg(cuts, boundary - half_slot, y_bottom, boundary - half_slot, total_h)
            cursor_x = boundary - half_slot
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


def _format_dim_label(value: float, unit: str) -> str:
    if unit == "mm":
        return f"{value:.1f} mm"
    rounded = round(value, 3)
    text = f"{rounded:.3f}".rstrip("0").rstrip(".")
    return f'{text}"'


def _add_dimension_label(
    drawing: svgwrite.Drawing,
    group: svgwrite.container.Group,
    x: float,
    y: float,
    lines: list[str],
    *,
    font_size: float = 0.26,
) -> None:
    line_height = font_size * 1.25
    max_len = max(len(line) for line in lines)
    box_w = max(font_size * 1.35, max_len * font_size * 0.58)
    box_h = len(lines) * line_height + font_size * 0.35
    box_x = x - box_w / 2
    box_y = y - box_h / 2

    label = group.add(drawing.g(class_="dieline-label"))
    label.add(
        drawing.rect(
            insert=(box_x, box_y),
            size=(box_w, box_h),
            rx=font_size * 0.15,
            ry=font_size * 0.15,
            fill="#ffffff",
            fill_opacity=0.92,
            stroke="#d1d5db",
            stroke_width=STROKE_WIDTH_IN * 0.6,
        )
    )

    text_el = label.add(
        drawing.text(
            "",
            insert=(x, box_y + font_size * 0.95),
            text_anchor="middle",
            class_="dieline-label-text",
        )
    )
    for index, line in enumerate(lines):
        tspan = drawing.tspan(line)
        tspan.attribs["font-size"] = str(font_size)
        tspan.attribs["x"] = str(x)
        if index > 0:
            tspan.attribs["dy"] = str(line_height)
        text_el.add(tspan)


def _build_dimension_labels(
    drawing: svgwrite.Drawing,
    group: svgwrite.container.Group,
    padded: DielineResult,
) -> None:
    """Render the padded result's label marks (already shifted into SVG space)."""
    unit = padded.unit
    for mark in padded.labels:
        if mark.kind == "panel":
            _add_dimension_label(
                drawing,
                group,
                mark.x,
                mark.y,
                [mark.letter or "", _format_dim_label(mark.value or 0.0, unit)],
                font_size=0.5,
            )
        elif mark.kind == "tab":
            _add_dimension_label(
                drawing,
                group,
                mark.x,
                mark.y,
                ["TAB", _format_dim_label(mark.value or 0.0, unit)],
                font_size=0.35,
            )
        elif mark.kind == "flap":
            _add_dimension_label(
                drawing,
                group,
                mark.x,
                mark.y,
                [_format_dim_label(mark.value or 0.0, unit)],
                font_size=0.32,
            )
        elif mark.kind == "glue":
            _add_dimension_label(drawing, group, mark.x, mark.y, ["GLUE"], font_size=0.28)


def _shift_geometry(result: DielineResult, dx: float, dy: float) -> DielineResult:
    def shift(segment: LineSegment) -> LineSegment:
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
    """Layered SVG with physical inch sizing, labels, and margin padding."""
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
    drawing.add(
        drawing.rect(
            insert=(0, 0),
            size=(view_w, view_h),
            fill="#fafafa",
        )
    )

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
        cut_group.add(
            drawing.line(
                start=(segment.x1, segment.y1),
                end=(segment.x2, segment.y2),
                class_="dieline-cut",
            )
        )
    drawing.add(cut_group)

    label_group = drawing.g(id="dimension-labels")
    _build_dimension_labels(drawing, label_group, padded)
    drawing.add(label_group)

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