"""Inverse dieline solver — recover inside dimensions from flat blank measurements.

Uses table-driven scoring allowances from scoring.py (RSC/HSC taped, tube).
Does not call geometry.py; prediction only.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Literal

from dieline_core.scoring import (
    DEFAULT_TAB_WIDTH_IN,
    HSC_0200_TAPED,
    RSC_0201_TAPED,
    acc_depth_panel_add,
    glue_tab_for_joint,
    joint_spec_label,
    normalize_scoring_flute,
    outside_dimensions_from_id,
    wcc_panel_adders,
    wcc_sheet_adder,
)

StyleName = Literal["rsc", "hsc", "tube"]
JointName = Literal["taped", "glued"]
Confidence = Literal["high", "medium", "low", "ambiguous"]

GRID_STEP = Fraction(1, 16)
QUARTER_STEP = Fraction(1, 4)
SEARCH_MARGIN = 1.0  # inches around algebraic estimate (underdetermined)
FLAP_SEARCH_MARGIN = 0.125  # +/- 1/8 inch when flap-h pins the family
HIGH_RMS = 1.0 / 32.0
MEDIUM_RMS = 1.0 / 16.0
SNAP_RMS_TOLERANCE = 1.0 / 32.0
MIN_CARTON_DIM = 1.0
NEAR_TIE_RMS = 1.0 / 16.0
INCONSISTENCY_SUM_THRESHOLD = 1.0 / 4.0
NEAR_TIE_REASON = "two specs fit within tape noise — need a sharper measurement"
SUGGESTED_PANEL_D_INPUT = "depth panel crease-to-crease"
SUGGESTED_PANEL1_WIDTH_INPUT = "first panel crease-to-crease"
SUGGESTED_PANEL2_WIDTH_INPUT = "second panel crease-to-crease"
INCONSISTENCY_WARNING = "measurements inconsistent — re-check blank width / tab exclusion"
UNDERDETERMINED_REASON = "underdetermined — need one more measurement"
SUGGESTED_FLAP_INPUT = "flap height (edge of blank to first score)"
SUGGESTED_PANEL1_INPUT = "panel-1 (edge to first vertical score)"
TUBE_LW_AMBIGUOUS_REASON = "underdetermined — L/W split ambiguous; need one more measurement"
TUBE_FLAP_H_ERROR = "--flap-h is not valid for style tube; use --panel-1 instead"
PANEL_D_TUBE_ERROR = "--panel-d is not valid for style tube; blank height is D"

ALL_STYLES: tuple[StyleName, ...] = ("rsc", "hsc", "tube")


@dataclass(frozen=True)
class Measurements:
    blank_w: float | None = None
    blank_h: float | None = None
    scores_x: tuple[float, ...] | None = None
    scores_y: tuple[float, ...] | None = None
    panels_x: tuple[float, ...] | None = None
    flap_h: float | None = None
    panel_1: float | None = None
    panel_2: float | None = None
    panel_d: float | None = None
    """When True with joint=glued, blank_w is body width only (tab not included)."""
    blank_w_excludes_tab: bool = False


@dataclass(frozen=True)
class PredictedBlank:
    blank_w: float
    blank_h: float
    scores_x: tuple[float, ...]
    scores_y: tuple[float, ...]
    panels_x: tuple[float, ...]


@dataclass
class SolveCandidate:
    style: StyleName
    flute: str
    joint: JointName
    length: float
    width: float
    depth: float
    rotated: bool
    predicted: PredictedBlank
    rms_error_in: float
    length_on_quarter: bool
    width_on_quarter: bool
    depth_on_quarter: bool
    estimate_distance: float = 0.0

    @property
    def quarter_snapped(self) -> bool:
        return self.length_on_quarter and self.width_on_quarter and self.depth_on_quarter


@dataclass
class SolveResult:
    style: StyleName
    flute: str
    joint: JointName
    length: float
    width: float
    depth: float
    predicted_blank_w: float
    predicted_blank_h: float
    predicted_scores_x: tuple[float, ...]
    predicted_scores_y: tuple[float, ...]
    rms_error_in: float
    confidence: Confidence
    rotated: bool
    reason: str | None = None
    suggested_input: str | None = None
    runner_up: dict[str, Any] | None = None
    tab_width: float = float(DEFAULT_TAB_WIDTH_IN)
    warning: str | None = None
    outside_L: float | None = None
    outside_W: float | None = None
    outside_D: float | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "style": self.style,
            "flute": self.flute,
            "joint": self.joint,
            "joint_label": joint_spec_label(self.joint, self.tab_width),
            "tab_width": self.tab_width,
            "L": self.length,
            "W": self.width,
            "D": self.depth,
            "predicted_blank_w": self.predicted_blank_w,
            "predicted_blank_h": self.predicted_blank_h,
            "predicted_scores_x": list(self.predicted_scores_x),
            "predicted_scores_y": list(self.predicted_scores_y),
            "rms_error_in": round(self.rms_error_in, 6),
            "confidence": self.confidence,
            "rotated": self.rotated,
        }
        if self.outside_L is not None:
            payload["outside_L"] = self.outside_L
            payload["outside_W"] = self.outside_W
            payload["outside_D"] = self.outside_D
        if self.warning is not None:
            payload["warning"] = self.warning
        if self.reason is not None:
            payload["reason"] = self.reason
        if self.suggested_input is not None:
            payload["suggested_input"] = self.suggested_input
        if self.runner_up is not None:
            payload["runner_up"] = self.runner_up
        return payload


def _resolved_panels_x(measurements: Measurements) -> tuple[float, ...] | None:
    if measurements.panels_x:
        return measurements.panels_x
    if measurements.panel_1 is not None and measurements.panel_2 is not None:
        return (measurements.panel_1, measurements.panel_2)
    return None


def _width_adder(flute: str) -> float:
    return float(wcc_panel_adders(flute)[1])


def _predicted_panel_d(style: StyleName, flute: str, depth: float) -> float:
    return depth + float(acc_depth_panel_add(style, flute))


def _depth_from_panel_d(style: StyleName, flute: str, panel_d: float) -> float:
    return panel_d - float(acc_depth_panel_add(style, flute))


def _length_from_panel_width(panel_1: float, flute: str) -> float:
    return panel_1 - _length_adder(flute)


def _width_from_panel_width(panel_2: float, flute: str) -> float:
    return panel_2 - _width_adder(flute)


def _has_cross_check_blanks(measurements: Measurements) -> bool:
    return measurements.blank_w is not None or measurements.blank_h is not None


def _has_panel_primary(style: StyleName, measurements: Measurements) -> bool:
    panels = _resolved_panels_x(measurements)
    if panels is None or len(panels) < 2:
        return False
    if style == "tube":
        return measurements.panel_1 is not None and measurements.blank_h is not None
    return measurements.panel_d is not None and measurements.panel_1 is not None


def _distinct_spec(a: SolveCandidate, b: SolveCandidate) -> bool:
    return (
        abs(a.length - b.length) > 1e-6
        or abs(a.width - b.width) > 1e-6
        or abs(a.depth - b.depth) > 1e-6
    )


def _suggest_separating_input(a: SolveCandidate, b: SolveCandidate) -> str:
    if abs(a.depth - b.depth) > 1e-6:
        return SUGGESTED_PANEL_D_INPUT
    if abs(a.length - b.length) > 1e-6:
        return SUGGESTED_PANEL1_WIDTH_INPUT
    if abs(a.width - b.width) > 1e-6:
        return SUGGESTED_PANEL2_WIDTH_INPUT
    return SUGGESTED_PANEL_D_INPUT


def _near_tie_ambiguity(
    candidates: list[SolveCandidate],
    best: SolveCandidate,
) -> tuple[str | None, str | None]:
    for alt in candidates:
        if alt is best or not _distinct_spec(alt, best):
            continue
        if alt.rms_error_in <= best.rms_error_in + NEAR_TIE_RMS:
            return NEAR_TIE_REASON, _suggest_separating_input(best, alt)
    return None, None


def _direct_dims_from_panels(
    style: StyleName,
    flute: str,
    measurements: Measurements,
) -> tuple[float, float, float] | None:
    panels = _resolved_panels_x(measurements)
    if panels is None or len(panels) < 2 or measurements.panel_1 is None:
        return None
    length = _length_from_panel_width(measurements.panel_1, flute)
    width = _width_from_panel_width(panels[1], flute)
    if style == "tube":
        if measurements.blank_h is None:
            return None
        depth = measurements.blank_h
    elif measurements.panel_d is None:
        return None
    else:
        depth = _depth_from_panel_d(style, flute, measurements.panel_d)
    return length, width, depth


def _should_check_near_tie(
    style: StyleName,
    measurements: Measurements,
    *,
    determined: bool,
) -> bool:
    if not determined:
        return False
    if _has_panel_primary(style, measurements):
        return False
    if measurements.panel_d is not None:
        return False
    panels = _resolved_panels_x(measurements)
    if panels is not None and len(panels) >= 2:
        return False
    return True


def _consistency_mismatch(
    style: StyleName,
    flute: str,
    joint: JointName,
    measurements: Measurements,
    length: float,
    width: float,
    depth: float,
    *,
    tab_width: float,
) -> float | None:
    if not _has_cross_check_blanks(measurements):
        return None
    direct = _direct_dims_from_panels(style, flute, measurements)
    if direct is not None:
        length, width, depth = direct
    predicted = predict_blank(style, flute, joint, length, width, depth, tab_width=tab_width)
    total = 0.0
    count = 0
    if measurements.blank_w is not None:
        total += _compare_blank_w(
            measurements.blank_w,
            predicted.blank_w,
            joint=joint,
            tab_width=tab_width,
            excludes_tab=measurements.blank_w_excludes_tab,
        )
        count += 1
    if measurements.blank_h is not None:
        total += abs(measurements.blank_h - predicted.blank_h)
        count += 1
    if measurements.flap_h is not None and predicted.scores_y:
        total += abs(measurements.flap_h - predicted.scores_y[0])
        count += 1
    if count == 0:
        return None
    return total


def _cap_confidence(confidence: Confidence, cap: Confidence) -> Confidence:
    order = {"high": 3, "medium": 2, "low": 1, "ambiguous": 0}
    return confidence if order[confidence] <= order[cap] else cap


def _frac(flute: str, value: Fraction) -> float:
    return float(value)


def _glue_tab(joint: JointName, tab_width: float) -> float:
    return glue_tab_for_joint(joint, "in", tab_width)


def _wcc_panels(flute: str, length: float, width: float) -> tuple[float, ...]:
    row = RSC_0201_TAPED[normalize_scoring_flute(flute) or ""]
    bases = (length, width, length, width)
    return tuple(
        base + _frac(flute, adder) for base, adder in zip(bases, row.wcc_panel_adds, strict=True)
    )


def predict_blank(
    style: StyleName,
    flute: str,
    joint: JointName,
    length: float,
    width: float,
    depth: float,
    *,
    tab_width: float = float(DEFAULT_TAB_WIDTH_IN),
) -> PredictedBlank:
    """Forward model: inside dims -> blank size and score positions (inches)."""
    scoring_key = normalize_scoring_flute(flute) or ""
    glue = _glue_tab(joint, tab_width)
    panels = _wcc_panels(flute, length, width)
    blank_w = glue + sum(panels)
    x = glue
    scores_x: list[float] = []
    for panel in panels[:3]:
        x += panel
        scores_x.append(x)

    if style == "tube":
        return PredictedBlank(
            blank_w=blank_w,
            blank_h=depth,
            scores_x=tuple(scores_x),
            scores_y=(),
            panels_x=panels,
        )

    rsc = RSC_0201_TAPED[scoring_key]
    flap = width / 2.0 + _frac(flute, rsc.flap_half_add)
    body = depth + _frac(flute, rsc.depth_add)

    if style == "rsc":
        blank_h = flap + body + flap
        scores_y = (flap, flap + body)
        return PredictedBlank(
            blank_w=blank_w,
            blank_h=blank_h,
            scores_x=tuple(scores_x),
            scores_y=scores_y,
            panels_x=panels,
        )

    # hsc — bottom flap only
    hsc = HSC_0200_TAPED[scoring_key]
    flap_h = width / 2.0 + _frac(flute, hsc.flap_half_add)
    body_h = depth + _frac(flute, hsc.depth_add)
    blank_h = flap_h + body_h
    scores_y = (flap_h,)
    return PredictedBlank(
        blank_w=blank_w,
        blank_h=blank_h,
        scores_x=tuple(scores_x),
        scores_y=scores_y,
        panels_x=panels,
    )


def _on_grid(value: float, step: Fraction) -> bool:
    scaled = Fraction(value).limit_denominator(64)
    step_f = step
    return scaled % step_f == 0


def _tube_lw_split_known(measurements: Measurements) -> bool:
    panels = _resolved_panels_x(measurements)
    return (
        measurements.panel_1 is not None
        and panels is not None
        and len(panels) >= 2
    ) or (
        measurements.panel_1 is not None
        or bool(measurements.scores_x)
        or bool(measurements.panels_x)
    )


def _has_third_constraint(style: StyleName, measurements: Measurements) -> bool:
    if _has_panel_primary(style, measurements):
        return True
    if style == "tube":
        return _tube_lw_split_known(measurements)
    return (
        measurements.flap_h is not None
        or measurements.panel_1 is not None
        or measurements.panel_d is not None
        or bool(measurements.scores_x)
        or bool(measurements.scores_y)
        or bool(measurements.panels_x)
        or measurements.panel_2 is not None
    )


def _has_minimum_inputs(style: StyleName | None, measurements: Measurements) -> bool:
    if style is not None and _has_panel_primary(style, measurements):
        return True
    if measurements.blank_w is not None and measurements.blank_h is not None:
        return True
    if style is None:
        for candidate_style in ALL_STYLES:
            if _has_panel_primary(candidate_style, measurements):
                return True
    return False


def validate_measurements(style: StyleName | None, measurements: Measurements) -> str | None:
    """Return a user-facing error string, or None if inputs are valid."""
    if measurements.flap_h is not None and style == "tube":
        return TUBE_FLAP_H_ERROR
    if measurements.panel_d is not None and style == "tube":
        return PANEL_D_TUBE_ERROR
    if style is not None and not _has_minimum_inputs(style, measurements):
        if style == "tube":
            return "need panel-1, panel-2, and blank height (or full blank width and height)"
        return "need panel-d, panel-1, and panel-2 (or full blank width and height)"
    if style is None and not _has_minimum_inputs(None, measurements):
        return "need panel measurements or full blank width and height"
    return None


def _ambiguity_message(style: StyleName) -> tuple[str, str]:
    if style == "tube":
        return TUBE_LW_AMBIGUOUS_REASON, SUGGESTED_PANEL1_INPUT
    return UNDERDETERMINED_REASON, SUGGESTED_FLAP_INPUT


def _constraint_count(style: StyleName, measurements: Measurements) -> int:
    """Count independent measurement inputs available for this style."""
    count = 0
    if measurements.blank_w is not None:
        count += 1
    if measurements.blank_h is not None:
        count += 1
    if measurements.panel_d is not None:
        count += 1
    if measurements.panel_1 is not None:
        count += 1
    if measurements.panel_2 is not None:
        count += 1
    if style != "tube" and measurements.flap_h is not None:
        count += 1
    if measurements.scores_x:
        count += 1
    if measurements.scores_y:
        count += 1
    if measurements.panels_x:
        count += 1
    return count


def _required_constraints(style: StyleName) -> int:
    return 3


def _is_determined(style: StyleName, measurements: Measurements) -> bool:
    return _has_third_constraint(style, measurements)


def _length_adder(flute: str) -> float:
    scoring_key = normalize_scoring_flute(flute) or ""
    return float(RSC_0201_TAPED[scoring_key].wcc_panel_adds[0])


def _length_from_panel_1(panel_1: float, flute: str, *, glue: float = 0.0) -> float:
    return panel_1 - glue - _length_adder(flute)


def _confidence_from_rms(rms: float) -> Confidence:
    if rms < HIGH_RMS:
        return "high"
    if rms < MEDIUM_RMS:
        return "medium"
    return "low"


FIELD_TOLERANCE = 0.125  # 1/8 inch — typical salesperson tape measure


def _final_confidence(rms: float, *, determined: bool) -> Confidence:
    if not determined:
        return "ambiguous"
    base = _confidence_from_rms(rms)
    if base == "low" and rms < FIELD_TOLERANCE:
        return "medium"
    return base


def _plausibility_penalty(candidate: SolveCandidate, *, underdetermined: bool) -> float:
    """Ranking-only penalty — never applied to reported RMS."""
    penalty = 0.0
    length = candidate.length
    width = candidate.width
    depth = candidate.depth
    if length < MIN_CARTON_DIM or width < MIN_CARTON_DIM or depth < MIN_CARTON_DIM:
        penalty += 100.0
    major = max(length, width)
    if depth > 3.0 * major:
        penalty += 50.0 * (depth - 3.0 * major)
    if length < width:
        penalty += 2.0
    if underdetermined and candidate.rotated:
        penalty += 25.0
    return penalty


def _compare_values(
    measured: tuple[float, ...] | None,
    predicted: tuple[float, ...],
    residuals: list[float],
) -> None:
    if not measured:
        return
    if len(measured) != len(predicted):
        residuals.extend(abs(m - p) for m, p in zip(measured, predicted, strict=False))
        if len(measured) > len(predicted):
            residuals.extend(abs(m) * 0.25 for m in measured[len(predicted) :])
        else:
            residuals.extend(abs(p) * 0.25 for p in predicted[len(measured) :])
        return
    residuals.extend(abs(m - p) for m, p in zip(measured, predicted, strict=True))


def _compare_blank_w(
    measured: float,
    predicted_w: float,
    *,
    joint: JointName,
    tab_width: float,
    excludes_tab: bool,
) -> float:
    if joint == "glued" and excludes_tab:
        return abs(measured - (predicted_w - tab_width))
    return abs(measured - predicted_w)


def _rms(
    measurements: Measurements,
    predicted: PredictedBlank,
    *,
    rotated: bool,
    joint: JointName,
    tab_width: float,
    style: StyleName,
    flute: str,
    depth: float,
) -> float:
    residuals: list[float] = []
    excludes_tab = measurements.blank_w_excludes_tab
    panels = _resolved_panels_x(measurements)

    if rotated:
        if measurements.blank_w is not None:
            _compare_values((measurements.blank_w,), (predicted.blank_h,), residuals)
        if measurements.blank_h is not None:
            _compare_values((measurements.blank_h,), (predicted.blank_w,), residuals)
        _compare_values(measurements.scores_x, predicted.scores_y, residuals)
        _compare_values(measurements.scores_y, predicted.scores_x, residuals)
        if panels:
            _compare_values(panels, predicted.panels_x, residuals)
        if measurements.flap_h is not None and predicted.scores_x:
            _compare_values((measurements.flap_h,), (predicted.scores_x[0],), residuals)
        if measurements.panel_1 is not None and predicted.panels_x:
            _compare_values((measurements.panel_1,), (predicted.panels_x[0],), residuals)
    else:
        if measurements.blank_w is not None:
            residuals.append(
                _compare_blank_w(
                    measurements.blank_w,
                    predicted.blank_w,
                    joint=joint,
                    tab_width=tab_width,
                    excludes_tab=excludes_tab,
                )
            )
        if measurements.blank_h is not None:
            _compare_values((measurements.blank_h,), (predicted.blank_h,), residuals)
        if measurements.panel_d is not None and style != "tube":
            expected_d = _predicted_panel_d(style, flute, depth)
            _compare_values((measurements.panel_d,), (expected_d,), residuals)
        if measurements.scores_x:
            predicted_scores = predicted.scores_x
            if joint == "glued" and excludes_tab:
                predicted_scores = tuple(s - tab_width for s in predicted.scores_x)
            _compare_values(measurements.scores_x, predicted_scores, residuals)
        _compare_values(measurements.scores_y, predicted.scores_y, residuals)
        if panels:
            _compare_values(panels, predicted.panels_x[: len(panels)], residuals)
        elif measurements.panel_1 is not None and predicted.panels_x:
            _compare_values((measurements.panel_1,), (predicted.panels_x[0],), residuals)
        if measurements.panel_2 is not None and len(predicted.panels_x) >= 2:
            _compare_values((measurements.panel_2,), (predicted.panels_x[1],), residuals)
        if measurements.flap_h is not None and predicted.scores_y:
            _compare_values((measurements.flap_h,), (predicted.scores_y[0],), residuals)

    if not residuals:
        return math.inf
    return math.sqrt(sum(r * r for r in residuals) / len(residuals))


def _round_quarter(value: float) -> float:
    return round(value * 4.0) / 4.0


def _estimate_ranges(
    style: StyleName,
    flute: str,
    measurements: Measurements,
    *,
    rotated: bool,
    search_margin: float,
    joint: JointName,
    tab_width: float,
) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float]]:
    """Return (L range), (W range), (D range) as (lo, hi)."""
    scoring_key = normalize_scoring_flute(flute) or ""
    wcc_add = float(wcc_sheet_adder(flute))
    if joint == "glued" and not measurements.blank_w_excludes_tab:
        glue = _glue_tab(joint, tab_width)
    else:
        glue = 0.0

    panels = _resolved_panels_x(measurements)
    if _has_panel_primary(style, measurements) and panels is not None:
        length_est = _round_quarter(_length_from_panel_width(measurements.panel_1 or panels[0], flute))
        width_est = _round_quarter(_width_from_panel_width(panels[1], flute))
        if style == "tube":
            depth_est = _round_quarter(measurements.blank_h or 4.0)
        elif measurements.panel_d is not None:
            depth_est = _round_quarter(_depth_from_panel_d(style, flute, measurements.panel_d))
        else:
            depth_est = 4.0

        def _tight(center: float) -> tuple[float, float]:
            lo = max(MIN_CARTON_DIM, center - FLAP_SEARCH_MARGIN)
            hi = center + FLAP_SEARCH_MARGIN
            return (lo, hi)

        return _tight(length_est), _tight(width_est), _tight(depth_est)

    if measurements.blank_w is None or measurements.blank_h is None:
        return (MIN_CARTON_DIM, 20.0), (MIN_CARTON_DIM, 20.0), (MIN_CARTON_DIM, 20.0)

    blank_w = measurements.blank_w if not rotated else measurements.blank_h
    blank_h = measurements.blank_h if not rotated else measurements.blank_w
    scores_x = measurements.scores_x
    scores_y = measurements.scores_y if not rotated else measurements.scores_x
    panels_x = measurements.panels_x
    flap_h = measurements.flap_h if not rotated else None
    panel_1 = measurements.panel_1 if not rotated else None

    length_est = 12.0
    width_est = 9.0
    depth_est = 4.0
    sum_lw = (blank_w - glue - wcc_add) / 2.0

    if style == "tube":
        depth_est = blank_h
        if panel_1 is not None:
            length_est = _round_quarter(_length_from_panel_1(panel_1, flute, glue=glue))
            width_est = _round_quarter(sum_lw - length_est)
        elif panels_x and len(panels_x) >= 2:
            length_est = panels_x[0] - float(RSC_0201_TAPED[scoring_key].wcc_panel_adds[0])
            width_est = panels_x[1] - float(RSC_0201_TAPED[scoring_key].wcc_panel_adds[1])
        elif scores_x and len(scores_x) >= 2:
            p1 = scores_x[0] - glue
            p2 = scores_x[1] - scores_x[0]
            length_est = p1 - float(RSC_0201_TAPED[scoring_key].wcc_panel_adds[0])
            width_est = p2 - float(RSC_0201_TAPED[scoring_key].wcc_panel_adds[1])
        elif scores_x and len(scores_x) >= 1:
            length_est = _length_from_panel_1(scores_x[0], flute, glue=glue)
            width_est = sum_lw - length_est
        else:
            length_est = width_est = sum_lw / 2.0
    elif style == "hsc":
        hsc = HSC_0200_TAPED[scoring_key]
        flap_add = float(hsc.flap_half_add)
        depth_add = float(hsc.depth_add)
        sum_lw = (blank_w - glue - wcc_add) / 2.0
        if flap_h is not None:
            width_est = _round_quarter(2.0 * (flap_h - flap_add))
            depth_est = _round_quarter(blank_h - flap_h - depth_add)
            length_est = _round_quarter(sum_lw - width_est)
        elif panel_1 is not None:
            length_est = _round_quarter(_length_from_panel_1(panel_1, flute, glue=glue))
            width_est = _round_quarter(sum_lw - length_est)
            depth_est = _round_quarter(blank_h - width_est / 2.0 - flap_add - depth_add)
        elif scores_y and len(scores_y) >= 1:
            width_est = 2.0 * (scores_y[0] - flap_add)
            if len(scores_y) >= 2:
                depth_est = scores_y[1] - scores_y[0] - depth_add
            else:
                depth_est = blank_h - scores_y[0] - depth_add
            length_est = sum_lw - width_est
        else:
            width_est = max(2.0, 2.0 * (blank_h * 0.35))
            depth_est = blank_h - width_est / 2.0 - flap_add - depth_add
            if panels_x and len(panels_x) >= 1:
                length_est = panels_x[0] - float(RSC_0201_TAPED[scoring_key].wcc_panel_adds[0])
            elif scores_x and len(scores_x) >= 1:
                length_est = scores_x[0] - glue - float(RSC_0201_TAPED[scoring_key].wcc_panel_adds[0])
            else:
                length_est = sum_lw - width_est
    else:  # rsc
        rsc = RSC_0201_TAPED[scoring_key]
        flap_add = float(rsc.flap_half_add)
        depth_add = float(rsc.depth_add)
        acc_sheet_add = float(rsc.flap_half_add) * 2.0 + float(rsc.depth_add)
        sum_lw = (blank_w - glue - wcc_add) / 2.0
        sum_wd = blank_h - acc_sheet_add
        if flap_h is not None:
            width_est = _round_quarter(2.0 * (flap_h - flap_add))
            depth_est = _round_quarter(blank_h - width_est - 2.0 * flap_add - depth_add)
            length_est = _round_quarter(sum_lw - width_est)
        elif panel_1 is not None:
            length_est = _round_quarter(_length_from_panel_1(panel_1, flute, glue=glue))
            width_est = _round_quarter(sum_lw - length_est)
            depth_est = _round_quarter(sum_wd - width_est)
        elif scores_y and len(scores_y) >= 2:
            width_est = 2.0 * (scores_y[0] - flap_add)
            depth_est = scores_y[1] - scores_y[0] - depth_add
            length_est = sum_lw - width_est
        elif scores_y and len(scores_y) == 1:
            width_est = 2.0 * (scores_y[0] - flap_add)
            depth_est = max(1.0, sum_wd - width_est)
        elif sum_lw > 0 and sum_wd > 0:
            # Parametric family L+W=sum_lw, W+D=sum_wd; center on typical RSC width share.
            width_est = sum_lw * (3.0 / 7.0)
            depth_est = sum_wd - width_est
        else:
            depth_est = max(1.0, blank_h - 1.0)
            width_est = max(2.0, blank_h - depth_est - wcc_add)
        if panels_x and len(panels_x) >= 1:
            length_est = panels_x[0] - float(rsc.wcc_panel_adds[0])
        elif scores_x and len(scores_x) >= 1:
            length_est = scores_x[0] - glue - float(rsc.wcc_panel_adds[0])
        else:
            length_est = sum_lw - width_est

    def _range(center: float) -> tuple[float, float]:
        lo = max(MIN_CARTON_DIM, center - search_margin)
        hi = center + search_margin
        return (lo, hi)

    return _range(length_est), _range(width_est), _range(depth_est)


def _grid_values(lo: float, hi: float, step: Fraction) -> list[float]:
    start = math.ceil(lo / float(step)) * float(step)
    values: list[float] = []
    value = start
    while value <= hi + 1e-9:
        if value >= lo - 1e-9:
            values.append(round(value, 6))
        value += float(step)
    return values


def _snap_to_quarter(
    candidate: SolveCandidate,
    style: StyleName,
    flute: str,
    joint: JointName,
    measurements: Measurements,
    *,
    determined: bool,
    tab_width: float,
) -> SolveCandidate:
    """Prefer quarter-inch specs when fit is nearly as good as the grid best."""
    snapped_l = round(candidate.length * 4.0) / 4.0
    snapped_w = round(candidate.width * 4.0) / 4.0
    snapped_d = round(candidate.depth * 4.0) / 4.0
    snapped = _evaluate_candidate(
        style,
        flute,
        joint,
        measurements,
        snapped_l,
        snapped_w,
        snapped_d,
        rotated=candidate.rotated,
        estimate=(candidate.length, candidate.width, candidate.depth),
        tab_width=tab_width,
    )
    tolerance = MEDIUM_RMS if determined else SNAP_RMS_TOLERANCE
    if (
        snapped is not None
        and snapped.quarter_snapped
        and snapped.rms_error_in <= candidate.rms_error_in + tolerance
    ):
        return snapped
    return candidate


def _evaluate_candidate(
    style: StyleName,
    flute: str,
    joint: JointName,
    measurements: Measurements,
    length: float,
    width: float,
    depth: float,
    *,
    rotated: bool,
    estimate: tuple[float, float, float] | None = None,
    tab_width: float = float(DEFAULT_TAB_WIDTH_IN),
) -> SolveCandidate | None:
    if length <= 0 or width <= 0 or depth <= 0:
        return None
    predicted = predict_blank(style, flute, joint, length, width, depth, tab_width=tab_width)
    rms = _rms(
        measurements,
        predicted,
        rotated=rotated,
        joint=joint,
        tab_width=tab_width,
        style=style,
        flute=flute,
        depth=depth,
    )
    if not math.isfinite(rms):
        return None
    est_dist = 0.0
    if estimate is not None:
        est_dist = math.sqrt(
            (length - estimate[0]) ** 2 + (width - estimate[1]) ** 2 + (depth - estimate[2]) ** 2
        )
    return SolveCandidate(
        style=style,
        flute=flute,
        joint=joint,
        length=length,
        width=width,
        depth=depth,
        rotated=rotated,
        predicted=predicted,
        rms_error_in=rms,
        length_on_quarter=_on_grid(length, QUARTER_STEP),
        width_on_quarter=_on_grid(width, QUARTER_STEP),
        depth_on_quarter=_on_grid(depth, QUARTER_STEP),
        estimate_distance=est_dist,
    )


def _candidate_sort_key(
    candidate: SolveCandidate,
    *,
    underdetermined: bool,
    prefer_quarter: bool = False,
) -> tuple:
    quarter_bonus = 0 if candidate.quarter_snapped else 1
    orientation_penalty = 1 if candidate.rotated else 0
    l_ge_w_penalty = 0 if candidate.length >= candidate.width else 1
    if prefer_quarter:
        return (
            quarter_bonus,
            candidate.rms_error_in,
            _plausibility_penalty(candidate, underdetermined=underdetermined),
            l_ge_w_penalty,
            candidate.estimate_distance,
            abs((candidate.length / candidate.width) - (4.0 / 3.0)) if candidate.width > 0 else 0.0,
            orientation_penalty,
            -candidate.width,
        )
    return (
        candidate.rms_error_in,
        _plausibility_penalty(candidate, underdetermined=underdetermined),
        quarter_bonus,
        l_ge_w_penalty,
        candidate.estimate_distance,
        abs((candidate.length / candidate.width) - (4.0 / 3.0)) if candidate.width > 0 else 0.0,
        orientation_penalty,
        -candidate.width,
    )


def _search_margin_for(style: StyleName, measurements: Measurements) -> float:
    if _has_panel_primary(style, measurements):
        return FLAP_SEARCH_MARGIN
    if style in ("rsc", "hsc") and measurements.flap_h is not None:
        return FLAP_SEARCH_MARGIN
    if measurements.panel_1 is not None:
        return FLAP_SEARCH_MARGIN
    if _is_determined(style, measurements):
        return SEARCH_MARGIN
    return SEARCH_MARGIN


def _prefer_quarter_ranking(measurements: Measurements, *, determined: bool) -> bool:
    return determined and (
        measurements.flap_h is not None
        or measurements.panel_1 is not None
        or measurements.panel_d is not None
    )


def _search_style(
    style: StyleName,
    flute: str,
    joint: JointName,
    measurements: Measurements,
    *,
    underdetermined: bool,
    tab_width: float,
) -> tuple[SolveCandidate | None, list[SolveCandidate]]:
    candidates: list[SolveCandidate] = []
    margin = _search_margin_for(style, measurements)
    orientations = (False,) if underdetermined else (False, True)
    prefer_quarter = _prefer_quarter_ranking(measurements, determined=not underdetermined)

    for rotated in orientations:
        l_rng, w_rng, d_rng = _estimate_ranges(
            style, flute, measurements, rotated=rotated, search_margin=margin,
            joint=joint, tab_width=tab_width,
        )
        estimate = (
            (l_rng[0] + l_rng[1]) / 2.0,
            (w_rng[0] + w_rng[1]) / 2.0,
            (d_rng[0] + d_rng[1]) / 2.0,
        )
        sixteenth_here: list[SolveCandidate] = []

        for length in _grid_values(l_rng[0], l_rng[1], GRID_STEP):
            for width in _grid_values(w_rng[0], w_rng[1], GRID_STEP):
                for depth in _grid_values(d_rng[0], d_rng[1], GRID_STEP):
                    candidate = _evaluate_candidate(
                        style,
                        flute,
                        joint,
                        measurements,
                        length,
                        width,
                        depth,
                        rotated=rotated,
                        estimate=estimate,
                        tab_width=tab_width,
                    )
                    if candidate is not None:
                        sixteenth_here.append(candidate)

        if not sixteenth_here:
            continue

        best_sixteenth = min(sixteenth_here, key=lambda c: c.rms_error_in)
        candidates.extend(sixteenth_here)

        for length in _grid_values(
            best_sixteenth.length - 0.5, best_sixteenth.length + 0.5, QUARTER_STEP
        ):
            for width in _grid_values(
                best_sixteenth.width - 0.5, best_sixteenth.width + 0.5, QUARTER_STEP
            ):
                for depth in _grid_values(
                    best_sixteenth.depth - 0.5, best_sixteenth.depth + 0.5, QUARTER_STEP
                ):
                    candidate = _evaluate_candidate(
                        style,
                        flute,
                        joint,
                        measurements,
                        length,
                        width,
                        depth,
                        rotated=rotated,
                        estimate=estimate,
                        tab_width=tab_width,
                    )
                    if (
                        candidate is not None
                        and candidate.quarter_snapped
                        and candidate.rms_error_in <= best_sixteenth.rms_error_in + SNAP_RMS_TOLERANCE
                    ):
                        candidates.append(candidate)

    if not candidates:
        return None, []
    best = min(
        candidates,
        key=lambda c: _candidate_sort_key(
            c, underdetermined=underdetermined, prefer_quarter=prefer_quarter
        ),
    )
    best = _snap_to_quarter(
        best, style, flute, joint, measurements, determined=not underdetermined, tab_width=tab_width
    )
    return best, candidates


def solve_measurements(
    measurements: Measurements,
    *,
    flute: str,
    joint: JointName = "glued",
    style: StyleName | None = None,
    tab_width: float = float(DEFAULT_TAB_WIDTH_IN),
) -> SolveResult | None:
    """Recover inside dimensions from noisy flat-blank measurements."""
    scoring_key = normalize_scoring_flute(flute)
    if scoring_key is None or scoring_key not in RSC_0201_TAPED:
        return None

    input_error = validate_measurements(style, measurements)
    if input_error is not None:
        return None

    styles: tuple[StyleName, ...] = (style,) if style else ALL_STYLES
    ranked: list[tuple[SolveCandidate, bool, list[SolveCandidate]]] = []
    for candidate_style in styles:
        determined = _is_determined(candidate_style, measurements)
        style_joint: JointName = "taped" if candidate_style == "tube" else joint
        found, pool = _search_style(
            candidate_style,
            flute,
            style_joint,
            measurements,
            underdetermined=not determined,
            tab_width=tab_width,
        )
        if found is not None:
            ranked.append((found, determined, pool))

    if not ranked:
        return None

    ranked.sort(
        key=lambda item: _candidate_sort_key(
            item[0],
            underdetermined=not item[1],
            prefer_quarter=_prefer_quarter_ranking(measurements, determined=item[1]),
        )
    )
    best, best_determined, best_pool = ranked[0]
    runner_up: dict[str, Any] | None = None
    if style is None and len(ranked) > 1:
        second, _, _ = ranked[1]
        runner_up = {
            "style": second.style,
            "rms_error_in": round(second.rms_error_in, 6),
            "L": second.length,
            "W": second.width,
            "D": second.depth,
        }

    reason: str | None = None
    suggested_input: str | None = None
    if not best_determined:
        reason, suggested_input = _ambiguity_message(best.style)
    elif _should_check_near_tie(best.style, measurements, determined=best_determined):
        near_reason, near_suggested = _near_tie_ambiguity(best_pool, best)
        if near_reason is not None:
            reason = near_reason
            suggested_input = near_suggested

    result_joint: JointName = "taped" if best.style == "tube" else joint
    confidence = _final_confidence(best.rms_error_in, determined=best_determined)
    if not best_determined:
        confidence = "ambiguous"
    elif reason == NEAR_TIE_REASON:
        confidence = "ambiguous"

    warning: str | None = None
    mismatch = _consistency_mismatch(
        best.style,
        flute,
        result_joint,
        measurements,
        best.length,
        best.width,
        best.depth,
        tab_width=tab_width,
    )
    if mismatch is not None and mismatch > INCONSISTENCY_SUM_THRESHOLD:
        warning = INCONSISTENCY_WARNING
        confidence = _cap_confidence(confidence, "medium")

    outside_L, outside_W, outside_D = outside_dimensions_from_id(
        best.length, best.width, best.depth, flute
    )

    return SolveResult(
        style=best.style,
        flute=flute,
        joint=result_joint,
        length=best.length,
        width=best.width,
        depth=best.depth,
        predicted_blank_w=best.predicted.blank_w,
        predicted_blank_h=best.predicted.blank_h,
        predicted_scores_x=best.predicted.scores_x,
        predicted_scores_y=best.predicted.scores_y,
        rms_error_in=best.rms_error_in,
        confidence=confidence,
        rotated=best.rotated,
        reason=reason,
        suggested_input=suggested_input,
        runner_up=runner_up,
        tab_width=tab_width,
        warning=warning,
        outside_L=outside_L,
        outside_W=outside_W,
        outside_D=outside_D,
    )


def predict_for_spec(
    style: StyleName,
    flute: str,
    joint: JointName,
    length: float,
    width: float,
    depth: float,
    *,
    tab_width: float = float(DEFAULT_TAB_WIDTH_IN),
) -> dict[str, Any]:
    """Helper for tests — expose expected measurements for a known spec."""
    predicted = predict_blank(style, flute, joint, length, width, depth, tab_width=tab_width)
    result = {
        "blank_w": predicted.blank_w,
        "blank_h": predicted.blank_h,
        "scores_x": predicted.scores_x,
        "scores_y": predicted.scores_y,
        "panels_x": predicted.panels_x,
    }
    if style in ("rsc", "hsc"):
        result["panel_d"] = _predicted_panel_d(style, flute, depth)
    if len(predicted.panels_x) >= 2:
        result["panel_1"] = predicted.panels_x[0]
        result["panel_2"] = predicted.panels_x[1]
    return result
