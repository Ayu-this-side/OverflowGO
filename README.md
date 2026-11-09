# OverflowGo

Demand-driven layer on top of a municipality's fixed garbage-collection route.

Citizens report overflowing bins with a live photo (no login). A YOLO11s
detector checks the photo; valid reports become tickets. Online drivers within a
3 km geofence get a pop-up and the first to accept wins an extra reward. Tickets
nobody serves live are moved to the front of the next route, oldest report
first.

Full product and design docs live in [`OverflowGo_MD_Docs/`](./OverflowGo_MD_Docs).

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, Docker, config, AI service, calibration | complete |
| 1 | Core reporting, tickets, user PWA | planned |
| 2 | Driver login, routes, completion flow | planned |
| 3 | Live dispatch, SLA, rewards, wallet | planned |
| 4 | Hardening: retention, hashes, PWA, i18n | planned |
| 5 | Optional: retraining collection, blurring | planned |

## Stack

- **Web:** React + Vite + Tailwind, single PWA for `/` (citizen) and `/driver/*`.
- **API:** Node.js + Express + Socket.IO (TypeScript).
- **Database:** PostgreSQL + PostGIS.
- **AI:** Python FastAPI + Ultralytics YOLO11s (`wastemap_bin_detector_v1.pt`).
- **Maps:** Leaflet + OpenStreetMap.
- **Storage:** local disk in dev, S3-compatible in production.

## Repository layout

```
apps/web                 React PWA (citizen + driver portals)
apps/api                 Express API, Socket.IO, dispatch, cron jobs
apps/ai-service          FastAPI wrapper + calibration tooling
packages/shared          Shared TypeScript types and constants
scripts                  Seed and payout CLI scripts (later phases)
config/app.config.json   Every tunable number lives here
Model                    Detector weights and calibration photos
OverflowGo_MD_Docs       Product and design documentation
```

## Prerequisites

- Node.js 20+ (tested on 24) and npm 10+
- Python 3.11+ (tested on 3.13)
- Docker Desktop with Docker Compose
- A secure context for camera/GPS in real use (HTTPS or `localhost`)

## Quick start

```bash
# 1. Install JS dependencies
npm install

# 2. Environment
cp .env.example .env

# 3. Database (Postgres 16 + PostGIS 3.4)
npm run db:up

# 4. AI service (native, CPU)
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r apps/ai-service/requirements.txt
npm run ai:dev

# 5. API + web (two terminals, or npm run dev for both)
npm run dev
```

- Web: http://localhost:5173
- API health: http://localhost:4000/api/health
- AI health: http://localhost:8000/health

The AI service can also run in Docker:

```bash
docker compose --profile ai up -d ai
```

## Calibration

The accept/verify thresholds are calibrated, not guessed:

```bash
# Optional: download openly licensed negatives if none are present
python apps/ai-service/scripts/download_negatives.py --per-category 10

# Run the detector over positives + negatives and write CALIBRATION.md
python apps/ai-service/scripts/calibrate.py
```

Outputs:

- `apps/ai-service/CALIBRATION.md` — distributions, sweep table, chosen values.
- `apps/ai-service/calibration-results.csv` — per-image raw confidences.
- Update `config/app.config.json` with the recommended thresholds.

Phase 0 result (172 positives, 23 curated negatives): accept `0.65` for both
`overflow` and `garbage` (92.4% of positives accepted, 0 negatives accepted),
verify max `0.35` for both. The report documents a domain-shift limitation:
clean wheelie bins are sometimes scored as garbage/overflow, so verification is
strict and in-domain after-cleaning photos are still needed.

The detector weights are the owner's and must only ever be loaded from this
repository; `.pt` files are Python pickles.

## Tests

```bash
npm run typecheck
npm test

# AI service (model tests are opt-in because loading the detector is slow)
cd apps/ai-service
pip install -r requirements-dev.txt
RUN_MODEL_TESTS=1 pytest
```

## Configuration

All tunable values live in [`config/app.config.json`](./config/app.config.json):
geofence radii, offer timeout, SLA, merge radius, AI thresholds, rewards,
retention, timezone and the dump-yard location. The API validates the file at
startup with Zod and refuses to boot on invalid values.

Secrets and environment-specific settings live in `.env` (see `.env.example`).

## Data and privacy

- Citizens are never identified: only `deviceId`, GPS coordinates and photos.
- Driver locations are never exposed to citizens.
- Photos are deleted 7 days after ticket completion (retention cron, Phase 4).
- No admin portal: seed scripts, config files and a payout CSV export are the
  operational tools.
