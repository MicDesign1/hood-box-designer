from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

FefcoCode = Literal["0200", "0201", "0202", "0203", "0204", "0300", "0409", "0427", "0713", "hsc", "tube"]

IMPLEMENTED_FEFCO_CODES: set[str] = {"0200", "0201", "0202", "0203", "0713", "hsc", "tube"}

Units = Literal["in", "mm"]
FluteType = Literal["A", "B", "C", "E", "F", "BC", "EB"]


class BoxSpec(BaseModel):
    """Box specification. Dimensions default to decimal inches."""

    fefco_code: FefcoCode = Field(description="FEFCO style code.")
    length: float = Field(gt=0, description="Inside length.")
    width: float = Field(gt=0, description="Inside width.")
    height: float = Field(gt=0, description="Inside height / depth.")
    caliper: float = Field(gt=0, description="Board caliper (thickness).")
    units: Units = Field(default="in", description="Unit system for all dimensions.")
    glue_tab: float | None = Field(
        default=None,
        gt=0,
        description="Glue tab width. Defaults to ~1 in + caliper compensation.",
    )
    overlap: float | None = Field(
        default=None,
        ge=0,
        description="Extra overlap for overlap-style boxes (0202/0203).",
    )
    slot: float | None = Field(
        default=None,
        gt=0,
        description="Slot width between flaps. Defaults from caliper.",
    )
    fillet_radius: float | None = Field(
        default=None,
        ge=0,
        description="Slot-root fillet radius. Omit for an automatic radius based on caliper; 0 forces sharp corners.",
    )
    flute_type: FluteType | None = Field(
        default=None,
        description="Flute type for scoring allowances (0201) and caliper lookup.",
    )
    joint: Literal["taped", "glued"] | None = Field(
        default="glued",
        description="Manufacturer's joint for table-driven styles: glued (default tab) or taped (no tab).",
    )
    tab_width: float | None = Field(
        default=None,
        gt=0,
        description="Glue tab width for glued joints, inches (default 1.5).",
    )


class LabelMarkPayload(BaseModel):
    """A dimension callout position, in drawing units (unpadded)."""

    x: float
    y: float
    kind: Literal["panel", "tab", "flap", "glue"]
    value: float | None = None
    letter: str | None = None
    panel_index: int | None = None
    small: bool = False
    faint: bool = False


class CutLine(BaseModel):
    """A straight cut segment."""

    kind: Literal["line"] = "line"
    x1: float
    y1: float
    x2: float
    y2: float


class CutArc(BaseModel):
    """A quarter-circle slot-root fillet. Only what SVG rendering needs —
    the arc center and DXF sweep angles are a backend-only concern.
    """

    kind: Literal["arc"] = "arc"
    x1: float
    y1: float
    x2: float
    y2: float
    radius: float
    sweep_flag: Literal[0, 1]


CutElement = Annotated[Union[CutLine, CutArc], Field(discriminator="kind")]


class GeometryPayload(BaseModel):
    """Raw dieline geometry for the live preview to render natively.

    Distinct from `svg`, which is the physically-sized, print-ready file
    used for the SVG download button.
    """

    unit: Units
    total_w: float
    total_h: float
    cuts: list[CutElement]
    creases: list[tuple[float, float, float, float]]
    labels: list[LabelMarkPayload]


class DielineGenerateResponse(BaseModel):
    svg: str
    geometry: GeometryPayload | None = None
    fefco_code: str
    generated: bool
    message: str | None = None
    warnings: list[str] = Field(default_factory=list)
    derived: dict[str, Any] = Field(default_factory=dict)