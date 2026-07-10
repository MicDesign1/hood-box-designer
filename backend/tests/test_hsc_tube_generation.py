"""Tests for table-driven HSC and tube dieline generation."""

from __future__ import annotations

import math

import pytest

from dieline_core.geometry import build_dieline
from dieline_core.solver import Measurements, predict_for_spec, solve_measurements


def _wcc_scores(result) -> list[float]:
    """Cumulative WCC score positions (three interior panel boundaries)."""
    x = result.derived["glue_tab"]
    panel_sizes = [
        result.derived["panel_L"],
        result.derived["panel_W"],
        result.derived["panel_L2"],
        result.derived["panel_W2"],
    ]
    scores: list[float] = []
    for size in panel_sizes[:3]:
        x += size
        scores.append(x)
    return scores


def _acc_scores(result) -> list[float]:
    """Horizontal body/flap creases (ACC direction)."""
    scores: set[float] = set()
    for seg in result.creases:
        if math.isclose(seg.y1, seg.y2, abs_tol=1e-9):
            scores.add(seg.y1)
    return sorted(scores)


def test_hsc_c_flute_taped_10x8x6():
    """HSC Taped C row — recomputed from scoring-allowances.md."""
    result = build_dieline(
        {
            "fefco_code": "hsc",
            "length": 10,
            "width": 8,
            "height": 6,
            "caliper": 0.1563,
            "flute": "C",
            "joint": "taped",
            "units": "in",
        }
    )

    assert result.ok, result.warnings
    assert result.total_w == pytest.approx(36.625)
    assert result.total_h == pytest.approx(10.3125)
    assert _wcc_scores(result) == pytest.approx([10.125, 18.3125, 28.5])
    # Single horizontal crease at body / bottom-flap boundary (top-origin y).
    assert _acc_scores(result) == pytest.approx([result.derived["depth_score"]])
    assert len(_acc_scores(result)) == 1


def test_tube_c_flute_taped_14x10x4():
    """Tube (TT) Taped C row — WCC identical to RSC; height exactly D."""
    result = build_dieline(
        {
            "fefco_code": "tube",
            "length": 14,
            "width": 10,
            "height": 4,
            "caliper": 0.1563,
            "flute": "C",
            "joint": "taped",
            "units": "in",
        }
    )

    assert result.ok, result.warnings
    assert result.total_w == pytest.approx(48.625)
    assert result.total_h == pytest.approx(4.0)
    assert _wcc_scores(result) == pytest.approx([14.125, 24.3125, 38.5])
    assert _acc_scores(result) == []


def test_tube_c_flute_glued_adds_glue_tab():
    result = build_dieline(
        {
            "fefco_code": "tube",
            "length": 14,
            "width": 10,
            "height": 4,
            "caliper": 0.1563,
            "flute": "C",
            "joint": "glued",
            "units": "in",
        }
    )

    assert result.ok, result.warnings
    assert result.derived["glue_tab"] == pytest.approx(1.5)
    assert result.total_w == pytest.approx(48.625 + 1.5)
    assert _wcc_scores(result) == pytest.approx([1.5 + 14.125, 1.5 + 24.3125, 1.5 + 38.5])


def test_tube_solve_generate_round_trip():
    """Solve tube measurements, generate dieline, blank bbox matches prediction."""
    expected = predict_for_spec("tube", "C", "taped", 14, 10, 4)
    solved = solve_measurements(
        Measurements(
            blank_h=expected["blank_h"],
            panel_1=expected["panel_1"],
            panel_2=expected["panel_2"],
        ),
        flute="C",
        style="tube",
        joint="taped",
    )
    assert solved is not None
    assert solved.confidence in ("high", "medium")

    generated = build_dieline(
        {
            "fefco_code": "tube",
            "length": solved.length,
            "width": solved.width,
            "height": solved.depth,
            "caliper": 0.1563,
            "flute": "C",
            "joint": solved.joint,
            "units": "in",
        }
    )
    assert generated.ok, generated.warnings
    assert generated.total_w == pytest.approx(expected["blank_w"])
    assert generated.total_h == pytest.approx(expected["blank_h"])
