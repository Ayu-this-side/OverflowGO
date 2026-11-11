import type { OfferPayload } from '@overflowgo/shared';
import { sendNotification, setVapidDetails } from 'web-push';
import { query } from '../db/pool';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured: boolean | null = null;

/** Web Push is optional: enable it by setting both VAPID keys in `.env`. */
export function isPushEnabled(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    configured = false;
    return configured;
  }

  setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com',
    publicKey,
    privateKey,
  );
  configured = true;
  return configured;
}

export function pushPublicKey(): string | null {
  return isPushEnabled()
    ? process.env.VAPID_PUBLIC_KEY?.trim() ?? null
    : null;
}

export async function savePushSubscription(
  driverId: string,
  subscription: PushSubscriptionInput,
): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (driver_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET driver_id = EXCLUDED.driver_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth`,
    [
      driverId,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
    ],
  );
}

export async function removePushSubscription(
  driverId: string,
  endpoint: string,
): Promise<void> {
  await query(
    'DELETE FROM push_subscriptions WHERE driver_id = $1 AND endpoint = $2',
    [driverId, endpoint],
  );
}

function offerNotification(offer: OfferPayload): string {
  return JSON.stringify({
    title: `New job in ${offer.localityName}`,
    body:
      offer.reward > 0
        ? `₹${offer.reward} · ${offer.distanceMeters} m away · accept within ${Math.round(
            (Date.parse(offer.expiresAt) - Date.now()) / 1000,
          )}s`
        : `${offer.distanceMeters} m away · accept within ${Math.round(
            (Date.parse(offer.expiresAt) - Date.now()) / 1000,
          )}s`,
    url: '/driver/route',
    tag: `offer-${offer.offerId}`,
  });
}

/** Best-effort push for drivers whose app is not connected to the socket. */
export async function sendOfferPush(
  driverId: string,
  offer: OfferPayload,
): Promise<void> {
  if (!isPushEnabled()) return;

  let rows: SubscriptionRow[] = [];
  try {
    const result = await query<SubscriptionRow>(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE driver_id = $1',
      [driverId],
    );
    rows = result.rows;
  } catch (error) {
    console.error('[push] subscription lookup failed:', error);
    return;
  }

  const payload = offerNotification(offer);
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payload,
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await query('DELETE FROM push_subscriptions WHERE id = $1', [
            row.id,
          ]).catch(() => undefined);
        } else {
          console.error('[push] send failed:', statusCode ?? error);
        }
      }
    }),
  );
}
