"""Tests for the inverse dieline solver."""

from __future__ import annotations

import random

import pytest

from dieline_core.solver import (
    TUBE_FLAP_H_ERROR,
    Measurements,
    predict_for_spec,
    solve_measurements,
    validate_measurements,
)


def _perturb(value: float, rng: random.Random, delta: float = 0.08) -> float:
    return value + rng.uniform(-delta, delta)


def _noisy_measurements(
    style: str,
    flute: str,
    length: float,
    width: float,
    depth: float,
    *,
    seed: int,
    include_scores: bool = True,
) -> Measurements:
    expected = predict_for_spec(style, flute, "taped", length, width, depth)
    rng = random.Random(seed)
    if style == "tube":
        return Measurements(
            blank_h=_perturb(expected["blank_h"], rng),
            panel_1=_perturb(expected["panel_1"], rng),
            panel_2=_perturb(expected["panel_2"], rng),
        )
    return Measurements(
        panel_d=_perturb(expected["panel_d"], rng),
        panel_1=_perturb(expected["panel_1"], rng),
        panel_2=_perturb(expected["panel_2"], rng),
    )


def test_solver_rsc_round_trip_noisy():
    result = solve_measurements(
        _noisy_measurements("rsc", "C", 12, 9, 4, seed=42),
        flute="C",
        style="rsc",
        joint="taped",
    )
    assert result is not None
    assert result.style == "rsc"
    assert result.length == pytest.approx(12)
    assert result.width == pytest.approx(9)
    assert result.depth == pytest.approx(4)
    assert result.confidence in ("high", "medium")


def test_solver_hsc_round_trip_noisy():
    result = solve_measurements(
        _noisy_measurements("hsc", "C", 10, 8, 6, seed=7),
        flute="C",
        style="hsc",
        joint="taped",
    )
    assert result is not None
    assert result.style == "hsc"
    assert result.length == pytest.approx(10)
    assert result.width == pytest.approx(8)
    assert result.depth == pytest.approx(6)
    assert result.confidence in ("high", "medium")


def test_solver_tube_round_trip_noisy():
    result = solve_measurements(
        _noisy_measurements("tube", "C", 14, 10, 4, seed=99),
        flute="C",
        style="tube",
        joint="taped",
    )
    assert result is not None
    assert result.style == "tube"
    assert result.length == pytest.approx(14)
    assert result.width == pytest.approx(10)
    assert result.depth == pytest.approx(4)
    assert result.confidence in ("high", "medium")


def test_solver_rsc_blank_only_is_ambiguous():
    expected = predict_for_spec("rsc", "C", "taped", 12, 9, 4)
    result = solve_measurements(
        Measurements(blank_w=expected["blank_w"], blank_h=expected["blank_h"]),
        flute="C",
        style="rsc",
        joint="taped",
    )
    assert result is not None
    assert result.confidence == "ambiguous"
    assert result.reason == "underdetermined — need one more measurement"
    assert result.suggested_input == "flap height (edge of blank to first score)"


def test_solver_rsc_from_flap_h_noisy():
    expected = predict_for_spec("rsc", "C", "taped", 12, 9, 4)
    result = solve_measurements(
        Measurements(
            panel_d=expected["panel_d"],
            panel_1=expected["panel_1"],
            panel_2=expected["panel_2"],
            blank_w=42.75,
            blank_h=13.5,
            flap_h=4.6,
        ),
        flute="C",
        style="rsc",
        joint="taped",
    )
    assert result is not None
    assert result.length == pytest.approx(12)
    assert result.width == pytest.approx(9)
    assert result.depth == pytest.approx(4)
    assert result.confidence in ("high", "medium")


def test_solver_tube_from_panel_1_noisy():
    expected = predict_for_spec("tube", "C", "taped", 14, 10, 4)
    result = solve_measurements(
        Measurements(
            blank_h=expected["blank_h"] - 0.05,
            panel_1=expected["panel_1"] + 0.06,
            panel_2=expected["panel_2"] - 0.04,
        ),
        flute="C",
        style="tube",
        joint="taped",
    )
    assert result is not None
    assert result.length == pytest.approx(14)
    assert result.width == pytest.approx(10)
    assert result.depth == pytest.approx(4)
    assert result.confidence in ("high", "medium")


def test_solver_tube_blank_only_is_ambiguous():
    expected = predict_for_spec("tube", "C", "taped", 14, 10, 4)
    result = solve_measurements(
        Measurements(blank_w=expected["blank_w"], blank_h=expected["blank_h"]),
        flute="C",
        style="tube",
        joint="taped",
    )
    assert result is not None
    assert result.confidence == "ambiguous"
    assert result.reason == "underdetermined — L/W split ambiguous; need one more measurement"
    assert result.suggested_input == "panel-1 (edge to first vertical score)"


def test_validate_tube_rejects_flap_h():
    assert (
        validate_measurements(
            "tube",
            Measurements(blank_w=48.625, blank_h=4.0, flap_h=4.6),
        )
        == TUBE_FLAP_H_ERROR
    )


def test_solver_garbage_blank_only_is_ambiguous_and_plausible():
    result = solve_measurements(
        Measurements(blank_w=40.0, blank_h=20.0),
        flute="C",
        style="rsc",
        joint="taped",
    )
    assert result is not None
    assert result.confidence == "ambiguous"
    assert result.depth <= 3 * max(result.length, result.width)


def test_solver_tube_ranks_above_rsc_when_style_omitted():
    expected = predict_for_spec("tube", "C", "taped", 14, 10, 4)
    result = solve_measurements(
        Measurements(
            blank_w=expected["blank_w"],
            blank_h=expected["blank_h"],
            scores_x=expected["scores_x"],
        ),
        flute="C",
        joint="taped",
    )
    assert result is not None
    assert result.style == "tube"
    assert result.runner_up is not None
    assert result.runner_up["style"] in ("rsc", "hsc")
    assert result.rms_error_in < result.runner_up["rms_error_in"]


def test_predict_rsc_c_parity_values():
    expected = predict_for_spec("rsc", "C", "taped", 12, 9, 4)
    assert expected["blank_w"] == pytest.approx(42.625)
    assert expected["blank_h"] == pytest.approx(13.625)
    assert expected["scores_x"] == pytest.approx((12.125, 21.3125, 33.5))
    assert expected["scores_y"] == pytest.approx((4.625, 9.0))
    assert expected["scores_y"][0] == pytest.approx(4.625)


def test_predict_hsc_c_expected():
    expected = predict_for_spec("hsc", "C", "taped", 10, 8, 6)
    assert expected["blank_w"] == pytest.approx(36.625)
    assert expected["blank_h"] == pytest.approx(10.3125)
    assert expected["scores_x"] == pytest.approx((10.125, 18.3125, 28.5))
    assert expected["scores_y"] == pytest.approx((4.125,))


def test_predict_tube_c_expected():
    expected = predict_for_spec("tube", "C", "taped", 14, 10, 4)
    assert expected["blank_w"] == pytest.approx(48.625)
    assert expected["blank_h"] == pytest.approx(4)
    assert expected["scores_x"] == pytest.approx((14.125, 24.3125, 38.5))
    assert expected["scores_y"] == ()
