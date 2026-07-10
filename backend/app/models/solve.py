"""Request/response models for the inverse dieline solver API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

SolveStyle = Literal["rsc", "hsc", "tube"]
SolveFlute = Literal["B", "C", "BC"]
SolveJoint = Literal["taped", "glued"]
SolveConfidence = Literal["high", "medium", "low", "ambiguous"]


class SolveRequest(BaseModel):
    """Flat-blank measurements — same fields as the `dieline solve` CLI."""

    flute: SolveFlute
    blank_w: float | None = Field(default=None, gt=0, description="Overall blank width in inches.")
    blank_h: float | None = Field(default=None, gt=0, description="Overall blank height in inches.")
    style: SolveStyle | None = Field(
        default=None,
        description="Blank style. Omit to try RSC, HSC, and tube and rank by fit.",
    )
    joint: SolveJoint = Field(default="glued", description="Manufacturer's joint.")
    scores_x: list[float] | None = Field(
        default=None,
        description="Vertical score positions from the left edge, inches.",
    )
    scores_y: list[float] | None = Field(
        default=None,
        description="Horizontal score positions from the bottom edge, inches.",
    )
    panels_x: list[float] | None = Field(
        default=None,
        description="Individual panel widths along the blank width, inches.",
    )
    flap_h: float | None = Field(
        default=None,
        gt=0,
        description="Distance from blank bottom to first horizontal crease (RSC/HSC).",
    )
    panel_1: float | None = Field(
        default=None,
        gt=0,
        description="First WCC panel width, crease-to-crease from the non-tab end.",
    )
    panel_2: float | None = Field(
        default=None,
        gt=0,
        description="Second WCC panel width, crease-to-crease.",
    )
    panel_d: float | None = Field(
        default=None,
        gt=0,
        description="Middle ACC depth panel, crease-to-crease (RSC/HSC only).",
    )
    blank_w_excludes_tab: bool = Field(
        default=False,
        description="When joint=glued: blank_w omits the glue tab (body width only).",
    )
    tab_width: float = Field(
        default=1.5,
        gt=0,
        description="Glue tab width in inches for glued joints (default 1.5).",
    )


class SolveResponse(BaseModel):
    """Solver output — mirrors `dieline solve` JSON."""

    style: SolveStyle
    flute: str
    joint: SolveJoint
    joint_label: str
    tab_width: float
    L: float
    W: float
    D: float
    outside_L: float | None = None
    outside_W: float | None = None
    outside_D: float | None = None
    predicted_blank_w: float
    predicted_blank_h: float
    predicted_scores_x: list[float]
    predicted_scores_y: list[float]
    rms_error_in: float
    confidence: SolveConfidence
    rotated: bool
    reason: str | None = None
    suggested_input: str | None = None
    warning: str | None = None
    runner_up: dict[str, Any] | None = None
