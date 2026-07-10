"""Tests for glued joint tab width and tab-excluded blank measurements."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from dieline_core.geometry import build_dieline
from dieline_core.scoring import joint_spec_label
from dieline_core.solver import Measurements, solve_measurements
from main import app

client = TestClient(app)

RSC_BODY = {
    "fefco_code": "0201",
    "length": 12,
    "width": 9,
    "height": 4,
    "caliper": 0.1563,
    "flute": "C",
    "units": "in",
}


def test_build_dieline_defaults_to_glued_joint():
    taped = build_dieline({**RSC_BODY, "joint": "taped"})
    default_joint = build_dieline(RSC_BODY)
    assert default_joint.ok and taped.ok
    assert default_joint.total_w == pytest.approx(taped.total_w + 1.5)


def test_glued_dxf_one_half_inch_wider_than_taped():
    taped = build_dieline({**RSC_BODY, "joint": "taped"})
    glued = build_dieline({**RSC_BODY, "joint": "glued", "tab_width": 1.5})
    assert taped.ok and glued.ok
    assert glued.total_w == pytest.approx(taped.total_w + 1.5)


def test_solve_rsc_glued_blank_excludes_tab():
    """Body width 42.625 + tab → glued blank; measure body only with excludes flag."""
    result = solve_measurements(
        Measurements(
            blank_w=42.625,
            blank_h=13.625,
            flap_h=4.625,
            blank_w_excludes_tab=True,
        ),
        flute="C",
        joint="glued",
        style="rsc",
        tab_width=1.5,
    )
    assert result is not None
    assert result.joint == "glued"
    assert result.length == pytest.approx(12)
    assert result.width == pytest.approx(9)
    assert result.depth == pytest.approx(4)
    assert result.predicted_blank_w == pytest.approx(42.625 + 1.5)
    assert "glued" in result.to_dict()["joint_label"]


def test_joint_spec_label_includes_tab_width():
    label = joint_spec_label("glued", 1.5)
    assert "glued" in label
    assert "1.5" in label
    assert "Artios" in label


def test_api_solve_glued_joint_label():
    response = client.post(
        "/api/dieline/solve",
        json={
            "flute": "C",
            "style": "rsc",
            "joint": "glued",
            "blank_w": 42.625,
            "blank_h": 13.625,
            "flap_h": 4.625,
            "blank_w_excludes_tab": True,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["joint"] == "glued"
    assert "glued" in body["joint_label"]
    assert body["tab_width"] == pytest.approx(1.5)
