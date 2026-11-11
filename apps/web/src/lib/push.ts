import {
  getPushKey,
  subscribePush,
  type PushSubscriptionPayload,
} from './driver-api';

export type PushResult =
  | 'enabled'
  | 'denied'
  | 'unsupported'
  | 'not_configured'
  | 'failed';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function toPayload(
  subscription: PushSubscription,
): PushSubscriptionPayload | null {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Requests notification permission (when needed), subscribes this browser and
 * stores the subscription on the API. Safe to call again: it reuses the
 * existing subscription.
 */
export async function enableDriverPush(token: string): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';

  try {
    const key = await getPushKey(token);
    if (!key.enabled || !key.publicKey) return 'not_configured';

    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return 'denied';
    }

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey),
      }));

    const payload = toPayload(subscription);
    if (!payload) return 'failed';
    await subscribePush(token, payload);
    return 'enabled';
  } catch {
    return 'failed';
  }
}

/** Re-subscribe silently when permission was already granted. */
export async function refreshDriverPush(token: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  await enableDriverPush(token).catch(() => undefined);
}
