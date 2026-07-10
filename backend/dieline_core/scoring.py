"""Table-driven scoring allowances for FEFCO styles.

Source of truth: skills/dieline/references/scoring-allowances.md
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

# Double-wall CLI/API flute codes map to the DW scoring row.
SCORING_FLUTE_ALIASES: dict[str, str] = {
    "BC": "DW",
    "EB": "DW",
}

RSC_0201_SCORING_FLUTES = ("B", "C", "DW")

GLUE_TAB_IN = Fraction(3, 2)  # 1½″ per scoring-allowances.md (Stitch/Glue Inside)

@dataclass(frozen=True)
class RscTapedAllowances:
    """Per-panel adders for RSC (0201) taped joint, in inches.

    WCC panel sequence: L+a | W+b | L+c | W+d
    ACC: ½W+a | D+b | ½W+a  (flap_half_add is `a`, depth_add is `b`)
    """

    flap_half_add: Fraction
    depth_add: Fraction
    wcc_panel_adds: tuple[Fraction, Fraction, Fraction, Fraction]


# RSC — Taped (0201-family), from scoring-allowances.md
RSC_0201_TAPED: dict[str, RscTapedAllowances] = {
    "B": RscTapedAllowances(
        flap_half_add=Fraction(1, 16),
        depth_add=Fraction(1, 4),
        wcc_panel_adds=(
            Fraction(1, 16),  # L
            Fraction(1, 8),   # W
            Fraction(1, 16),  # L
            Fraction(1, 8),   # W
        ),
    ),
    "C": RscTapedAllowances(
        flap_half_add=Fraction(1, 8),
        depth_add=Fraction(3, 8),
        wcc_panel_adds=(
            Fraction(1, 8),   # L
            Fraction(3, 16),  # W
            Fraction(3, 16),  # L
            Fraction(1, 8),   # W
        ),
    ),
    "DW": RscTapedAllowances(
        flap_half_add=Fraction(1, 4),
        depth_add=Fraction(5, 8),
        wcc_panel_adds=(
            Fraction(1, 4),   # L
            Fraction(5, 16),  # W
            Fraction(5, 16),  # L
            Fraction(1, 4),   # W
        ),
    ),
}


@dataclass(frozen=True)
class HscTapedAllowances:
    """HSC (0200) taped: bottom flap only; WCC row matches RSC."""

    flap_half_add: Fraction
    depth_add: Fraction
    wcc_panel_adds: tuple[Fraction, Fraction, Fraction, Fraction]


# HSC — Taped (½ RSC), from scoring-allowances.md
HSC_0200_TAPED: dict[str, HscTapedAllowances] = {
    "B": HscTapedAllowances(
        flap_half_add=Fraction(1, 16),
        depth_add=Fraction(1, 8),
        wcc_panel_adds=RSC_0201_TAPED["B"].wcc_panel_adds,
    ),
    "C": HscTapedAllowances(
        flap_half_add=Fraction(1, 8),
        depth_add=Fraction(3, 16),
        wcc_panel_adds=RSC_0201_TAPED["C"].wcc_panel_adds,
    ),
    "DW": HscTapedAllowances(
        flap_half_add=Fraction(1, 4),
        depth_add=Fraction(5, 16),
        wcc_panel_adds=RSC_0201_TAPED["DW"].wcc_panel_adds,
    ),
}


def wcc_sheet_adder(flute: str) -> Fraction:
    """Total allowance added to 2L+2W for taped WCC sheet width."""
    row = RSC_0201_TAPED[normalize_scoring_flute(flute) or ""]
    return sum(row.wcc_panel_adds, Fraction(0))


def hsc_0200_taped_allowances(flute: str) -> HscTapedAllowances:
    key = normalize_scoring_flute(flute)
    if key is None or key not in HSC_0200_TAPED:
        supported = ", ".join(RSC_0201_SCORING_FLUTES)
        raise KeyError(f"unsupported scoring flute '{flute}' (supported: {supported})")
    return HSC_0200_TAPED[key]


def normalize_scoring_flute(flute: str | None) -> str | None:
    if not flute:
        return None
    key = flute.strip().upper()
    return SCORING_FLUTE_ALIASES.get(key, key)


def fraction_to_unit(frac: Fraction, unit: str) -> float:
    inches = float(frac)
    return inches if unit == "in" else inches * 25.4


def glue_tab_for_joint(joint: str, unit: str) -> float:
    if joint == "glued":
        return float(GLUE_TAB_IN) if unit == "in" else float(GLUE_TAB_IN) * 25.4
    return 0.0


def scoring_flute_error(flute: str, style: str) -> str:
    return f"no scoring allowances for flute {flute} on {style}"


def rsc_0201_scoring_error(flute: str) -> str:
    return scoring_flute_error(flute, "0201")


def rsc_0201_taped_allowances(flute: str) -> RscTapedAllowances:
    key = normalize_scoring_flute(flute)
    if key is None or key not in RSC_0201_TAPED:
        supported = ", ".join(RSC_0201_SCORING_FLUTES)
        raise KeyError(f"unsupported scoring flute '{flute}' (supported: {supported})")
    return RSC_0201_TAPED[key]
