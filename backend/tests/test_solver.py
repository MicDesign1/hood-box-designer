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
    return Measurements(
        blank_w=_perturb(expected["blank_w"], rng),
        blank_h=_perturb(expected["blank_h"], rng),
        scores_x=tuple(_perturb(v, rng) for v in expected["scores_x"]) if include_scores else None,
        scores_y=tuple(_perturb(v, rng) for v in expected["scores_y"]) if include_scores else None,
        panels_x=None,
    )


def test_solver_rsc_round_trip_noisy():
    result = solve_measurements(
        _noisy_measurements("rsc", "C", 12, 9, 4, seed=42),
        flute="C",
        style="rsc",
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
    )
    assert result is not None
    assert result.confidence == "ambiguous"
    assert result.reason == "underdetermined — need one more measurement"
    assert result.suggested_input == "flap height (edge of blank to first score)"


def test_solver_rsc_from_flap_h_noisy():
    result = solve_measurements(
        Measurements(blank_w=42.75, blank_h=13.5, flap_h=4.6),
        flute="C",
        style="rsc",
    )
    assert result is not None
    assert result.length == pytest.approx(12)
    assert result.width == pytest.approx(9)
    assert result.depth == pytest.approx(4)
    assert result.confidence in ("high", "medium")


def test_solver_tube_from_panel_1_noisy():
    expected = predict_for_spec("tube", "C", "taped", 14, 10, 4)
    panel_1 = expected["scores_x"][0] + 0.06
    result = solve_measurements(
        Measurements(
            blank_w=expected["blank_w"] + 0.07,
            blank_h=expected["blank_h"] - 0.05,
            panel_1=panel_1,
        ),
        flute="C",
        style="tube",
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
