"""Phase 1 gate: `dieline validate` (dieline_core.validate) against three
kinds of evidence:

1. The real ArtiosCAD exemplar (`skills/dieline/references/artios-exemplar.dxf`)
   -- the calibration test. If this ever fails R1-R7, the validator is wrong,
   not the exemplar (see artios-dxf-conventions.md for how this was verified).
2. Our own generator's 12x9x4 C-flute RSC baseline -- expected to fail R7
   pervasively (fillet trimming detaches crease endpoints from the actual cut
   path) while staying clean on R1-R6.
3. Hand-built micro-DXFs isolating R3 vs. R4 (dangling vs. butted) and R7
   (crease landing mid-span, a T-junction) as independent, non-collapsed
   outcomes.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf
import pytest

from dieline_core.geometry import build_dieline, build_dxf
from dieline_core.validate import validate_dxf

REPO_ROOT = Path(__file__).resolve().parents[2]
EXEMPLAR_PATH = REPO_ROOT / "skills" / "dieline" / "references" / "artios-exemplar.dxf"


def _write_dxf(path: Path, *, cuts: list[tuple[tuple[float, float], tuple[float, float]]], creases: list[tuple[tuple[float, float], tuple[float, float]]] = ()) -> None:
    doc = ezdxf.new("R2010")
    doc.layers.add("CUT", color=1)
    doc.layers.add("CREASE", color=3)
    msp = doc.modelspace()
    for a, b in cuts:
        msp.add_line(a, b, dxfattribs={"layer": "CUT"})
    for a, b in creases:
        msp.add_line(a, b, dxfattribs={"layer": "CREASE"})
    doc.saveas(str(path))


def test_exemplar_is_clean_on_r1_through_r7():
    report = validate_dxf(EXEMPLAR_PATH)
    for rule in ("R1", "R2", "R3", "R4", "R5", "R6", "R7"):
        assert report.counts[rule] == 0, f"{rule} unexpectedly nonzero on the ArtiosCAD exemplar: {[d.message for d in report.defects if d.rule == rule]}"
    assert report.convention == "artios"


def test_our_generator_baseline_is_fully_clean_after_the_weld_fix(tmp_path):
    """Phase 2 acceptance: the crease-to-cut welding in build_dieline (see
    _weld_creases_to_cut_vertices in dieline_core.geometry) splits cuts at
    T-junctions and re-points fillet-detached crease endpoints, so the
    12x9x4 C-flute RSC baseline that failed R7 pervasively in Phase 1 is now
    fully clean."""
    result = build_dieline(
        {
            "fefco_code": "0201",
            "length": 12,
            "width": 9,
            "height": 4,
            "caliper": 0.1563,
            "flute": "C",
            "joint": "taped",
            "units": "in",
        }
    )
    assert result.ok
    out = tmp_path / "baseline.dxf"
    out.write_bytes(build_dxf(result))

    report = validate_dxf(out)
    for rule in ("R1", "R2", "R3", "R4", "R5", "R6", "R7"):
        assert report.counts[rule] == 0, f"{rule} unexpectedly nonzero: {[d.message for d in report.defects if d.rule == rule]}"
    assert report.convention == "ours"


def test_exact_shared_endpoint_trips_neither_r3_nor_r4(tmp_path):
    out = tmp_path / "good.dxf"
    _write_dxf(
        out,
        cuts=[
            ((0.0, 0.0), (10.0, 0.0)),
            ((10.0, 0.0), (10.0, 10.0)),
            ((10.0, 10.0), (0.0, 10.0)),
            ((0.0, 10.0), (0.0, 0.0)),
        ],
    )
    report = validate_dxf(out)
    assert report.counts["R3"] == 0
    assert report.counts["R4"] == 0
    assert report.ok


def test_butted_gap_within_near_tol_trips_r4_not_r3(tmp_path):
    out = tmp_path / "butted.dxf"
    _write_dxf(
        out,
        cuts=[
            ((0.0, 0.0), (10.0, 0.0)),
            ((10.0002, 0.0), (10.0, 10.0)),  # 0.0002in gap: > snap-tol(1e-4), <= near-tol(1e-3)
            ((10.0, 10.0), (0.0, 10.0)),
            ((0.0, 10.0), (0.0, 0.0)),
        ],
    )
    report = validate_dxf(out)
    assert report.counts["R4"] >= 1, "expected the 0.0002in gap to trip R4"
    assert report.counts["R3"] == 0, "a near-miss within near-tol must not also be reported as dangling (R3)"


def test_far_gap_beyond_near_tol_trips_r3_not_r4(tmp_path):
    out = tmp_path / "dangling.dxf"
    _write_dxf(
        out,
        cuts=[
            ((0.0, 0.0), (10.0, 0.0)),
            ((10.05, 0.0), (10.0, 10.0)),  # 0.05in gap: well beyond near-tol(1e-3)
            ((10.0, 10.0), (0.0, 10.0)),
            ((0.0, 10.0), (0.0, 0.0)),
        ],
    )
    report = validate_dxf(out)
    assert report.counts["R3"] >= 1, "expected the 0.05in gap to trip R3 (dangling)"
    assert report.counts["R4"] == 0, "a gap beyond near-tol must not be reported as a butted near-miss (R4)"


def test_crease_midspan_t_junction_trips_r7_only(tmp_path):
    out = tmp_path / "t_junction.dxf"
    _write_dxf(
        out,
        cuts=[
            ((0.0, 0.0), (10.0, 0.0)),
            ((10.0, 0.0), (10.0, 10.0)),
            ((10.0, 10.0), (0.0, 10.0)),
            ((0.0, 10.0), (0.0, 0.0)),
        ],
        creases=[((5.0, 0.0), (5.0, 10.0))],  # both ends land mid-span, not at a cut vertex
    )
    report = validate_dxf(out)
    assert report.counts["R7"] == 2, "expected both crease endpoints to trip R7 (mid-span landing)"
    for rule in ("R1", "R2", "R3", "R4", "R5", "R6", "R9"):
        assert report.counts[rule] == 0, f"{rule} unexpectedly nonzero on an otherwise-clean closed rectangle: {[d.message for d in report.defects if d.rule == rule]}"
