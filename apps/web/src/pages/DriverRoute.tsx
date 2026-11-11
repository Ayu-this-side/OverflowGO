import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { DriverRoute, DriverRouteStop, DriverRouteTicket } from '@overflowgo/shared';
import StopMap from '../components/StopMap';
import {
  DriverApiError,
  getDriverRoute,
  isUnauthorized,
} from '../lib/driver-api';
import { useDriverRealtime } from '../lib/driver-realtime';
import { clearDriverSession, loadDriverSession } from '../lib/driver-session';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const millis = Date.now() - Date.parse(iso);
  if (!Number.isFinite(millis) || millis < 0) return 'just now';
  const minutes = Math.floor(millis / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function slaText(deadline: string): { label: string; late: boolean } {
  const remaining = Date.parse(deadline) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { label: 'SLA missed — releasing', late: true };
  }
  const minutes = Math.ceil(remaining / 60_000);
  return { label: `SLA ${minutes} min left`, late: false };
}

function SlaBadge({ deadline }: { deadline: string }) {
  const [text, setText] = useState(() => slaText(deadline));

  useEffect(() => {
    setText(slaText(deadline));
    const timer = window.setInterval(() => setText(slaText(deadline)), 15_000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-semibold ${
        text.late ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
      }`}
    >
      {text.label}
    </span>
  );
}

function TicketCard({ ticket }: { ticket: DriverRouteTicket }) {
  const navigateUrl = `https://www.google.com/maps/dir/?api=1&destination=${ticket.lat},${ticket.lng}`;
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
      {ticket.photoUrl && (
        <img
          src={ticket.photoUrl}
          alt="Citizen report"
          className="mb-3 h-40 w-full rounded-xl object-cover"
          loading="lazy"
        />
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold uppercase tracking-wide text-amber-900">
          {ticket.status === 'assigned' ? 'Assigned' : 'Open'}
        </span>
        {ticket.assigned && ticket.slaDeadline && (
          <SlaBadge deadline={ticket.slaDeadline} />
        )}
        <span className="font-medium text-gray-600">
          {ticket.reportCount} report{ticket.reportCount === 1 ? '' : 's'}
        </span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-600">first {timeAgo(ticket.firstReportedAt)}</span>
      </div>
      {ticket.note ? (
        <p className="mt-2 rounded-xl bg-white px-3 py-2 text-sm text-gray-700">
          “{ticket.note}”
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-gray-400">No note from the citizen.</p>
      )}
      <div className="mt-3 flex gap-2">
        <a
          href={navigateUrl}
          target="_blank"
          rel="noreferrer"
          className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-center text-sm font-semibold text-gray-700"
        >
          Navigate
        </a>
        <Link
          to={`/driver/tickets/${ticket.ticketId}/complete`}
          className="flex-1 rounded-xl bg-brand-700 px-3 py-2 text-center text-sm font-semibold text-white"
        >
          Complete
        </Link>
      </div>
    </div>
  );
}

function StopCard({ stop, index }: { stop: DriverRouteStop; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <li
      className={`rounded-3xl shadow-sm ring-1 ${
        stop.isDumpYard
          ? 'bg-amber-50 ring-amber-300'
          : stop.hasTicket
            ? 'bg-white ring-amber-200'
            : 'bg-white ring-brand-100'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
            stop.isDumpYard
              ? 'bg-amber-200 text-amber-900'
              : stop.hasTicket
                ? 'bg-amber-100 text-amber-900'
                : 'bg-brand-100 text-brand-700'
          }`}
        >
          {stop.isDumpYard ? '⌂' : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-gray-900">
              {stop.localityName}
            </span>
            {stop.isDumpYard && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Van full
              </span>
            )}
            {stop.hasTicket && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Overflow reported
              </span>
            )}
            {stop.current && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800">
                In progress
              </span>
            )}
          </span>
          <span className="mt-1 block text-sm text-gray-500">
            {stop.isDumpYard
              ? 'Empty the van here. Pop-ups resume after you tap “Van emptied”.'
              : stop.hasTicket
                ? `${stop.reportCount} report${stop.reportCount === 1 ? '' : 's'} · first ${timeAgo(stop.firstReportedAt)}`
                : 'Regular stop'}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`text-xl text-gray-400 transition ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-4">
          <StopMap
            lat={stop.lat}
            lng={stop.lng}
            label={`${stop.localityName} · ${stop.isDumpYard ? 'dump yard' : `stop ${index + 1}`}`}
          />
          {stop.isDumpYard ? (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block rounded-xl bg-brand-700 px-3 py-2 text-center text-sm font-semibold text-white"
            >
              Navigate to dump yard
            </a>
          ) : stop.tickets.length ? (
            <div className="mt-3 space-y-3">
              {stop.tickets.map((ticket) => (
                <TicketCard key={ticket.ticketId} ticket={ticket} />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              No open report at this stop. Continue your normal collection.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function DriverRoutePage() {
  const [session] = useState(() => loadDriverSession());
  const [route, setRoute] = useState<DriverRoute | null>(null);
  const [freshness, setFreshness] = useState({ fetched: 0, socket: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { connected, latestRoute } = useDriverRealtime();

  // A socket route and a fetched route can arrive in either order. Track which
  // kind arrived last so an old socket snapshot never hides a fresh load (for
  // example right after a job is completed).
  useEffect(() => {
    if (!latestRoute) return;
    setFreshness((current) => ({ ...current, socket: current.socket + 1 }));
  }, [latestRoute]);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const next = await getDriverRoute(session.token);
      setRoute(next);
      setFreshness((current) => ({ ...current, fetched: current.fetched + 1 }));
      setError(null);
    } catch (cause) {
      if (isUnauthorized(cause)) {
        clearDriverSession();
        setError('Session expired. Please sign in again.');
      } else {
        setError(
          cause instanceof DriverApiError
            ? cause.message
            : 'Could not load your route.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) {
    return <Navigate to="/driver" replace />;
  }

  const shownRoute =
    latestRoute && freshness.socket > freshness.fetched ? latestRoute : route;
  const stops = shownRoute?.stops ?? [];
  const priorityCount = stops.filter((stop) => stop.hasTicket).length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link
            to="/driver"
            className="text-xs font-semibold uppercase tracking-widest text-brand-700"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">My route</h1>
          <p className="text-sm text-gray-500">
            {priorityCount
              ? `${priorityCount} priority stop${priorityCount === 1 ? '' : 's'} first`
              : 'All regular stops'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              connected
                ? 'bg-brand-100 text-brand-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {connected ? 'Live' : 'Offline'}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-semibold text-gray-500 underline underline-offset-2"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        >
          {error}
        </p>
      )}

      {loading && !shownRoute ? (
        <p className="mt-10 text-center text-sm text-gray-500">Loading route…</p>
      ) : stops.length ? (
        <ol className="space-y-3">
          {stops.map((stop, index) => (
            <StopCard
              key={stop.stopId ?? stop.localityId}
              stop={stop}
              index={index}
            />
          ))}
        </ol>
      ) : (
        <div className="mt-10 rounded-3xl bg-white p-6 text-center text-sm text-gray-500 ring-1 ring-brand-100">
          No route stops are assigned to you yet. Ask dispatch to seed your
          route.
        </div>
      )}

      <p className="mt-5 text-xs leading-relaxed text-gray-500">
        Stops with a report move to the top, oldest report first. The list
        refreshes automatically while you are online.
      </p>
    </main>
  );
}
