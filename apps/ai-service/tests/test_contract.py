"""Small contract test for the AI service.

Runs the real model, so it is skipped unless RUN_MODEL_TESTS=1.

    RUN_MODEL_TESTS=1 pytest tests/test_contract.py
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import app

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "Model" / "Dataset" / "Garbage" / "Garbage_bin_0001.jpg"
pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_MODEL_TESTS") != "1",
    reason="set RUN_MODEL_TESTS=1 to load the detector",
)


def test_health_and_predict() -> None:
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["ok"] is True

        with SAMPLE.open("rb") as handle:
            response = client.post(
                "/predict", files={"image": ("sample.jpg", handle, "image/jpeg")}
            )

    assert response.status_code == 200
    body = response.json()
    for key in ("overflow_conf", "bin_conf", "garbage_conf", "detections"):
        assert key in body
    assert 0.0 <= body["overflow_conf"] <= 1.0
    assert 0.0 <= body["garbage_conf"] <= 1.0
