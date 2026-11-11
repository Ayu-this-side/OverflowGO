import type { AppConfig } from '@overflowgo/shared';
import type { Server, Socket } from 'socket.io';
import { query } from './db/pool';
import { verifyDriverToken } from './services/auth';
import { dispatchEvents, type OfferNewEvent, type OfferClosedEvent, type TicketReleasedEvent } from './services/dispatch-events';
import { computeDriverRoute } from './services/driver-route';
import { createDriverService } from './services/drivers';
import { sendOfferPush } from './services/push';
import { routeEvents } from './services/route-events';

interface SocketData {
  driverId: string;
}

function tokenFromSocket(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken) return authToken;
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string') {
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) return token;
  }
  return null;
}

async function pushRoutes(
  io: Server,
  config: AppConfig,
  { localityId, driverId }: { localityId: string | null; driverId: string | null },
): Promise<void> {
  const drivers = driverId
    ? { rows: [{ id: driverId }] }
    : await query<{ id: string }>(
        `SELECT DISTINCT d.id
           FROM drivers d
          WHERE d.is_online = true
            AND d.last_ping_at > now() - make_interval(secs => $2)
            AND (
              $1::uuid IS NULL
              OR EXISTS (
                SELECT 1 FROM route_stops rs
                 WHERE rs.driver_id = d.id AND rs.locality_id = $1
              )
              OR EXISTS (
                SELECT 1 FROM tickets t
                 WHERE t.assigned_driver_id = d.id AND t.locality_id = $1
              )
            )`,
        [localityId, config.driverStaleAfterSeconds],
      );

  await Promise.all(
    drivers.rows.map(async (driver) => {
      try {
        const route = await computeDriverRoute(driver.id, config);
        io.to(`driver:${driver.id}`).emit('route:updated', route);
      } catch (error) {
        console.error('[socket] route update failed:', error);
      }
    }),
  );
}

export function attachSocket(
  io: Server,
  { config }: { config: AppConfig },
): void {
  const drivers = createDriverService({ config });

  io.use((socket, next) => {
    const token = tokenFromSocket(socket);
    const driverId = token ? verifyDriverToken(token) : null;
    if (!driverId) {
      next(new Error('unauthorized'));
      return;
    }
    (socket.data as SocketData).driverId = driverId;
    next();
  });

  io.on('connection', (socket) => {
    const driverId = (socket.data as SocketData).driverId;
    void socket.join(`driver:${driverId}`);

    void computeDriverRoute(driverId, config)
      .then((route) => socket.emit('route:updated', route))
      .catch(() => undefined);

    socket.on('location:update', (payload: unknown) => {
      if (
        typeof payload !== 'object' ||
        payload === null ||
        typeof (payload as { lat?: unknown }).lat !== 'number' ||
        typeof (payload as { lng?: unknown }).lng !== 'number'
      ) {
        return;
      }
      const { lat, lng } = payload as { lat: number; lng: number };
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
      drivers.heartbeat(driverId, lat, lng).catch(() => undefined);
    });
  });

  routeEvents.on(
    'changed',
    (change: { localityId: string | null; driverId: string | null }) => {
      void pushRoutes(io, config, change);
    },
  );

  dispatchEvents.on('offer:new', ({ driverId, offer }: OfferNewEvent) => {
    const room = `driver:${driverId}`;
    io.to(room).emit('offer:new', offer);

    // No live socket means the app is probably closed; fall back to Web Push.
    if (!io.sockets.adapter.rooms.get(room)?.size) {
      void sendOfferPush(driverId, offer);
    }
  });

  dispatchEvents.on(
    'offer:closed',
    ({ driverId, offerId, reason }: OfferClosedEvent) => {
      io.to(`driver:${driverId}`).emit('offer:closed', { offerId, reason });
    },
  );

  dispatchEvents.on(
    'ticket:released',
    ({ driverId, ticketId }: TicketReleasedEvent) => {
      io.to(`driver:${driverId}`).emit('ticket:released', { ticketId });
    },
  );
}
