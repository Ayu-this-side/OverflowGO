import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DriverProfile } from '@overflowgo/shared';
import { getDeviceId } from '../lib/device';
import {
  DriverApiError,
  driverLogin,
  getDriverSession,
  isUnauthorized,
  sendDriverLocation,
  setDriverOnline,
} from '../lib/driver-api';
import {
  clearDriverSession,
  loadDriverSession,
  saveDriverSession,
  type DriverSession,
} from '../lib/driver-session';
import { GeoError, getCurrentPosition } from '../lib/geo';

export default function DriverHome() {
  const [session, setSession] = useState<DriverSession | null>(() =>
    loadDriverSession(),
  );
  const [driver, setDriver] = useState<DriverProfile | null>(
    () => loadDriverSession()?.driver ?? null,
  );
  const [heartbeatSeconds, setHeartbeatSeconds] = useState(
    () => loadDriverSession()?.heartbeatSeconds ?? 20,
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(() => {
    clearDriverSession();
    setSession(null);
    setDriver(null);
    setPassword('');
  }, []);

  const applyDriver = useCallback((nextDriver: DriverProfile) => {
    setDriver(nextDriver);
    setSession((current) => {
      if (!current) return current;
      const updated = { ...current, driver: nextDriver };
      saveDriverSession(updated);
      return updated;
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    getDriverSession(session.token)
      .then((result) => {
        if (!active) return;
        setHeartbeatSeconds(result.heartbeatSeconds);
        applyDriver(result.driver);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (isUnauthorized(cause)) logout();
      });
    return () => {
      active = false;
    };
    // Restore the session once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session || !driver?.isOnline) return;
    let cancelled = false;

    const send = async () => {
      try {
        const position = await getCurrentPosition();
        if (cancelled) return;
        await sendDriverLocation(session.token, position.lat, position.lng);
      } catch {
        // A single missed heartbeat is harmless; the next tick retries.
      }
    };

    void send();
    const timer = window.setInterval(
      () => void send(),
      Math.max(5, heartbeatSeconds) * 1000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, driver?.isOnline, heartbeatSeconds]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await driverLogin(email.trim(), password, getDeviceId());
      saveDriverSession(result);
      setSession(result);
      setDriver(result.driver);
      setHeartbeatSeconds(result.heartbeatSeconds);
      setPassword('');
    } catch (cause) {
      setError(
        cause instanceof DriverApiError
          ? cause.message
          : 'Could not sign in. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleDuty = async () => {
    if (!session || !driver || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!driver.isOnline) {
        const position = await getCurrentPosition();
        const result = await setDriverOnline(session.token, true, {
          lat: position.lat,
          lng: position.lng,
        });
        applyDriver(result.driver);
      } else {
        const result = await setDriverOnline(session.token, false);
        applyDriver(result.driver);
      }
    } catch (cause) {
      if (cause instanceof GeoError) {
        setError(
          cause.code === 'denied'
            ? 'Allow location access to start duty. Open your browser settings and try again.'
            : "We couldn't get your location. Move somewhere with a better signal and try again.",
        );
      } else if (isUnauthorized(cause)) {
        logout();
      } else {
        setError(
          cause instanceof DriverApiError
            ? cause.message
            : 'Could not change duty status. Please try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  if (!session || !driver) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-brand-100">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
            OverflowGo
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Driver sign in</h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign in to start duty and see your route.
          </p>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
            >
              {error}
            </p>
          )}

          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Email</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="driver@example.com"
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-base"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-base"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-brand-700 px-5 py-3 text-base font-semibold text-white disabled:opacity-60"
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <Link
            to="/"
            className="mt-4 block text-center text-sm font-medium text-gray-500 underline underline-offset-2"
          >
            Back to citizen portal
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
            OverflowGo · Driver
          </p>
          <h1 className="text-2xl font-bold text-gray-900">{driver.name}</h1>
          <p className="text-sm text-gray-500">
            {driver.vehicleNo || 'Municipal vehicle'}
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700"
        >
          Sign out
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        >
          {error}
        </p>
      )}

      <section
        className={`rounded-3xl p-6 shadow-sm ring-1 ${
          driver.isOnline
            ? 'bg-brand-700 text-white ring-brand-700'
            : 'bg-white text-gray-900 ring-brand-100'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
              Duty status
            </p>
            <p className="mt-1 text-2xl font-bold">
              {driver.isOnline ? 'Online' : 'Offline'}
            </p>
          </div>
          <span
            className={`h-4 w-4 rounded-full ${
              driver.isOnline ? 'bg-green-300' : 'bg-gray-300'
            }`}
            aria-hidden="true"
          />
        </div>
        <p className="mt-3 text-sm opacity-80">
          {driver.isOnline
            ? `Sharing location every ${heartbeatSeconds} s. Route updates arrive live.`
            : 'Go online to start duty and receive route updates.'}
        </p>
        <button
          type="button"
          onClick={() => void toggleDuty()}
          disabled={busy}
          className={`mt-5 w-full rounded-2xl px-5 py-4 text-lg font-semibold disabled:opacity-60 ${
            driver.isOnline
              ? 'bg-white text-brand-700'
              : 'bg-brand-700 text-white'
          }`}
        >
          {busy
            ? 'Updating...'
            : driver.isOnline
              ? 'Go offline'
              : 'Go online'}
        </button>
      </section>

      <Link
        to="/driver/route"
        className="mt-4 block rounded-3xl bg-white p-5 shadow-sm ring-1 ring-brand-100"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
              Today
            </p>
            <p className="mt-1 text-lg font-bold text-gray-900">My route</p>
            <p className="text-sm text-gray-500">
              Priority stops first, then your regular stops.
            </p>
          </div>
          <span aria-hidden="true" className="text-2xl text-brand-700">
            →
          </span>
        </div>
      </Link>

      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        New overflow reports in your area appear here automatically while you are
        online. Complete a stop by taking an after photo at the bin.
      </p>
    </main>
  );
}
