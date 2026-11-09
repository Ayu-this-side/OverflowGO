#!/usr/bin/env python3
"""Run the detector over positives and negatives, then pick thresholds.

Outputs:
  - apps/ai-service/calibration-results.csv (per-image confidences)
  - apps/ai-service/CALIBRATION.md (summary + chosen thresholds)

Usage:
    python scripts/calibrate.py
    python scripts/calibrate.py --positives Model/Dataset/Garbage --negatives Model/Dataset/Negatives
"""

from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

from PIL import Image, ImageOps
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODEL = ROOT / "Model" / "detection model" / "wastemap_bin_detector_v1.pt"
DEFAULT_POSITIVES = ROOT / "Model" / "Dataset" / "Garbage"
DEFAULT_NEGATIVES = ROOT / "Model" / "Dataset" / "Negatives"
OUT_CSV = ROOT / "apps" / "ai-service" / "calibration-results.csv"
OUT_MD = ROOT / "apps" / "ai-service" / "CALIBRATION.md"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
PREDICT_CONF = 0.15
IMAGE_SIZE = 640


def collect_images(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(
        path for path in folder.rglob("*") if path.suffix.lower() in IMAGE_SUFFIXES
    )


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = (len(ordered) - 1) * p
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    weight = index - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def predict(model: YOLO, path: Path) -> dict[str, float | str]:
    image = Image.open(path)
    image.load()
    image = ImageOps.exif_transpose(image).convert("RGB")
    started = time.perf_counter()
    result = model.predict(image, imgsz=IMAGE_SIZE, conf=PREDICT_CONF, verbose=False)[0]
    elapsed_ms = (time.perf_counter() - started) * 1000

    best = {"garbage": 0.0, "garbage_bin": 0.0, "overflow": 0.0}
    names = model.names
    for box in result.boxes:
        name = str(names[int(box.cls)])
        if name in best:
            best[name] = max(best[name], float(box.conf))

    return {
        "overflow_conf": round(best["overflow"], 4),
        "bin_conf": round(best["garbage_bin"], 4),
        "garbage_conf": round(best["garbage"], 4),
        "latency_ms": round(elapsed_ms, 1),
    }


def sweep(positives: list[float], negatives: list[float]) -> list[dict[str, float]]:
    rows = []
    for step in range(30, 91, 5):
        threshold = step / 100
        tpr = (
            sum(1 for value in positives if value >= threshold) / len(positives)
            if positives
            else 0.0
        )
        fpr = (
            sum(1 for value in negatives if value >= threshold) / len(negatives)
            if negatives
            else 0.0
        )
        rows.append(
            {
                "threshold": threshold,
                "tpr": tpr,
                "fpr": fpr,
                "youden": tpr - fpr,
            }
        )
    return rows


def choose_accept_threshold(rows: list[dict[str, float]]) -> dict[str, float]:
    # Prefer the accepted band from the docs (0.35-0.65). Maximise Youden J.
    band = [row for row in rows if 0.35 <= row["threshold"] <= 0.65] or rows
    return max(band, key=lambda row: (row["youden"], row["threshold"]))


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def write_report(
    path: Path,
    model_path: Path,
    positives: list[dict],
    negatives: list[dict],
    accept_row: dict[str, float],
    verify_overflow: float,
    verify_garbage: float,
    model: YOLO,
) -> None:
    pos_scores = [max(row["overflow_conf"], row["garbage_conf"]) for row in positives]
    neg_scores = [max(row["overflow_conf"], row["garbage_conf"]) for row in negatives]
    rows = sweep(pos_scores, neg_scores)
    latencies = [row["latency_ms"] for row in positives + negatives]
    chosen = accept_row["threshold"]

    pos_accepted = sum(1 for value in pos_scores if value >= chosen)
    neg_rejected = sum(1 for value in neg_scores if value < chosen)
    pos_bin = sum(1 for row in positives if row["bin_conf"] > 0)
    neg_bin = sum(1 for row in negatives if row["bin_conf"] > 0)

    lines = [
        "# AI threshold calibration",
        "",
        f"- Model: `{model_path.name}` ({model_path.stat().st_size / 1_000_000:.1f} MB)",
        f"- Task: `{getattr(model, 'task', 'detect')}`",
        f"- Classes: `{', '.join(str(name) for name in model.names.values())}`",
        f"- Inference: imgsz={IMAGE_SIZE}, conf floor={PREDICT_CONF}, CPU",
        f"- Positives: {len(positives)} (`Model/Dataset/Garbage`)",
        f"- Negatives: {len(negatives)} (`Model/Dataset/Negatives`)",
        "",
        "## Chosen thresholds",
        "",
        "| Config key | Value |",
        "|---|---|",
        f"| `aiOverflowThreshold` | {chosen:.2f} |",
        f"| `aiGarbageThreshold` | {chosen:.2f} |",
        f"| `aiVerifyMaxOverflowConf` | {verify_overflow:.2f} |",
        f"| `aiVerifyMaxGarbageConf` | {verify_garbage:.2f} |",
        "",
        "## Accept threshold sweep (`max(overflow_conf, garbage_conf)`)",
        "",
        "| Threshold | Positives accepted (TPR) | Negatives accepted (FPR) | Youden J |",
        "|---|---|---|---|",
    ]

    for row in rows:
        marker = " (chosen)" if abs(row["threshold"] - chosen) < 1e-9 else ""
        lines.append(
            f"| {row['threshold']:.2f}{marker} | {row['tpr'] * 100:.1f}% | "
            f"{row['fpr'] * 100:.1f}% | {row['youden']:+.2f} |"
        )

    lines += [
        "",
        "## Observed decisions at the chosen thresholds",
        "",
        f"- Positives accepted: **{pos_accepted}/{len(positives)}** "
        f"({(pos_accepted / len(positives) * 100) if positives else 0:.1f}%)",
        f"- Negatives rejected as reports: **{neg_rejected}/{len(negatives)}** "
        f"({(neg_rejected / len(negatives) * 100) if negatives else 0:.1f}%)",
        f"- Positives with a visible bin: **{pos_bin}/{len(positives)}**",
        f"- Negatives with a visible bin: **{neg_bin}/{len(negatives)}** "
        "(clean-bin shots should still show a bin for after-photo verification)",
        "",
        "## Verify thresholds (after-photo check)",
        "",
        "Clean images should have low overflow/garbage confidence. We use the "
        "95th percentile of negative-image confidences, clamped to a sane band.",
        "",
        f"- `overflow_conf` p95 on negatives: {percentile([r['overflow_conf'] for r in negatives], 0.95):.3f}",
        f"- `garbage_conf` p95 on negatives: {percentile([r['garbage_conf'] for r in negatives], 0.95):.3f}",
        f"- Chosen overflow verify max: **{verify_overflow:.2f}**",
        f"- Chosen garbage verify max: **{verify_garbage:.2f}**",
        "",
        "The verify check also requires `bin_conf > 0`, so a photo of the sky or "
        "empty ground cannot pass as cleaned.",
        "",
        "## Performance",
        "",
        f"- Average inference: {sum(latencies) / len(latencies):.1f} ms/image"
        if latencies
        else "- No images measured",
        f"- Worst case: {max(latencies):.1f} ms/image" if latencies else "",
        "",
        "## Caveats",
        "",
        "- The owner-provided positives carry a single `Garbage` label, not separate "
        "`overflow` vs `garbage` labels, so both accept thresholds are set to the "
        "same combined value.",
        "- Negatives are openly licensed images downloaded from Wikimedia Commons; "
        "see `Model/Dataset/Negatives/LICENSES.md`. The set was manually curated: one "
        "photo containing garbage bags was removed. Re-run this script after adding "
        "more negatives (especially clean community bins in the deployment city).",
        "- Domain shift matters: clean European wheelie bins in the negative set are "
        "sometimes detected as `garbage`/`overflow` with confidences up to ~0.61. The "
        "verify thresholds are therefore strict, and a real after-cleaning photo may "
        "need a retake. Collect in-domain clean-bin photos before launch.",
        "- Thresholds are a starting point. Re-calibrate with real municipal photos "
        "before deploying.",
        "",
    ]

    path.write_text("\n".join(line for line in lines if line is not None), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--positives", type=Path, default=DEFAULT_POSITIVES)
    parser.add_argument("--negatives", type=Path, default=DEFAULT_NEGATIVES)
    parser.add_argument("--out-csv", type=Path, default=OUT_CSV)
    parser.add_argument("--out-md", type=Path, default=OUT_MD)
    args = parser.parse_args()

    if not args.model.exists():
        print(f"Model not found: {args.model}")
        return 1

    positive_paths = collect_images(args.positives)
    negative_paths = collect_images(args.negatives)
    if not positive_paths:
        print(f"No positive images found in {args.positives}")
        return 1

    print(f"Loading {args.model.name} ...")
    model = YOLO(str(args.model))

    results: list[dict] = []
    for label, paths in (("positive", positive_paths), ("negative", negative_paths)):
        print(f"Running {len(paths)} {label} images ...")
        for index, path in enumerate(paths, start=1):
            try:
                prediction = predict(model, path)
            except (OSError, ValueError) as error:
                print(f"  skip {path.name}: {error}")
                continue
            results.append(
                {
                    "label": label,
                    "category": path.parent.name,
                    "file": str(path.relative_to(ROOT)).replace("\\", "/"),
                    **prediction,
                }
            )
            if index % 25 == 0:
                print(f"  {index}/{len(paths)}")

    positives = [row for row in results if row["label"] == "positive"]
    negatives = [row for row in results if row["label"] == "negative"]

    args.out_csv.parent.mkdir(parents=True, exist_ok=True)
    with args.out_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)

    pos_scores = [max(row["overflow_conf"], row["garbage_conf"]) for row in positives]
    neg_scores = [max(row["overflow_conf"], row["garbage_conf"]) for row in negatives]
    accept_row = choose_accept_threshold(sweep(pos_scores, neg_scores))
    verify_overflow = clamp(percentile([row["overflow_conf"] for row in negatives], 0.95), 0.15, 0.35)
    verify_garbage = clamp(percentile([row["garbage_conf"] for row in negatives], 0.95), 0.15, 0.35)

    write_report(
        args.out_md,
        args.model,
        positives,
        negatives,
        accept_row,
        verify_overflow,
        verify_garbage,
        model,
    )
    print(f"Wrote {args.out_csv}")
    print(f"Wrote {args.out_md}")
    print(
        "Recommended: aiOverflowThreshold={:.2f}, aiGarbageThreshold={:.2f}, "
        "aiVerifyMaxOverflowConf={:.2f}, aiVerifyMaxGarbageConf={:.2f}".format(
            accept_row["threshold"], accept_row["threshold"], verify_overflow, verify_garbage
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
