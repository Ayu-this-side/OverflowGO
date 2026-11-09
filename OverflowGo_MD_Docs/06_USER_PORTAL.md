# User Portal (Citizen)

Mobile-first PWA at route `/`. No login, no accounts.

## Screens

### 1. Home
- Short headline: "Bin overflowing? Let us know."
- One big button: **Report overflowing bin**.
- Small text: "Your location and photo will be used to send a cleaner."

### 2. Permission gate
- On first tap, request location and camera. If location is denied, show a clear message with steps to enable it and keep the button disabled.

### 3. Camera capture
- Uses `getUserMedia` (live camera only, **no file picker**).
- Capture button, then a preview with **Retake** / **Use photo**.
- Optional note field: "Describe the problem (optional)".
- **Send report** button.

### 4. Result
- Accepted: "Thanks! A cleaner has been notified." plus a line with ticket status when available.
- Merged: "This bin was already reported. We've increased its priority."
- Rejected: "We couldn't find an overflowing bin or garbage in this photo." with a **Retake photo** button.
- Network failure: "Saved. We'll send it when you're back online." (queued in IndexedDB, retried automatically).

## Client behavior
- Generate a random `deviceId` on first visit and keep it in localStorage (sent with every report; also used to recognise driver phones).
- Get GPS with high accuracy right before submit. If accuracy is worse than ~100 m, ask the user to wait a moment and retry.
- Compress the image client-side (max 1280 px, JPEG ~70%) before upload.
- Lightweight, accessible UI: large tap targets, works in bright sunlight (high contrast), supports English + Hindi strings via a simple i18n file.

## Not included (by design)
Login, OTP, CAPTCHA, gallery upload, QR scanning.
