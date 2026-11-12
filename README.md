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
| 1 | Core reporting, tickets, user PWA | complete |
| 2 | Driver login, routes, completion flow | complete |
| 3 | Live dispatch, SLA, rewards, wallet | complete |
| 4 | Hardening: retention, hashes, PWA, i18n | complete |
| 5 | Optional: retraining collection, blurring | optional collection available; blurring deferred |

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
npm run db:migrate
npm run seed:localities
npm run seed:drivers

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

The database is published on host port **5433** because a local PostgreSQL
install usually owns 5432. `.env.example` already uses 5433.

`npm run seed:localities` loads the fake sample areas in
`scripts/data/localities.sample.csv`. Replace that file with the real city
areas when they are supplied, then re-run the command; names are upserted.

`npm run seed:drivers` loads `scripts/data/drivers.sample.csv` and replaces each
driver's regular stop order. The sample logins are `ravi@overflowgo.local` and
`meera@overflowgo.local`, both with password `driver123` (development only).

The AI service can also run in Docker:

```bash
docker compose --profile ai up -d ai
```

## Citizen reporting (Phase 1)

The `/` portal is now the real citizen flow:

1. Tap **Report overflowing bin**; the camera opens straight away.
2. Take a live photo (no gallery picker), preview it, retake if needed, and add
   an optional note.
3. When the report is sent, it automatically gets a location fix. A precise GPS
   fix is preferred, but Wi-Fi/laptop locations are accepted; only a denied or
   unavailable location stops the send.
4. The photo is compressed to 1280 px JPEG in the browser, then uploaded with a
   `deviceId` and a `clientReportId`.
5. The API re-compresses, hashes the photo, calls the AI service and accepts
   only when visible overflow or loose garbage is detected. A clean bin on its
   own is rejected with a retake message. Reports within 5 m of an open ticket
   are merged instead of creating a second ticket.
6. If the network or AI service is unavailable, the report is saved in
   IndexedDB and retried automatically with the same idempotency key.

The result screen polls ticket status (`open` / `offered` / `assigned` /
`completed`). English and Hindi are both available from the header.

API endpoints added in this phase:

- `POST /api/reports` — multipart `photo`, `lat`, `lng`, `deviceId`, optional
  `note` and `clientReportId`.
- `GET /api/reports/:id` — report result plus current ticket status.
- `GET /api/photos/:filename` — stored report photo.

Reward safeguards are recorded at ticket creation: a report from a registered
driver phone sets `reward_eligible = false`, and online drivers within 150 m are
stored in `ticket_reward_exclusions`.

## Driver portal (Phase 2)

Open `/driver`, sign in with a seeded driver, and turn duty **Online**. The
driver PWA then:

1. Registers the browser's `deviceId` at login so reports from that device are
   not reward-eligible.
2. Sends a location heartbeat every `driverHeartbeatSeconds` (20 s by default,
   from the config file) and connects an authenticated Socket.IO channel.
3. Shows the route in the order required by the docs: stops with open tickets
   first, oldest report first, then the driver's regular stops in their seeded
   order. Each stop expands to a Leaflet map, report photo, note, report count
   and a Google Maps navigate link.
4. Updates live through `route:updated` whenever a report merges or is created
   in one of the driver's localities, or when a ticket is released.
5. Completes a job with a live after photo. The API accepts it only when the
   driver owns the ticket (or covers its locality), the photo is within
   `afterPhotoMaxDistanceMeters` (50 m), the AI clearly sees a bin
   (`bin_conf >= aiVerifyMinBinConf`), overflow and garbage confidence stay
   below the verify thresholds, and the image is not a reused photo (the
   citizen report image or an after photo already used on another job). A failed
   check leaves the ticket open so the driver can retake the photo.
6. Going offline releases assigned tickets back to `open` so another driver can
   pick them up.

Driver endpoints added in this phase:

- `POST /api/driver/login` — `email`, `password`, `deviceId` -> JWT + profile.
- `GET /api/driver/me` — restore a session.
- `POST /api/driver/online` — `{ online, lat?, lng? }`; going online requires a
  location.
- `POST /api/driver/location` — heartbeat coordinates.
- `GET /api/driver/route` — ordered stops with open tickets and photos.
- `POST /api/driver/tickets/:id/complete` — multipart `photo`, `lat`, `lng`.

Socket events: the client connects with `auth.token` and listens for
`route:updated`; it may also emit `location:update`.

## Live dispatch and rewards (Phase 3)

A new accepted report now starts the live job market:

1. The API fans out an offer to online, fresh (`driverStaleAfterSeconds`),
   non-full drivers within `geofenceRadiusKm` (3 km) of the ticket. Drivers whose
   regular route already covers the ticket's locality are skipped: in v1 the
   fixed route has no timetable, so “locality is on my route” is the proxy for
   “I will be there anyway”.
2. The pop-up shows the report photo, note, distance, reward and a
   `offerTimeoutSeconds` (30 s) countdown, and rings/vibrates the phone. The first
   accept wins: assignment is a single conditional update, so a second accept
   gets a `taken` response and the offer closes on the losing device.
3. If nobody accepts the first round the ticket expands once to
   `geofenceExpandedRadiusKm` (5 km). After that round it returns to `open` and
   sits at the front of the covering driver's route, oldest report first.
4. Accepting sets `assigned` and starts the `taskSlaMinutes` (45 min) clock. The
   route screen shows the remaining time. Missing the SLA releases the ticket,
   subtracts `acceptanceScorePenalty` from the late driver's acceptance score,
   and re-offers it to other drivers (never the late one).
