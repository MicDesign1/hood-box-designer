"""Capture-record annotations — the narrow backend slice of the shared
capture core (see frontend/src/types/capture.ts for the full session shape).

The backend never needs the full CaptureSession: no provisional/unlocked
markers, no placement history, no dimension/panel role bookkeeping — those
stay frontend-only and are already fully resolved (into BoxSpec fields or
SolveRequest panel measurements) before anything reaches this API. The one
thing the backend does need, that it has no home for today, is the set of
reference dimensions a user called out (requirement B) so they can be drawn
onto the dieline's measurement/annotation layer.

Not wired into any route yet — introduced in Phase 0 as a type only, per the
"no behavior change" gate. Nothing constructs or consumes this model until a
later phase's output work explicitly does so.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CaptureRole(BaseModel):
    """Mirrors frontend/src/types/capture.ts's CaptureRole discriminated
    union. Only ever constructed with `kind == "reference"` on this side —
    dimension/panel roles are resolved into BoxSpec/SolveRequest fields
    before the backend ever sees them, so they have no reason to cross this
    boundary. The wider shape is kept here anyway so this model can be
    extended without a breaking change if that assumption ever needs to
    change.
    """

    kind: Literal["dimension", "panel", "reference"]
    axis: Literal["length", "width", "height"] | None = None
    panel_field: (
        Literal["panel1", "panel2", "panelD", "blankWidth", "blankHeight", "flapHeight"] | None
    ) = None
    label: str | None = None


class ReferenceDimension(BaseModel):
    """A user-called-out measurement (hole, cutout, special score, etc.).
    Annotation only — never enters geometry, allowance, or solver math. No
    code in dieline_core may read this model.
    """

    label: str
    raw_inches: float = Field(gt=0)


class CaptureAnnotations(BaseModel):
    """Additive payload carried alongside a BoxSpec/generate request. Not a
    replacement for BoxSpec — it has no length/width/height/caliper fields
    at all, so there is nothing here for geometry code to accidentally read.
    """

    reference_dimensions: list[ReferenceDimension] = Field(default_factory=list)
