# Dispatch and Routing

## 1. Ticket lifecycle
`open` -> `offered` -> `assigned` -> `completed`

- `open`: valid report exists, no driver has taken it.
- `offered`: pop-ups sent to nearby drivers, waiting for an accept.
- `assigned`: one driver accepted (first-write-wins). SLA clock starts.
- `completed`: after photo verified by the AI.

If no one accepts, the ticket stays `open` and appears at the front of the next route for the driver who covers that locality.

## 2. New report handling (after the AI accepts it)
1. Find the nearest open ticket within `duplicateMergeRadiusMeters` (25 m).
   - If found: merge, `report_count += 1`, no new pop-up. Done.
2. Otherwise create a ticket. Set `locality_id` to the nearest locality center. `first_reported_at = now()`.
3. Apply the **self-report rule** (see `10_EDGE_CASES.md`):
   - If the report's `deviceId` is in `driver_devices`: `reward_eligible = false`, `flag_reason = driver_device`.
   - Else for each online driver within 150 m: that driver is **excluded from the reward** for this ticket (store in `flag_reason = driver_nearby:<driverId>`). Other drivers are unaffected.
4. Dispatch (section 3).

## 3. Live dispatch (pop-up)
1. Query eligible drivers: online, `van_full = false`, heartbeat fresh (under 60 s), within `geofenceRadiusKm` (3 km) of the ticket.
2. Skip the pop-up if the locality is due on a driver's regular route within `skipOfferIfRouteDueWithinMinutes` (30 min). It will be handled naturally.
3. Create an `offers` row per driver, mark the ticket `offered`, emit `offer:new` to each driver's socket.
4. Each driver sees Accept / Reject / Ignore with a 30-second timer.
5. On Accept, run the atomic update (`04_DATABASE_SCHEMA.md`). 
   - 1 row updated: this driver wins. Mark other offers `taken_by_other` and emit `offer:closed` to them. Emit `route:updated` to the winner.
   - 0 rows updated: respond 409.
6. If all offers end in reject/ignore/expire and nobody accepted: expand to `geofenceExpandedRadiusKm` (5 km) once and repeat.
7. If still nobody accepts: ticket returns to `open` and waits for route ordering. No further pop-ups for it.

## 4. SLA and release
- A cron job runs every minute. For tickets with `status = assigned` and `sla_deadline < now()`:
  - Set the ticket back to `open`, clear the assignment, reduce the driver's `acceptance_score`.
  - Emit `ticket:released` to the driver, then re-run dispatch excluding that driver.

## 5. Route ordering (per driver)
Input: the driver's regular `route_stops` ordered by `position`, plus open/assigned tickets per locality.

```
priorityStops = stops whose locality has >= 1 non-completed ticket
sort priorityStops by min(first_reported_at) of those tickets (oldest first)
restStops     = remaining stops in original position order
route         = priorityStops + restStops
```

Examples (regular A, B, C, D):
- Tickets: C (3 PM), B (4 PM) -> `C, B, A, D`.
- Then D raises one -> `C, B, D, A`.

Rules:
- **Never move a stop the driver is currently handling**; new priority stops go right after it.
- An accepted extra job is included in the winner's route in the same ordering.
- Recompute and emit `route:updated` whenever a ticket is created, merged, assigned, released, or completed.
- When a driver starts the next day's duty (goes online), the route is computed fresh from all open tickets for their localities.

## 6. Rewards
- A reward is paid **only** for tickets accepted via pop-up, completed by the accepting driver, with a verified after photo, and `reward_eligible = true` and the driver not excluded by the proximity rule.
- One reward per ticket (unique constraint on `reward_ledger.ticket_id`).
- Daily cap per driver (`rewardDailyCapPerDriver`). Jobs beyond the cap are still completed but not paid.
- Route-stop tickets cleared as part of the normal route earn no extra reward.
