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

DEFAULT_TAB_WIDTH_IN = Fraction(3, 2)  # 1½″ shop standard (Stitch/Glue Inside)
GLUE_TAB_IN = DEFAULT_TAB_WIDTH_IN  # alias for existing imports
DEFAULT_JOINT: str = "glued"

# Slot width and glue-tab free-edge inset, first-pass calibration from a real
# ArtiosCAD exemplar export -- see
# skills/dieline/references/tab-and-slot-conventions.md and
# artios-dxf-conventions.md for the underlying analysis. Pending owner
# confirmation like everything else in that file; shared by dieline_core
# (generation) and dieline_core.validate (R8) so there is one source.
SLOT_WIDTH_IN: dict[str, float] = {"B": 0.25, "C": 0.25, "DW": 0.5}
TAB_FREE_EDGE_INSET_IN = Fraction(1, 4)  # 0.25" taper inset at each end of the tab's free edge

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


def glue_tab_for_joint(
    joint: str,
    unit: str,
    tab_width_in: float | Fraction | None = None,
) -> float:
    if joint != "glued":
        return 0.0
    inches = float(tab_width_in if tab_width_in is not None else DEFAULT_TAB_WIDTH_IN)
    return inches if unit == "in" else inches * 25.4


def joint_spec_label(joint: str, tab_width_in: float | None = None) -> str:
    """Plain-language joint line for specs and JSON."""
    if joint == "glued":
        tab = tab_width_in if tab_width_in is not None else float(DEFAULT_TAB_WIDTH_IN)
        tab_text = f'{tab:g}"' if tab == round(tab) else f"{tab:g}"
        return f'glued joint, {tab_text} tab (standard — adjust in Artios if needed)'
    return "taped joint"


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


def wcc_panel_adders(flute: str) -> tuple[Fraction, Fraction, Fraction, Fraction]:
    """WCC panel sequence adders: L | W | L | W."""
    return rsc_0201_taped_allowances(flute).wcc_panel_adds


def acc_depth_panel_add(style: str, flute: str) -> Fraction:
    """ACC middle depth panel (crease-to-crease), inches."""
    key = normalize_scoring_flute(flute) or ""
    if style == "hsc":
        return HSC_0200_TAPED[key].depth_add
    return RSC_0201_TAPED[key].depth_add


# ID → OD adders from scoring-allowances.md quick-reference (RSC D+ column for depth).
ID_TO_OD_ADDERS: dict[str, dict[str, Fraction]] = {
    "B": {"L": Fraction(1, 4), "W": Fraction(1, 4), "D": Fraction(5, 8)},
    "C": {"L": Fraction(3, 8), "W": Fraction(3, 8), "D": Fraction(3, 4)},
    "DW": {"L": Fraction(5, 8), "W": Fraction(5, 8), "D": Fraction(5, 4)},
}


def outside_dimensions_from_id(
    length: float,
    width: float,
    depth: float,
    flute: str,
) -> tuple[float, float, float]:
    """Estimated assembled outside L × W × D from inside dimensions."""
    key = normalize_scoring_flute(flute) or "C"
    row = ID_TO_OD_ADDERS[key]
    return (
        length + float(row["L"]),
        width + float(row["W"]),
        depth + float(row["D"]),
    )
