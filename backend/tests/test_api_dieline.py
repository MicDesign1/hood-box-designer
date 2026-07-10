"""API integration: solve -> generate -> export for RSC, HSC, and tube."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

RSC_SOLVE = {
    "flute": "C",
    "style": "rsc",
    "joint": "taped",
    "panel_d": 4.375,
    "panel_1": 12.125,
    "panel_2": 9.1875,
}

HSC_SOLVE = {
    "flute": "C",
    "style": "hsc",
    "joint": "taped",
    "panel_d": 6.1875,
    "panel_1": 10.125,
    "panel_2": 8.1875,
}

TUBE_SOLVE = {
    "flute": "C",
    "style": "tube",
    "blank_h": 4.0,
    "panel_1": 14.125,
    "panel_2": 10.1875,
}


def _solve(payload: dict) -> dict:
    response = client.post("/api/dieline/solve", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["confidence"] in ("high", "medium")
    return body


def _generate_payload(solved: dict) -> dict:
    fefco = {"rsc": "0201", "hsc": "hsc", "tube": "tube"}[solved["style"]]
    caliper = {"B": 0.125, "C": 0.1563, "BC": 0.2813}[solved["flute"]]
    payload = {
        "fefco_code": fefco,
        "length": solved["L"],
        "width": solved["W"],
        "height": solved["D"],
        "caliper": caliper,
        "units": "in",
        "flute_type": solved["flute"],
        "joint": solved["joint"],
    }
    if solved["joint"] == "glued":
        payload["tab_width"] = solved.get("tab_width", 1.5)
    return payload


@pytest.mark.parametrize(
    ("solve_payload", "expected_dims"),
    [
        (RSC_SOLVE, (12.0, 9.0, 4.0)),
        (HSC_SOLVE, (10.0, 8.0, 6.0)),
        (TUBE_SOLVE, (14.0, 10.0, 4.0)),
    ],
)
def test_solve_generate_export_round_trip(solve_payload: dict, expected_dims: tuple[float, float, float]):
    solved = _solve(solve_payload)
    assert solved["L"] == pytest.approx(expected_dims[0])
    assert solved["W"] == pytest.approx(expected_dims[1])
    assert solved["D"] == pytest.approx(expected_dims[2])

    gen_payload = _generate_payload(solved)
    gen = client.post("/api/dieline/generate", json=gen_payload)
    assert gen.status_code == 200, gen.text
    gen_body = gen.json()
    assert gen_body["generated"] is True
    assert gen_body["geometry"] is not None
    assert len(gen_body["geometry"]["cuts"]) > 0
    assert gen_body["svg"]

    dxf = client.post("/api/dieline/export/dxf", json=gen_payload)
    assert dxf.status_code == 200, dxf.text
    assert dxf.headers["content-type"] == "application/dxf"
    content = dxf.content
    assert len(content) > 100
    assert b"SECTION" in content or b"ENTITIES" in content
