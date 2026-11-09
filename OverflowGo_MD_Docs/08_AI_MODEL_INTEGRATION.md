# AI Model Integration

## What the model actually is (verified by inspecting `wastemap_bin_detector_v1.pt`)
| Property | Value |
|----------|-------|
| Framework | PyTorch, saved as an **Ultralytics YOLO11s** checkpoint (`best.pt` style) |
| Task | **Object detection** (not whole-image classification) |
| Classes | `0: garbage`, `1: garbage_bin`, `2: overflow` |
| Input size | 640 x 640 |
| Training | 50 epochs, batch 16, AdamW, dataset `rubbish-bin--1` |
| Validation (from checkpoint) | precision 0.88, recall 0.86, mAP50 0.92, mAP50-95 0.74 |
| File size | about 19 MB |

Not yet done: the model has not been run on real photos, only its metadata was read. The agent must test it (see "First task" below).

Class meanings (confirmed by the owner): `overflow` = a visibly overflowing bin, `garbage` = loose garbage on the ground, `garbage_bin` = a bin in any state.

## Load it
```bash
pip install ultralytics
```
```python
from ultralytics import YOLO
model = YOLO("wastemap_bin_detector_v1.pt")   # load once at startup
results = model.predict(source=image_bytes_as_PIL, imgsz=640, conf=0.25, verbose=False)
```
Security: `.pt` files are Python pickles. Only load files from the owner. Never load models uploaded by users.

## Service contract (kept simple for the API)
`POST /predict` (multipart field `image`) returns:
```json
{
  "overflow_conf": 0.84,
  "bin_conf": 0.93,
  "garbage_conf": 0.40,
  "detections": [
    { "class": "overflow", "conf": 0.84, "box": [x1, y1, x2, y2] },
    { "class": "garbage_bin", "conf": 0.93, "box": [x1, y1, x2, y2] }
  ]
}
```
- Each `*_conf` is the **highest confidence** among detections of that class, or `0.0` if none.
- `GET /health` returns `{ "ok": true, "model": "wastemap_bin_detector_v1" }`.

## FastAPI sketch
```python
from fastapi import FastAPI, UploadFile
from PIL import Image
import io
from ultralytics import YOLO

app = FastAPI()
model = YOLO(MODEL_PATH)
NAMES = model.names  # {0:'garbage', 1:'garbage_bin', 2:'overflow'}

@app.post("/predict")
async def predict(image: UploadFile):
    img = Image.open(io.BytesIO(await image.read())).convert("RGB")
    r = model.predict(img, imgsz=640, conf=0.15, verbose=False)[0]
    best = {"garbage": 0.0, "garbage_bin": 0.0, "overflow": 0.0}
    dets = []
    for b in r.boxes:
        name = NAMES[int(b.cls)]
        c = float(b.conf)
        best[name] = max(best[name], c)
        dets.append({"class": name, "conf": c, "box": [float(v) for v in b.xyxy[0]]})
    return {"overflow_conf": best["overflow"], "bin_conf": best["garbage_bin"],
            "garbage_conf": best["garbage"], "detections": dets}
```
Read class names from `model.names`; never hardcode the index order.

## Decision rules (in the API, config-driven, no human review queue)
Both `overflow` and `garbage` count as a valid report. `garbage_bin` alone does not.

**Report check (citizen photo):**
- Accept if `overflow_conf >= aiOverflowThreshold` **OR** `garbage_conf >= aiGarbageThreshold` (both start at 0.50).
- Otherwise reject with: "We couldn't find an overflowing bin or garbage in this photo. Please retake it." plus a Retake button.
- If nothing at all is detected (no bin, no garbage, no overflow), use: "We couldn't see a bin or garbage in this photo. Please move closer and retake."
- Store which class triggered the accept (`overflow`, `garbage`, or `both`) on the report.

**After-photo check (driver completion):**
- Verified only if **all** are true:
  - `overflow_conf < aiVerifyMaxOverflowConf` (start 0.25)
  - `garbage_conf < aiVerifyMaxGarbageConf` (start 0.25)
  - a bin is visible (`bin_conf > 0`), so a photo of the sky or the ground cannot pass as "cleaned"
- The verify side uses lower thresholds than the accept side on purpose. A half-cleaned spot should not pass.

The thresholds are starting points. The first task below calibrates them.

## First task for the AI agent: test and calibrate
1. Collect 30-50 real photos: overflowing bins, normal bins, empty bins, bins after cleaning, non-bin scenes. Ask the owner for them (the original validation set works).
2. Run the model, then print per-photo `overflow_conf`, `garbage_conf`, `bin_conf`.
3. Pick `aiOverflowThreshold`, `aiGarbageThreshold`, `aiVerifyMaxOverflowConf` and `aiVerifyMaxGarbageConf` that give few false accepts and few false rejects. Write results to `apps/ai-service/CALIBRATION.md`.
4. Add a small test that checks known photos give the expected accept/reject decision.

## Performance and memory
- The model is about 19 MB and small enough for CPU. Expect roughly 100-400 ms per photo on a normal server CPU. No GPU needed.
- Load once per process. Run one worker per CPU core.
- Photos are compressed on the client and stored at about 150-300 KB. A retention job deletes photo files 7 days after a ticket is completed.

## Failure handling
- AI service down or over 5 s: return 503 and keep the report queued on the client. Never auto-accept without a check.
- Corrupted or non-image upload: reject with 400 before calling the model.

## Retraining (optional, OFF by default, not part of v1)
If `retrainingCollection: true` is enabled later:
- Save only photos where the highest of `overflow_conf` and `garbage_conf` is between 0.25 and 0.60 (the uncertain zone).
- Cap at 500 images, auto-delete after 30 days, and export manually when retraining.
- Nothing else is kept.
