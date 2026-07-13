"""Phase 4 gate: the new DIMENSION/dimensions annotation layer must be purely
additive. `tests/golden/dieline_cuts_creases.json` was captured from the
pre-Phase-4 geometry code (verified byte-identical against git HEAD before
Phase 4's changes landed) across every implemented FEFCO style -- this test
proves the current code still produces exactly that cut/crease geometry, so
a future refactor that accidentally perturbs geometry math while touching
labels/annotations gets caught here, not by chance.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from dieline_core.geometry import append_reference_legend, build_dieline, build_dxf, build_svg

GOLDEN_PATH = Path(__file__).parent / "golden" / "dieline_cuts_creases.json"
GOLDEN = json.loads(GOLDEN_PATH.read_text())


@pytest.mark.parametrize("name", sorted(GOLDEN.keys()))
def test_cuts_and_creases_byte_identical_to_golden(name: str):
    fixture = GOLDEN[name]
    result = build_dieline(dict(fixture["spec"]))

    cuts = [dataclasses.asdict(s) for s in result.cuts]
    creases = [dataclasses.asdict(s) for s in result.creases]

    assert cuts == fixture["cuts"]
    assert creases == fixture["creases"]
    assert result.total_w == fixture["total_w"]
    assert result.total_h == fixture["total_h"]


@pytest.mark.parametrize("name", sorted(GOLDEN.keys()))
def test_reference_legend_never_touches_geometry(name: str):
    """append_reference_legend is supposed to be purely additive to
    `labels` -- proves it, rather than just asserting it in a docstring."""
    fixture = GOLDEN[name]
    result = build_dieline(dict(fixture["spec"]))
    with_legend = append_reference_legend(result, [("Ruler length", 7.3125), ("Hole diameter", 0.5)])

    assert [dataclasses.asdict(s) for s in with_legend.cuts] == fixture["cuts"]
    assert [dataclasses.asdict(s) for s in with_legend.creases] == fixture["creases"]
    assert with_legend.derived == result.derived
    assert with_legend.total_w == result.total_w
    assert with_legend.total_h == result.total_h
    assert len(with_legend.labels) == len(result.labels) + 2


def test_svg_has_named_cut_crease_dimension_groups():
    result = build_dieline(dict(GOLDEN["rsc_taped"]["spec"]))
    svg = build_svg(result)
    assert 'id="cut-lines"' in svg
    assert 'id="crease-lines"' in svg
    assert 'id="dimensions"' in svg
    # The pre-existing panel/glue/flap labels (computed but never drawn
    # before Phase 4) are now actually rendered.
    assert "<text" in svg


def test_dxf_has_cut_crease_dimension_layers():
    result = build_dieline(dict(GOLDEN["rsc_taped"]["spec"]))
    dxf_bytes = build_dxf(result)
    assert b"CUT" in dxf_bytes
    assert b"CREASE" in dxf_bytes
    assert b"DIMENSION" in dxf_bytes
    assert b"TEXT" in dxf_bytes


def test_reference_legend_appears_in_exported_svg_and_dxf():
    result = build_dieline(dict(GOLDEN["rsc_taped"]["spec"]))
    with_legend = append_reference_legend(result, [("Ruler length", 7.3125)])

    svg = build_svg(with_legend)
    assert "Ruler length" in svg

    dxf_bytes = build_dxf(with_legend)
    assert b"Ruler length" in dxf_bytes


def test_empty_reference_dimensions_is_a_no_op():
    result = build_dieline(dict(GOLDEN["rsc_taped"]["spec"]))
    same = append_reference_legend(result, [])
    assert same is result
