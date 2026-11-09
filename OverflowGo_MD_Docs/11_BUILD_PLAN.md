# Build Plan and Rules for the AI Agent

## How to use these docs
Read `01` to `10` fully before writing code. If anything conflicts, `10_EDGE_CASES.md` ("removed by the owner") and `02_REQUIREMENTS.md` ("Out of scope") win. Ask the owner if something is unclear, never invent features.

## Rules
1. Build **only two portals** (user and driver) in one React app. No admin portal.
2. Do not add citizen login, OTP, CAPTCHA, rate limiting, bin pre-registration, or QR codes.
3. Do not retrain or modify the owner's model (a YOLO11s detector). Wrap it in the FastAPI service.
4. All tunable numbers must come from `config/app.config.json`, never hardcoded.
5. Keep the AI service replaceable, with the API only calling `POST /predict`.
6. Write tests for dispatch (first-accept-wins, SLA release, route ordering, merge radius).
7. Provide a README with local setup (Docker Compose for Postgres/PostGIS, API, AI service, web).
8. Commit after each phase and note what was completed.

## Phases

### Phase 0: Setup
- Monorepo, Docker Compose (Postgres + PostGIS), config file, shared types.
- Load `wastemap_bin_detector_v1.pt` with `ultralytics`, run it on sample photos, and write `CALIBRATION.md` with chosen thresholds (see `08`).

### Phase 1: Core reporting
- Database migrations (`04`).
- AI service `/predict` + `/health`.
- `POST /api/reports` with compression, AI check, merge/create ticket.
- User portal screens (`06`) with live camera, GPS, result states, offline queue.
- Acceptance: a photo showing an overflowing bin or loose garbage creates a ticket, and a clean bin is rejected with a retake option.

### Phase 2: Driver basics and route ordering
- Driver login, device registration, Online/Offline, heartbeat.
- Seed scripts for localities, drivers, and routes.
- Route computation (`09` section 5) and Route screen with live updates.
- Complete-job flow with the after-photo check.
- Acceptance: scenario `A,B,C,D` becomes `C,B,A,D` and then `C,B,D,A`.

### Phase 3: Live dispatch and rewards
- Geofence query, offers, Socket.IO pop-ups, Accept/Reject/Ignore, atomic assignment.
- Radius expansion, SLA cron, van-full flow.
- Reward ledger, daily cap, wallet screen, payout CSV export script.
- Self-report rules (driver-device and 150 m proximity).
- Acceptance: with 5 online drivers in range, all 5 get the pop-up, exactly one wins, the others' pop-ups close.

### Phase 4: Hardening
- Retention cron (photo deletion), perceptual-hash duplicate check, idempotency keys.
- Optional Web Push for closed apps.
- Hindi/English strings, basic accessibility, PWA install prompts.
- Load test: 200 reports/hour and 50 concurrent drivers.

### Phase 5: Optional
- Retraining collection flag (off by default).
- Face/number-plate blurring.

## Definition of done (v1)
- Citizen can report without login and get a clear result.
- Invalid reports never reach drivers.
- Drivers get pop-ups in the geofence, first accept wins, route reorders correctly.
- Rewards are paid only for verified completions, and the self-report cases are blocked.
- Everything is runnable with one `docker compose up` plus a seed command.
