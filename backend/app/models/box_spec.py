from typing import Any, Literal

from pydantic import BaseModel, Field

FefcoCode = Literal["0200", "0201", "0202", "0203", "0204", "0300", "0409", "0427", "0713"]

IMPLEMENTED_FEFCO_CODES: set[str] = {"0200", "0201", "0202", "0203", "0713"}

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
    flute_type: FluteType | None = Field(
        default=None,
        description="Optional flute hint for allowances and warnings.",
    )


class DielineGenerateResponse(BaseModel):
    svg: str
    fefco_code: str
    generated: bool
    message: str | None = None
    warnings: list[str] = Field(default_factory=list)
    derived: dict[str, Any] = Field(default_factory=dict)