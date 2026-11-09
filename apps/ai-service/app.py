"""OverflowGo AI service.

Wraps the owner's YOLO11s detector (`wastemap_bin_detector_v1.pt`) behind a
tiny FastAPI contract. The API server applies all accept/verify thresholds;
this service only reports per-class max confidence and raw detections.
"""

from __future__ import annotations

import io
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from ultralytics import YOLO

SERVICE_VERSION = "0.1.0"
DEFAULT_MODEL_PATH = (
    Path(__file__).resolve().parents[2]
    / "Model"
    / "detection model"
    / "wastemap_bin_detector_v1.pt"
)
MODEL_PATH = Path(os.environ.get("MODEL_PATH", str(DEFAULT_MODEL_PATH)))
PREDICT_CONF = float(os.environ.get("AI_PREDICT_CONF", "0.15"))
IMAGE_SIZE = int(os.environ.get("AI_IMAGE_SIZE", "640"))
MAX_UPLOAD_BYTES = int(os.environ.get("AI_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)))
CLASS_KEYS = {"garbage": "garbage_conf", "garbage_bin": "bin_conf", "overflow": "overflow_conf"}

_state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Model not found at {MODEL_PATH}. Set MODEL_PATH or copy the .pt file into Model/."
        )
    # .pt files are Python pickles: only ever load a model from the owner.
    _state["model"] = YOLO(str(MODEL_PATH))
    _state["names"] = _state["model"].names
    yield
    _state.clear()


app = FastAPI(title="OverflowGo AI Service", version=SERVICE_VERSION, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "overflowgo-ai",
        "version": SERVICE_VERSION,
        "model": MODEL_PATH.stem,
    }


def _predict(image: Image.Image) -> dict[str, Any]:
    model: YOLO = _state["model"]
    names: dict[int, str] = _state["names"]

    result = model.predict(image, imgsz=IMAGE_SIZE, conf=PREDICT_CONF, verbose=False)[0]
    best = {name: 0.0 for name in CLASS_KEYS}
    detections: list[dict[str, Any]] = []

    for box in result.boxes:
        class_name = str(names[int(box.cls)])
        confidence = float(box.conf)
        if class_name in best:
            best[class_name] = max(best[class_name], confidence)
        detections.append(
            {
                "class": class_name,
                "conf": confidence,
                "box": [float(value) for value in box.xyxy[0]],
            }
        )

    return {
        "overflow_conf": best["overflow"],
        "bin_conf": best["garbage_bin"],
        "garbage_conf": best["garbage"],
        "detections": detections,
    }


@app.post("/predict")
async def predict(image: UploadFile = File(...)) -> dict[str, Any]:
    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty image upload")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        parsed = Image.open(io.BytesIO(payload))
        parsed.load()
        rgb = ImageOps.exif_transpose(parsed).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid or corrupted image") from error

    return _predict(rgb)
