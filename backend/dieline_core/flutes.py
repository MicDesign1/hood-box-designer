"""Flute -> board caliper (thickness) lookup for the `dieline` CLI.

TODO(owner): these are generic, commonly-cited nominal single-wall/double-wall
caliper figures pulled from public flute reference charts — NOT your actual
board specs, which vary by mill/supplier. Confirm and replace with your real
numbers before relying on CLI output for production. Until then, treat any
CLI-generated box as a rough-caliper draft.

The existing backend/API has no flute->caliper mapping at all — `flute_type`
on BoxSpec is accepted but unused; callers supply `caliper` directly. This
table exists so the CLI's `--flute` flag can drive `caliper` for slot/fillet
geometry. For 0201, panel scoring allowances come from `dieline_core/scoring.py`
(table-driven per flute), not from caliper.
"""

from __future__ import annotations

# nominal caliper, keyed by unit system
FLUTE_CALIPER_IN: dict[str, float] = {
    "B": 0.098,
    "C": 0.140,
    "E": 0.060,
    "BC": 0.238,
}

FLUTE_CALIPER_MM: dict[str, float] = {
    "B": 2.5,
    "C": 3.6,
    "E": 1.5,
    "BC": 6.1,
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
