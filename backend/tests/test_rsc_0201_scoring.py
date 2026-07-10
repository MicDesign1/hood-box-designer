"""Tests for table-driven RSC 0201 scoring allowances."""

from __future__ import annotations

import math

import pytest

from dieline_core.geometry import build_dieline


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


def test_rsc_0201_c_flute_taped_12x9x4():
    """RSC Taped C row — parity ground truth from scoring-allowances.md."""
    result = build_dieline(
        {
            "fefco_code": "0201",
            "length": 12,
            "width": 9,
            "height": 4,
            "caliper": 0.140,
            "flute": "C",
            "joint": "taped",
            "units": "in",
        }
    )

    assert result.ok, result.warnings
    assert result.total_w == pytest.approx(42.625)
    assert result.total_h == pytest.approx(13.625)
    assert _wcc_scores(result) == pytest.approx([12.125, 21.3125, 33.5])
    assert _acc_scores(result) == pytest.approx([4.625, 9.0])


def test_rsc_0201_c_flute_glued_adds_glue_tab():
    result = build_dieline(
        {
            "fefco_code": "0201",
            "length": 12,
            "width": 9,
            "height": 4,
            "caliper": 0.140,
            "flute": "C",
            "joint": "glued",
            "units": "in",
        }
    )

    assert result.ok, result.warnings
    assert result.derived["glue_tab"] == pytest.approx(1.5)
    assert result.total_w == pytest.approx(42.625 + 1.5)
    assert _wcc_scores(result) == pytest.approx([1.5 + 12.125, 1.5 + 21.3125, 1.5 + 33.5])
