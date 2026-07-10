"""Panel-based solve, near-tie ambiguity, and cross-check warnings."""

from __future__ import annotations

import random

import pytest

from dieline_core.solver import (
    INCONSISTENCY_WARNING,
    Measurements,
    NEAR_TIE_REASON,
    SUGGESTED_PANEL_D_INPUT,
    predict_for_spec,
    solve_measurements,
)


def _perturb(value: float, rng: random.Random, delta: float = 0.08) -> float:
    return value + rng.uniform(-delta, delta)


def test_rsc_b_panel_inputs_recovers_9x6x6_5():
    """B-flute RSC 9×6×6.5 from panel-d + panel-1/panel-2, noisy ±0.08."""
    expected = predict_for_spec("rsc", "B", "taped", 9, 6, 6.5)
    rng = random.Random(101)
    result = solve_measurements(
        Measurements(
            panel_d=_perturb(expected["panel_d"], rng),
            panel_1=_perturb(expected["panel_1"], rng),
            panel_2=_perturb(expected["panel_2"], rng),
        ),
        flute="B",
        style="rsc",
        joint="taped",
    )
    assert result is not None
    assert result.length == pytest.approx(9)
    assert result.width == pytest.approx(6)
    assert result.depth == pytest.approx(6.5)
    assert result.confidence in ("high", "medium")


def test_blank_totals_alone_near_tie_6_vs_6_5_depth():
    """Blank totals + flap that fit 6 and 6.5 depth must not return high confidence."""
    expected_65 = predict_for_spec("rsc", "B", "taped", 9, 6, 6.5)
    expected_60 = predict_for_spec("rsc", "B", "taped", 9, 6, 6.0)
    # Midpoint blank totals between the two specs (+ noise on flap only).
    blank_w = (expected_65["blank_w"] + expected_60["blank_w"]) / 2.0
    blank_h = (expected_65["blank_h"] + expected_60["blank_h"]) / 2.0
    flap_h = (expected_65["scores_y"][0] + expected_60["scores_y"][0]) / 2.0
    result = solve_measurements(
        Measurements(blank_w=blank_w, blank_h=blank_h, flap_h=flap_h),
        flute="B",
        style="rsc",
        joint="taped",
    )
    assert result is not None
    assert result.confidence == "ambiguous"
    assert result.reason == NEAR_TIE_REASON
    assert result.suggested_input == SUGGESTED_PANEL_D_INPUT


def test_inconsistent_panels_and_blank_w_warning():
    """Panel path implies 9×6×6.5 but blank-w includes tab when body-only expected."""
    expected = predict_for_spec("rsc", "B", "glued", 9, 6, 6.5)
    wrong_blank_w = expected["blank_w"]  # full width including tab, but excludes_tab=True
    result = solve_measurements(
        Measurements(
            panel_d=expected["panel_d"],
            panel_1=expected["panel_1"],
            panel_2=expected["panel_2"],
            blank_w=wrong_blank_w,
            blank_w_excludes_tab=True,
        ),
        flute="B",
        style="rsc",
        joint="glued",
    )
    assert result is not None
    assert result.warning == INCONSISTENCY_WARNING
    assert result.confidence in ("medium", "low", "ambiguous")
    assert result.confidence != "high"


def test_panel_d_invalid_for_tube():
    from dieline_core.solver import PANEL_D_TUBE_ERROR, validate_measurements

    assert (
        validate_measurements(
            "tube",
            Measurements(panel_d=4.0, panel_1=10.0, panel_2=8.0, blank_h=4.0),
        )
        == PANEL_D_TUBE_ERROR
    )
