"""FastAPI-facing wrapper around `dieline_core.solver`."""

from __future__ import annotations

from app.models.solve import SolveRequest, SolveResponse
from dieline_core.solver import Measurements, solve_measurements, validate_measurements


def solve_from_request(request: SolveRequest) -> SolveResponse:
    measurements = Measurements(
        blank_w=request.blank_w,
        blank_h=request.blank_h,
        scores_x=tuple(request.scores_x) if request.scores_x else None,
        scores_y=tuple(request.scores_y) if request.scores_y else None,
        panels_x=tuple(request.panels_x) if request.panels_x else None,
        flap_h=request.flap_h,
        panel_1=request.panel_1,
        panel_2=request.panel_2,
        panel_d=request.panel_d,
        blank_w_excludes_tab=request.blank_w_excludes_tab,
    )

    input_error = validate_measurements(request.style, measurements)
    if input_error is not None:
        raise ValueError(input_error)

    result = solve_measurements(
        measurements,
        flute=request.flute,
        joint=request.joint,
        style=request.style,
        tab_width=request.tab_width,
    )
    if result is None:
        raise ValueError("could not solve — no valid candidate for the given measurements.")

    payload = result.to_dict()
    return SolveResponse(**payload)
