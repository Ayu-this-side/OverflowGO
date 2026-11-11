import type { DriverLoginResponse } from '@overflowgo/shared';

const SESSION_KEY = 'overflowgo.driver.session';
const SESSION_EVENT = 'overflowgo:driver-session';

export interface DriverSession extends DriverLoginResponse {}

function notify(): void {
  try {
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    // Non-browser environments have no window.
  }
}

export function loadDriverSession(): DriverSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DriverSession>;
    if (
      typeof parsed.token !== 'string' ||
      !parsed.driver ||
      typeof parsed.heartbeatSeconds !== 'number'
    ) {
      return null;
    }
    return parsed as DriverSession;
  } catch {
    return null;
  }
}

export function saveDriverSession(session: DriverSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Private mode can block storage; the in-memory session still works.
  }
  notify();
}

export function clearDriverSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore.
  }
  notify();
}

/** Subscribe to login/logout/profile saves from anywhere in the app. */
export function subscribeDriverSession(listener: () => void): () => void {
  window.addEventListener(SESSION_EVENT, listener);
  return () => window.removeEventListener(SESSION_EVENT, listener);
}
