"""Flute -> board caliper (thickness) lookup.

Caliper values from skills/dieline/references/scoring-allowances.md
(Quick-Reference: Flute caliper). Used for slot/fillet geometry; 0201 panel
scoring allowances come from `dieline_core/scoring.py`, not from caliper.
"""

from __future__ import annotations

# Nominal caliper in inches (Quick-Reference table).
FLUTE_CALIPER_IN: dict[str, float] = {
    "A": 0.2188,
    "B": 0.1250,
    "C": 0.1563,
    "E": 0.0781,
    "BC": 0.2813,
}

FLUTE_CALIPER_MM: dict[str, float] = {
    flute: round(inches * 25.4, 4) for flute, inches in FLUTE_CALIPER_IN.items()
}

SUPPORTED_FLUTES = tuple(FLUTE_CALIPER_IN.keys())


def caliper_for_flute(flute: str, units: str) -> float:
    """Returns the nominal caliper for `flute` in the given unit system.

    Raises KeyError if `flute` isn't in SUPPORTED_FLUTES — callers should
    validate against SUPPORTED_FLUTES first to produce a clean user-facing
    error instead of a traceback.
    """
    table = FLUTE_CALIPER_IN if units == "in" else FLUTE_CALIPER_MM
    return table[flute]
