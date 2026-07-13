"""FastAPI-facing dieline service.

Thin wrapper around `dieline_core` (the shared, FastAPI-free geometry
engine — see `backend/dieline_core/geometry.py`). This module owns only the
API-specific concerns: accepting a pydantic `BoxSpec`, the "coming soon"
placeholder for FEFCO codes without geometry support, and shaping return
values the way `app/routers/dieline.py` expects. All geometry math lives in
`dieline_core` and must not be duplicated here.
"""

from __future__ import annotations

from typing import Any

import svgwrite

from app.models.box_spec import IMPLEMENTED_FEFCO_CODES, BoxSpec
from app.models.capture import ReferenceDimension
from dieline_core.geometry import ArcSegment, DielineResult, append_reference_legend, build_dieline, build_dxf, build_svg

__all__ = ["ArcSegment", "DielineResult", "generate_dieline_svg", "generate_dieline_dxf"]


def _as_plain_tuples(reference_dimensions: list[ReferenceDimension] | None) -> list[tuple[str, float]]:
    """Converts the pydantic ReferenceDimension model to the plain tuples
    dieline_core.geometry.append_reference_legend expects -- dieline_core has
    no pydantic dependency (see its module docstring), so that conversion
    happens here, at the FastAPI-facing boundary, not inside dieline_core."""
    if not reference_dimensions:
        return []
    return [(ref.label, ref.raw_inches) for ref in reference_dimensions]


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
    reference_dimensions: list[ReferenceDimension] | None = None,
) -> tuple[str, bool, str | None, list[str], dict[str, Any], DielineResult | None]:
    """Returns (svg, generated, message, warnings, derived, geometry).

    `geometry` is the un-padded DielineResult used to drive the live preview;
    it is None when the style isn't implemented or the inputs don't resolve.
    `reference_dimensions` is annotation-only (requirement B's legend) --
    purely additive to `labels`, never read by build_dieline's own geometry
    math.
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

    result = build_dieline(spec.model_dump())
    if not result.ok or not result.cuts:
        return (
            _coming_soon_svg(spec),
            False,
            "Unable to generate dieline from the provided dimensions.",
            result.warnings,
            result.derived,
            None,
        )

    result = append_reference_legend(result, _as_plain_tuples(reference_dimensions))

    return (
        build_svg(result),
        True,
        None,
        result.warnings,
        result.derived,
        result,
    )


def generate_dieline_dxf(
    spec: BoxSpec,
    reference_dimensions: list[ReferenceDimension] | None = None,
) -> tuple[bytes | None, str | None]:
    if spec.fefco_code not in IMPLEMENTED_FEFCO_CODES:
        return None, f"DXF export is not available for FEFCO {spec.fefco_code} yet."

    result = build_dieline(spec.model_dump())
    if not result.ok or not result.cuts:
        return None, "Unable to build DXF geometry."

    result = append_reference_legend(result, _as_plain_tuples(reference_dimensions))

    return build_dxf(result), None
