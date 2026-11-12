# AI threshold calibration

- Model: `wastemap_bin_detector_v1.pt` (19.2 MB)
- Task: `detect`
- Classes: `garbage, garbage_bin, overflow`
- Inference: imgsz=640, conf floor=0.15, CPU
- Positives: 172 (`Model/Dataset/Garbage`)
- Negatives: 23 (`Model/Dataset/Negatives`)

## Chosen thresholds

| Config key | Value |
|---|---|
| `aiOverflowThreshold` | 0.65 |
| `aiGarbageThreshold` | 0.65 |
| `aiVerifyMaxOverflowConf` | 0.35 |
| `aiVerifyMaxGarbageConf` | 0.35 |

## Accept threshold sweep (`max(overflow_conf, garbage_conf)`)

| Threshold | Positives accepted (TPR) | Negatives accepted (FPR) | Youden J |
|---|---|---|---|
| 0.30 | 99.4% | 30.4% | +0.69 |
| 0.35 | 99.4% | 26.1% | +0.73 |
| 0.40 | 99.4% | 21.7% | +0.78 |
| 0.45 | 98.8% | 13.0% | +0.86 |
| 0.50 | 98.8% | 13.0% | +0.86 |
| 0.55 | 96.5% | 8.7% | +0.88 |
| 0.60 | 94.8% | 4.3% | +0.90 |
| 0.65 (chosen) | 92.4% | 0.0% | +0.92 |
| 0.70 | 88.4% | 0.0% | +0.88 |
| 0.75 | 86.0% | 0.0% | +0.86 |
| 0.80 | 76.7% | 0.0% | +0.77 |
| 0.85 | 60.5% | 0.0% | +0.60 |
| 0.90 | 32.6% | 0.0% | +0.33 |

## Observed decisions at the chosen thresholds

- Positives accepted: **159/172** (92.4%)
- Negatives rejected as reports: **23/23** (100.0%)
- Positives with a visible bin: **22/172**
- Negatives with a visible bin: **12/23** (clean-bin shots should still show a bin for after-photo verification)

## Verify thresholds (after-photo check)

Clean images should have low overflow/garbage confidence. We use the 95th percentile of negative-image confidences, clamped to a sane band.

- `overflow_conf` p95 on negatives: 0.417
- `garbage_conf` p95 on negatives: 0.533
- Chosen overflow verify max: **0.35**
- Chosen garbage verify max: **0.35**

The verify check also requires `bin_conf >= aiVerifyMinBinConf` (0.65), so a photo of the sky, empty ground, or a blurry scene cannot pass as cleaned. The completion service additionally rejects a reused image: the citizen report photo for that ticket, or an after photo the same driver already used on another verified job within the configured lookback.

## Performance

- Average inference: 274.9 ms/image
- Worst case: 5271.1 ms/image

## Caveats

- The owner-provided positives carry a single `Garbage` label, not separate `overflow` vs `garbage` labels, so both accept thresholds are set to the same combined value.
- Negatives are openly licensed images downloaded from Wikimedia Commons; see `Model/Dataset/Negatives/LICENSES.md`. The set was manually curated: one photo containing garbage bags was removed. Re-run this script after adding more negatives (especially clean community bins in the deployment city).
- Domain shift matters: clean European wheelie bins in the negative set are sometimes detected as `garbage`/`overflow` with confidences up to ~0.61. The verify thresholds are therefore strict, and a real after-cleaning photo may need a retake. Collect in-domain clean-bin photos before launch.
- Thresholds are a starting point. Re-calibrate with real municipal photos before deploying.
