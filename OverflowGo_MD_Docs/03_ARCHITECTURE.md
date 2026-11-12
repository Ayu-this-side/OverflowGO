# Architecture

## Stack (defaults, since no preference given)
| Layer | Choice | Why |
|-------|--------|-----|
| Frontend (both portals) | React + Vite, PWA (service worker), Tailwind | One codebase, installable, camera + geolocation APIs |
| Backend API | Node.js + Express (TypeScript) | Simple, great Socket.IO support |
| Real-time | Socket.IO | Pop-ups, route updates, offer cancellation |
| Database | PostgreSQL + PostGIS | Geofence (`ST_DWithin`) and distance queries |
| AI service | Python FastAPI + `ultralytics` (YOLO11s detector, `wastemap_bin_detector_v1.pt`) | Isolates the model; CPU is enough |
| File storage | Local disk in dev, S3-compatible bucket in prod | Photos |
| Background jobs | `node-cron` or BullMQ (Redis optional) | SLA timers, retention, offline detection |
| Push when app closed | Web Push (VAPID) | Optional, phase 4 |
| Maps | Leaflet + OpenStreetMap | Free, no API key |

## Components
```
[User PWA] --photo+GPS--> [API (Express)] --image--> [AI service (FastAPI)]
                              |   ^                       |
                              |   +--- label+confidence --+
                              v
                        [PostgreSQL + PostGIS]
                              |
                  Socket.IO   v
[Driver PWA] <---- offers / route updates ---- [Dispatcher module]
```

## Repo layout
```
/apps/web            (single React app, routes: /  = user portal, /driver/* = driver portal)
/apps/api            (Express + Socket.IO + dispatcher + cron jobs)
/apps/ai-service     (FastAPI + model weights)
/packages/shared     (TypeScript types, constants)
/scripts             (seed-drivers, seed-localities, export-payouts)
/config/app.config.json
/docs                (these MD files)
```

## Configuration (`config/app.config.json`)
```json
{
  "geofenceRadiusKm": 3,
  "geofenceExpandedRadiusKm": 5,
  "offerTimeoutSeconds": 30,
  "taskSlaMinutes": 45,
  "duplicateMergeRadiusMeters": 25,
  "driverProximityNoRewardMeters": 150,
  "driverHeartbeatSeconds": 20,
  "driverStaleAfterSeconds": 60,
  "afterPhotoMaxDistanceMeters": 50,
  "aiOverflowThreshold": 0.65,
  "aiGarbageThreshold": 0.65,
  "aiBinThreshold": 0.65,
  "aiVerifyMinBinConf": 0.65,
  "aiVerifyMaxOverflowConf": 0.35,
  "aiVerifyMaxGarbageConf": 0.35,
  "afterPhotoReuseHashMaxDistance": 6,
  "afterPhotoReuseLookbackDays": 30,
  "rewardPerExtraJob": 20,
  "rewardDailyCapPerDriver": 300,
  "photoRetentionDaysAfterClose": 7,
  "skipOfferIfRouteDueWithinMinutes": 30
}
```

## Admin without a portal
- `npm run seed:localities` loads localities (name + center lat/lng) from a CSV.
- `npm run seed:drivers` creates drivers (email, temp password, vehicle) and their ordered regular route (`route_stops`).
- `npm run export:payouts -- --from 2026-11-01 --to 2026-11-30` writes a CSV of each driver's verified rewards. The municipality pays outside the app.
- Config changes happen by editing the config file and restarting the API.

## Security basics
- Driver passwords hashed with argon2/bcrypt, JWT access tokens with short expiry.
- Upload endpoint accepts images only, with a size cap (5 MB) and MIME check.
- HTTPS is required (camera and GPS APIs need a secure context).
