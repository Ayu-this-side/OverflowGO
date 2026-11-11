import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import type {
  DriverRoute,
  OfferClosedPayload,
  OfferPayload,
} from '@overflowgo/shared';
import {
  DriverApiError,
  isUnauthorized,
  respondToOffer,
  sendDriverLocation,
} from './driver-api';
import {
  clearDriverSession,
  loadDriverSession,
  subscribeDriverSession,
  type DriverSession,
} from './driver-session';
import { getCurrentPosition } from './geo';

interface DriverRealtimeValue {
  connected: boolean;
  latestRoute: DriverRoute | null;
  offer: OfferPayload | null;
  offerBusy: boolean;
  offerError: string | null;
  acceptOffer: () => Promise<void>;
  rejectOffer: () => Promise<void>;
  dismissOffer: () => void;
}

const defaultValue: DriverRealtimeValue = {
  connected: false,
  latestRoute: null,
  offer: null,
  offerBusy: false,
  offerError: null,
  acceptOffer: async () => undefined,
  rejectOffer: async () => undefined,
  dismissOffer: () => undefined,
};

const DriverRealtimeContext = createContext<DriverRealtimeValue>(defaultValue);

function announceOffer(): void {
  try {
    navigator.vibrate?.(200);
  } catch {
    // Vibration is optional.
  }
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    void context.close().catch(() => undefined);
  } catch {
    // Sound needs a user gesture on some browsers.
  }
}

export function DriverRealtimeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const enabled = location.pathname.startsWith('/driver');

  const [session, setSession] = useState<DriverSession | null>(() =>
    loadDriverSession(),
  );
  const [connected, setConnected] = useState(false);
  const [latestRoute, setLatestRoute] = useState<DriverRoute | null>(null);
  const [queue, setQueue] = useState<OfferPayload[]>([]);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setSession(loadDriverSession());
    return subscribeDriverSession(sync);
  }, []);

  const token = session?.token ?? null;

  useEffect(() => {
    setLatestRoute(null);
    setQueue([]);
    setOfferError(null);
    if (!token || !enabled) {
      setConnected(false);
      return;
    }

    const socket: Socket = io({ auth: { token } });
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRoute = (route: DriverRoute) => setLatestRoute(route);
    const onOffer = (offer: OfferPayload) => {
      setQueue((current) =>
        current.some((item) => item.offerId === offer.offerId)
          ? current
          : [...current, offer],
      );
      setOfferError(null);
      announceOffer();
    };
    const onOfferClosed = (payload: OfferClosedPayload) => {
      setQueue((current) =>
        current.filter((item) => item.offerId !== payload.offerId),
      );
    };
    const onConnectError = (error: Error) => {
      setConnected(false);
      if (error.message === 'unauthorized') {
        clearDriverSession();
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('route:updated', onRoute);
    socket.on('offer:new', onOffer);
    socket.on('offer:closed', onOfferClosed);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [token, enabled]);

  // Keep the driver fresh on every /driver screen. Previously this only ran on
  // the dashboard, so opening the route or completion screen let the driver go
  // stale and stopped route updates and new offers.
  useEffect(() => {
    if (!token || !enabled || !session?.driver.isOnline) return;
    let cancelled = false;

    const send = async () => {
      try {
        const position = await getCurrentPosition();
        if (cancelled) return;
        await sendDriverLocation(token, position.lat, position.lng);
      } catch {
        // A single missed heartbeat is harmless; the next tick retries.
      }
    };

    void send();
    const timer = window.setInterval(
      () => void send(),
      Math.max(5, session.heartbeatSeconds) * 1000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, enabled, session?.driver.isOnline, session?.heartbeatSeconds]);

  const dismiss = useCallback(() => {
    setQueue((current) => current.slice(1));
    setOfferError(null);
    setOfferBusy(false);
  }, []);

  const respond = useCallback(
    async (answer: 'accept' | 'reject') => {
      const offer = queue[0];
      if (!offer || !token || offerBusy) return;
      setOfferBusy(true);
      setOfferError(null);
      try {
        await respondToOffer(token, offer.offerId, answer);
        dismiss();
      } catch (error) {
        if (isUnauthorized(error)) {
          clearDriverSession();
          dismiss();
          return;
        }
        if (
          error instanceof DriverApiError &&
          (error.code === 'taken' || error.status === 409)
        ) {
          setOfferError('Another driver took this job.');
          window.setTimeout(() => dismiss(), 1600);
          return;
        }
        setOfferError(
          error instanceof DriverApiError
            ? error.message
            : 'Could not respond to the job. Please try again.',
        );
        setOfferBusy(false);
      }
    },
    [queue, token, offerBusy, dismiss],
  );

  const value = useMemo<DriverRealtimeValue>(
    () => ({
      connected,
      latestRoute,
      offer: queue[0] ?? null,
      offerBusy,
      offerError,
      acceptOffer: () => respond('accept'),
      rejectOffer: () => respond('reject'),
      dismissOffer: dismiss,
    }),
    [
      connected,
      latestRoute,
      queue,
      offerBusy,
      offerError,
      respond,
      dismiss,
    ],
  );

  return (
    <DriverRealtimeContext.Provider value={value}>
      {children}
    </DriverRealtimeContext.Provider>
  );
}

export function useDriverRealtime(): DriverRealtimeValue {
  return useContext(DriverRealtimeContext);
}