5. A verified completion through an accepted pop-up pays
   `rewardPerExtraJob` (₹20), capped at `rewardDailyCapPerDriver` (₹300) per
   driver per day in the configured timezone. Route-stop completions, reports
   from driver devices and proximity-excluded drivers earn nothing.
6. **Van full** pauses pop-ups and prepends the configured `dumpYard` stop
   (`Municipal Dump Yard` in dev). Tapping **Van emptied** clears it and resumes
   offers. Going offline releases assigned tickets back to the market.

The dashboard shows today's completed jobs, today's extra earnings and the
wallet balance. Wallet history is available from `GET /api/driver/wallet`.

### Payouts

Rewards are tracked in `reward_ledger`; actual payouts happen outside the app.
Export verified rewards for a date range (inclusive, configured timezone) as
CSV:

```bash
npm run export:payouts -- --from 2026-11-01 --to 2026-11-30
npm run export:payouts -- --from 2026-11-01 --to 2026-11-30 --out payouts.csv
```

### Dispatch endpoints and events

- `POST /api/driver/offers/:id/respond` — `{ response: "accept" | "reject" }`;
  `409` when another driver won or the offer expired.
- `GET /api/driver/wallet` — balance, today's earnings/jobs, recent rewards.
- `POST /api/driver/van-full` / `POST /api/driver/van-emptied`.

Socket events: `offer:new`, `offer:closed` (`{ offerId, reason }`),
`ticket:released` (`{ ticketId }`) and `route:updated`. The API runs an SLA and
offer-expiry tick every 5 s.

The dispatch schema additions live in `apps/api/migrations/003_dispatch.sql`.

## Hardening (Phase 4)

### Photo retention

`apps/api/src/services/retention.ts` runs 10 seconds after startup and then
every 6 hours. Once a ticket has been `completed` for longer than
`photoRetentionDaysAfterClose` (7 days), it deletes the report photo files and
the after photo file and clears the stored paths. Report and completion rows
stay so counts and history still work. Optional training samples are pruned by
`retrainingRetentionDays` and `retrainingMaxSamples`.

### Duplicate and idempotent reports

- `clientReportId` makes report retries idempotent.
- Photos are re-encoded and reduced to a 64-bit difference hash. A new photo
  within `duplicatePhotoHashMaxDistance` (6 bits) of a report from the last 24
  hours is attached to that ticket instead of creating another, even if the GPS
  drift is more than the 5 m merge radius.
- Location merges still apply within `duplicateMergeRadiusMeters` (5 m).

### Web Push when the app is closed

Web Push is optional and off until VAPID keys are configured:

```bash
npx web-push generate-vapid-keys
# put the two values in .env:
# VAPID_PUBLIC_KEY=...
# VAPID_PRIVATE_KEY=...
# VAPID_SUBJECT=mailto:you@example.com
```

The driver dashboard then shows **Enable job alerts**. The browser subscribes,
the API stores it in `push_subscriptions`, and offers are sent through Web Push
only when that driver has no live socket connection. Tapping the notification
opens `/driver/route`. The service worker handlers live in
`apps/web/public/push-sw.js` and are injected into the generated PWA worker.

Endpoints: `GET /api/driver/push/key` (enabled flag + public key),
`POST /api/driver/push/subscribe`, `POST /api/driver/push/unsubscribe`.

### PWA install, language and accessibility

- The citizen page shows an **Install app** prompt when the browser fires
  `beforeinstallprompt`; “Not now” is remembered locally.
- English and Hindi strings cover the full citizen flow.
- Result screens use `aria-live`, permission problems use `role="alert"`, tap
  targets are large, and the language toggle has an accessible label.

### Load test

The script writes real tickets/offers, so it requires `--confirm`:

```bash
npm run load:test -- --confirm
npm run load:test -- --confirm --reports 200 --drivers 50 --duration 60
```

It creates temporary online drivers near the first seeded locality, sends
reports through the real API and AI service, keeps heartbeats running, prints
p50/p95 latency and deletes the temporary drivers afterwards. The default plan
matches the Phase 4 target of 200 reports/hour with 50 concurrent drivers.

## Optional training collection (Phase 5)

Retraining collection is implemented but **off by default**. Set
`retrainingCollection: true` in `config/app.config.json` to keep only photos
whose highest overflow/garbage confidence falls between `retrainingConfMin` and
`retrainingConfMax` (default 0.25–0.60). Samples go to
`uploads/training` with a row in `retraining_samples`, capped at
`retrainingMaxSamples` (500) and deleted after `retrainingRetentionDays` (30).
Nothing is uploaded anywhere; export the folder manually when retraining.

Face/number-plate blurring is not enabled: it needs a separate detector that is
not part of the owner's model, and it stays optional per the product docs.

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

`npm test` needs the database container running. The API test harness creates
and migrates `overflowgo_test` automatically and refuses to run against a
non-test database.

## Configuration

All tunable values live in [`config/app.config.json`](./config/app.config.json):
geofence radii, offer timeout, SLA, merge radius and photo-hash distance, AI
thresholds, rewards, retention, optional training collection, timezone and the
dump-yard location. The API validates the file at startup with Zod and refuses
to boot on invalid values.

Secrets and environment-specific settings live in `.env` (see `.env.example`).

## Data and privacy

- Citizens are never identified: only `deviceId`, GPS coordinates and photos.
- Driver locations are never exposed to citizens.
- Photos are deleted 7 days after ticket completion (retention cron, Phase 4).
- No admin portal: seed scripts, config files and a payout CSV export are the
  operational tools.
