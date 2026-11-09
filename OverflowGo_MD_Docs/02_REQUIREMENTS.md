# Requirements

## Functional: User Portal
- FR-U1: No sign-in. Open the site and see a single "Report overflowing bin" action.
- FR-U2: Tapping it opens the **live camera** (no gallery upload). Capture one photo.
- FR-U3: Optional text note (not mandatory).
- FR-U4: On submit, the app attaches **GPS coordinates** and a timestamp (server time is authoritative).
- FR-U5: Photo goes to the AI check before anything reaches a driver.
- FR-U6: User sees the result: "Accepted, a driver has been notified" or "Rejected: no overflowing bin or garbage found" with a **Retake** option.
- FR-U7: If network is poor, the report is queued on the device and retried.
- FR-U8: Location permission is mandatory. If denied, show instructions and block submission.

## Functional: Driver Portal
- FR-D1: Email + password login.
- FR-D2: Online/Offline toggle. Online = duty started, location sharing on. Offline = duty ended.
- FR-D3: **Route screen:** ordered stops. Stops with open tickets are marked and listed first, in order of earliest report. Regular stops follow.
- FR-D4: **Live pop-up** for new tickets within 3 km: Accept / Reject / Ignore (auto-expires in 30 s). Shows photo, distance, note, reward amount.
- FR-D5: Accepted ticket is added to the driver's dashboard/route immediately.
- FR-D6: To close a ticket the driver captures a live **"after" photo** at the location. The AI verifies that no overflow or garbage remains.
- FR-D7: **Wallet:** reward balance and a list of completed extra jobs.
- FR-D8: "Van full" button that adds a dump-yard stop and pauses pop-ups until the driver taps "Van emptied".
- FR-D9: Route updates in real time when new tickets arrive while the driver is online.

## Functional: Backend
- FR-B1: Receive reports, call the AI service, create or merge tickets.
- FR-B2: Merge duplicate reports for the same location (within 25 m of an open ticket) into one ticket and increment `report_count`.
- FR-B3: Dispatch pop-ups to online drivers within the geofence, using PostGIS.
- FR-B4: Atomic first-accept-wins assignment.
- FR-B5: Compute each driver's route order (see `09_DISPATCH_AND_ROUTING.md`).
- FR-B6: SLA timer on accepted tickets. If not completed in 45 min, release the ticket and re-offer it.
- FR-B7: Reward ledger. Credit only after a verified completion.
- FR-B8: Data retention jobs (photo deletion).
- FR-B9: CLI/seed scripts for drivers, localities, routes, and a payout CSV export.

## Non-functional
- NFR-1: Mobile-first, installable PWA, works on low-end Android.
- NFR-2: Photo upload is compressed on the client (max 1280 px long edge, JPEG ~70%).
- NFR-3: AI response in under 3 s for a typical photo (the YOLO11s model runs on CPU).
- NFR-4: Offer fan-out to drivers in under 2 s.
- NFR-5: Driver location is never shown to citizens. Photos are auto-deleted 7 days after ticket closure.
- NFR-6: All configuration (geofence radius, SLA, reward amounts, thresholds) lives in a single config file or env vars.

## Out of scope for v1
- Admin portal, citizen sign-in/OTP, rate limiting/CAPTCHA, bin pre-registration or QR codes, human review queue, model retraining, driver-initiated reports.
