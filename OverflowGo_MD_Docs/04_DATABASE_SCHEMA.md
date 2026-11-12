# Database Schema (PostgreSQL + PostGIS)

Enable: `CREATE EXTENSION postgis;`

## localities
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | "A", "B", ... |
| center | geography(Point) | Used to assign tickets to the nearest locality |

## drivers
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | |
| email | text unique | login |
| password_hash | text | |
| phone | text | |
| vehicle_no | text | |
| is_online | boolean | default false |
| last_location | geography(Point) | updated by heartbeat |
| last_ping_at | timestamptz | stale if older than 60 s |
| van_full | boolean | default false |
| acceptance_score | numeric | decreases when SLA is missed |
| created_at | timestamptz | |

## driver_devices
Registered when a driver logs in. Used to detect self-reporting from a driver's own phone.
| Column | Type |
|--------|------|
| id | uuid PK |
| driver_id | uuid FK drivers |
| device_id | text (random UUID stored in the PWA's localStorage) |

## route_stops (the regular fixed route)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| driver_id | uuid FK | |
| locality_id | uuid FK | |
| position | int | 1, 2, 3 ... regular order |
| unique(driver_id, position) | | |

## tickets
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| locality_id | uuid FK | nearest locality center |
| location | geography(Point) | from the first valid report |
| status | enum | `open`, `offered`, `assigned`, `completed` |
| report_count | int | merged duplicates |
| first_reported_at | timestamptz | drives route priority |
| assigned_driver_id | uuid FK null | |
| assigned_at | timestamptz null | |
| sla_deadline | timestamptz null | `assigned_at + 45 min` |
| completed_at | timestamptz null | |
| reward_eligible | boolean | default true. False if the self-report rule triggers |
| flag_reason | text null | e.g. `driver_nearby`, `driver_device` |
| created_at | timestamptz | |

Index: GIST on `location`; btree on `(status, first_reported_at)`.

## reports
Every accepted or rejected submission, including merged ones.
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ticket_id | uuid FK null | null if rejected |
| photo_path | text null | deleted by retention job |
| note | text null | |
| location | geography(Point) | |
| device_id | text | |
| ai_overflow_conf | numeric | highest `overflow` detection confidence (0 if none) |
| ai_garbage_conf | numeric | highest `garbage` detection confidence (0 if none) |
| ai_bin_conf | numeric | highest `garbage_bin` detection confidence (0 if none) |
| ai_trigger | text null | `overflow`, `garbage` or `both` (what made the report valid) |
| result | enum | `accepted`, `rejected`, `merged` |
| reject_reason | text null | |
| created_at | timestamptz | server time |

## offers
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ticket_id | uuid FK | |
| driver_id | uuid FK | |
| sent_at | timestamptz | |
| response | enum | `accepted`, `rejected`, `ignored`, `expired`, `taken_by_other` |
| responded_at | timestamptz null | |

## completions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| ticket_id | uuid FK unique | |
| driver_id | uuid FK | |
| after_photo_path | text null | |
| photo_hash | text null | 64-bit dHash; reused photos are rejected |
| location | geography(Point) | |
| ai_overflow_conf | numeric | must be below `aiVerifyMaxOverflowConf` to verify |
| ai_garbage_conf | numeric | must be below `aiVerifyMaxGarbageConf` to verify |
| ai_bin_conf | numeric | must reach `aiVerifyMinBinConf` to verify |
| verified | boolean | |
| created_at | timestamptz | |

## reward_ledger
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| driver_id | uuid FK | |
| ticket_id | uuid FK unique | one reward per ticket |
| amount | numeric | |
| created_at | timestamptz | |

## Key queries
- Drivers in geofence: `SELECT id FROM drivers WHERE is_online AND NOT van_full AND last_ping_at > now() - interval '60 seconds' AND ST_DWithin(last_location, :ticket_point, 3000);`
- Duplicate check: `SELECT id FROM tickets WHERE status <> 'completed' AND ST_DWithin(location, :point, 25) ORDER BY created_at LIMIT 1;`
- First-accept-wins: `UPDATE tickets SET status='assigned', assigned_driver_id=:d, assigned_at=now(), sla_deadline=now()+interval '45 minutes' WHERE id=:t AND status IN ('open','offered') RETURNING id;` (zero rows means someone else got it).
