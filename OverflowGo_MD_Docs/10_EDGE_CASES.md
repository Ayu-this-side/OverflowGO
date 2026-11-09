# Edge Cases and Decided Handling

Only the cases below are in scope. Items the owner explicitly removed are listed at the end so the agent does not add them back.

## 1. Driver reports a bin himself to earn the reward (main case)
Decision: **pay for verified cleaning, never for reporting**, and block the shortcut.

1. **Pay on verified completion.** Reward is credited only after the driver uploads a live "after" photo within 50 m of the ticket and the AI says the bin is no longer overflowing.
2. **Driver-device rule.** The driver app registers its `deviceId` at login. A report from a registered driver device is still a valid ticket, but `reward_eligible = false`.
3. **Driver-proximity rule.** If any online driver is within 150 m of the report location when it is submitted (e.g. he used another phone), that driver is excluded from the reward for this ticket. The ticket stays valid and other drivers can still earn it.
4. No separate driver reporting flow is offered.

Known limitation: a driver's friend who is far from the driver can still report. The after-photo and the 150 m rule limit the benefit, and there is no further checking in v1.

## 2. Duplicate reports for the same bin
Reports within 25 m of an open ticket merge into it and raise `report_count`. Only one pop-up and one reward per ticket.

## 3. Two drivers accept at the same time
Atomic first-write-wins update. The loser gets 409 and the pop-up closes.

## 4. Driver accepts but never completes
45-minute SLA. After it, the ticket is released and re-offered, and the driver's `acceptance_score` drops.

## 5. No driver online nearby
Expand the radius from 3 km to 5 km once. If still no taker, the ticket goes to the front of the next morning's route for that locality.

## 6. Request is already due on the regular route
If the locality is due within 30 minutes on a driver's route, skip the pop-up.

## 7. Van gets full
"Van full" button inserts a dump-yard step and pauses pop-ups for that driver until "Van emptied".

## 8. Driver goes offline or loses signal
Heartbeat every 20 s. No heartbeat for 60 s means no pop-ups. Accepted but unstarted tickets are released if the driver goes offline.

## 9. Route changes while the driver is moving
The stop in progress never moves. New priority stops are inserted after it.

## 10. AI model mistakes
The model is an object detector. A report passes if an `overflow` **or** a `garbage` detection reaches its configured threshold (start 0.50 each). Rejected users can retake the photo. A cleaned spot is verified only if a bin is visible and neither overflow nor garbage is detected. There is no human review queue in v1. Thresholds must be calibrated on real photos (see `08_AI_MODEL_INTEGRATION.md`).

## 11. Photo problems
- Live camera only (no gallery picker), which prevents most old or internet photos.
- Server timestamp is authoritative, not the phone clock.
- Perceptual hash of the photo is checked against reports in the last 24 h. An identical photo is treated as a duplicate and does not create a new ticket.

## 12. Poor network
Client queues the report in IndexedDB and retries automatically. Server tolerates retries by using an idempotency key (`clientReportId`) per submission.

## 13. Reward budget
Daily per-driver cap and a single configured reward amount. The municipality changes it by editing config.

## 14. Privacy
- Citizens' identity is never collected. Only `deviceId`, location and photo.
- Driver locations are never visible to citizens.
- Photos are deleted 7 days after ticket completion.
- Face and number-plate blurring is optional and not part of v1.

## Explicitly removed by the owner (do NOT implement)
- Driver "Report & clean" flow with a smaller reward.
- Bin pre-registration, QR codes, snapping reports to bin IDs, the 50 m report-to-bin rule, IP-location cross-checks.
- Rate limits, CAPTCHA, phone OTP, per-bin cooldowns for citizens.
- AI check combined with bin-ID/location matching for staged or wrong-place photos.
- Always-on retraining data collection (optional and off by default).
- Admin portal and human review queue.
