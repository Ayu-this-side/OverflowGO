import type { AppConfig } from '@overflowgo/shared';
import type { Server, Socket } from 'socket.io';
import { query } from './db/pool';
import { verifyDriverToken } from './services/auth';
import { computeDriverRoute } from './services/driver-route';
import { createDriverService } from './services/drivers';
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
  localityId: string | null,
): Promise<void> {
  const drivers = await query<{ id: string }>(
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
        const route = await computeDriverRoute(driver.id);
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

  routeEvents.on('changed', (localityId: string | null) => {
    void pushRoutes(io, config, localityId);
  });
}
