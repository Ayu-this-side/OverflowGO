# Driver Portal

Mobile-first PWA at route `/driver/*`. Requires login.

## Screens

### 1. Login
- Email + password. On success, store the JWT and register this `deviceId` with the backend.

### 2. Dashboard (home)
- Big **Online / Offline** toggle.
  - Online: start location sharing (heartbeat every 20 s), connect the socket, show the route.
  - Offline: stop location sharing, disconnect, no new pop-ups.
- Summary cards: today's completed jobs, today's extra earnings, wallet balance.
- **Van full** button (and "Van emptied" once pressed).

### 3. Route screen
- Ordered list of stops. Stops with open tickets show a badge ("Overflow reported", report count, time since first report) and appear first.
- Regular stops follow in their usual order.
- Tapping a stop shows its map location (Leaflet), ticket photo(s), and notes. **Navigate** opens the phone's maps app.
- The list updates live via `route:updated`. A stop currently in progress is never moved.

### 4. Pop-up (offer) modal
Shown over any screen when `offer:new` arrives, with a sound/vibration:
- Ticket photo, distance, optional note, **reward amount**.
- Three actions: **Accept**, **Reject**, and implicit **Ignore** (countdown of 30 s, then it closes).
- On Accept: call the respond endpoint. If the server returns 409 (taken), show "Another driver took this job" and close.
- On `offer:closed` from the server, dismiss the modal automatically.

### 5. Complete job
- Opens when the driver taps **Complete** on a ticket (either an accepted extra job or a route stop with a ticket).
- Live camera capture of the **after photo** (no gallery). GPS is attached.
- Result: verified (reward credited if eligible) or "Overflow or garbage still visible, retake after cleaning".

### 6. Wallet
- Balance, per-job history (ticket, amount, date). Payout happens outside the app.

## Behavior notes
- If the heartbeat stops for 60 s, the server treats the driver as offline for dispatch (no pop-ups).
- If the driver goes offline with accepted-but-unstarted tickets, ask them to release them. Released tickets are re-offered.
- SLA countdown (45 min) is shown on accepted tickets.
- Rejecting or ignoring offers has no penalty, but repeatedly missing the SLA after accepting lowers `acceptance_score`.
