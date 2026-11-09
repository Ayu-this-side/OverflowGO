# API Specification

Base: `/api`. JSON unless stated. Driver endpoints need `Authorization: Bearer <JWT>`.

## Public (User Portal)

### POST /api/reports  (multipart/form-data)
Fields: `photo` (file), `lat`, `lng`, `note` (optional), `deviceId`, `clientCapturedAt`.

Flow: validate -> compress/store -> call AI service -> if overflowing: dedupe/merge or create ticket -> dispatch.

Responses:
```json
{ "status": "accepted", "ticketId": "uuid", "merged": false }
{ "status": "rejected", "reason": "No overflowing bin or garbage found. Please retake the photo." }
```
Errors: 400 invalid input, 413 file too large, 503 AI service unavailable (client retries).

### GET /api/reports/:id
Returns status of a report (accepted/rejected, ticket status: open/assigned/completed). Used by the user portal for a simple status line.

## Driver

### POST /api/driver/login
`{ email, password, deviceId }` -> `{ token, driver }`. Registers `deviceId` in `driver_devices`.

### POST /api/driver/online
`{ online: true|false, lat, lng }`. Going offline: unassigned work stays with the driver until completed or released. Going offline also releases accepted tickets that have not been started after confirmation.

### POST /api/driver/location
`{ lat, lng }` every 20 s while online (heartbeat).

### GET /api/driver/route
```json
{
  "stops": [
    { "stopId": "uuid", "localityId": "uuid", "localityName": "C",
      "hasTicket": true, "ticketIds": ["uuid"], "firstReportedAt": "...", "reportCount": 3 },
    { "stopId": "uuid", "localityName": "A", "hasTicket": false }
  ]
}
```

### POST /api/driver/offers/:offerId/respond
`{ response: "accept" | "reject" }`. Ignore is implicit through timeout.
- 200 `{ "assigned": true, "ticketId": "uuid" }`
- 409 `{ "assigned": false, "reason": "taken" }`

### POST /api/driver/tickets/:ticketId/complete  (multipart)
Fields: `photo` (after photo), `lat`, `lng`.
Checks: driver is the assignee or the route owner for the ticket's locality, location within 50 m of the ticket, the AI sees a bin and no overflow or garbage.
Responses: `{ verified: true, reward: 20 }` or `{ verified: false, reason: "Overflow or garbage still visible" }`.

### POST /api/driver/van-full  /  POST /api/driver/van-emptied
Toggle `van_full`.

### GET /api/driver/wallet
`{ balance, todayEarned, items: [{ ticketId, amount, createdAt }] }`

## Socket.IO (authenticated with the driver JWT)
Server to driver:
- `offer:new` `{ offerId, ticketId, photoUrl, note, distanceMeters, reward, expiresAt }`
- `offer:closed` `{ offerId, reason: "taken" | "expired" }` (hides the pop-up for others)
- `route:updated` `{ stops: [...] }`
- `ticket:released` `{ ticketId }` (SLA missed)

Driver to server:
- `location:update` `{ lat, lng }` (alternative to the REST heartbeat)

## Internal: AI service
### POST /predict  (multipart `image`)
```json
{ "overflow_conf": 0.84, "bin_conf": 0.93, "garbage_conf": 0.40, "detections": [ ... ] }
```
Each `*_conf` is the highest detection confidence for that class (0.0 if none). The API applies the thresholds from config.
See `08_AI_MODEL_INTEGRATION.md`.
