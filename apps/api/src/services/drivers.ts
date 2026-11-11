import type { AppConfig, DriverProfile } from '@overflowgo/shared';
import { query } from '../db/pool';
import { ApiError } from '../errors';
import { signDriverToken, verifyPassword } from './auth';
import { emitRouteChanged } from './route-events';

interface DriverRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicle_no: string;
  is_online: boolean;
  van_full: boolean;
  acceptance_score: string;
  password_hash?: string;
}

function mapDriver(row: DriverRow): DriverProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    vehicleNo: row.vehicle_no,
    isOnline: row.is_online,
    vanFull: row.van_full,
    acceptanceScore: Number(row.acceptance_score),
  };
}

const DRIVER_COLUMNS = `id, name, email, phone, vehicle_no, is_online,
  van_full, acceptance_score`;

export interface DriverLoginResult {
  token: string;
  driver: DriverProfile;
  heartbeatSeconds: number;
}

export interface DriverService {
  login(
    email: string,
    password: string,
    deviceId: string,
  ): Promise<DriverLoginResult>;
  getProfile(driverId: string): Promise<DriverProfile | null>;
  setOnline(
    driverId: string,
    online: boolean,
    location?: { lat: number; lng: number },
  ): Promise<DriverProfile>;
  heartbeat(
    driverId: string,
    lat: number,
    lng: number,
  ): Promise<boolean>;
}

export function createDriverService({
  config,
}: {
  config: AppConfig;
}): DriverService {
  return {
    async login(email, password, deviceId) {
      const result = await query<DriverRow>(
        `SELECT ${DRIVER_COLUMNS}, password_hash
           FROM drivers
          WHERE lower(email) = lower($1)
          LIMIT 1`,
        [email],
      );
      const row = result.rows[0];
      if (!row || !row.password_hash) {
        throw new ApiError(401, 'Invalid email or password', 'invalid_credentials');
      }

      const valid = await verifyPassword(password, row.password_hash);
      if (!valid) {
        throw new ApiError(401, 'Invalid email or password', 'invalid_credentials');
      }

      await query(
        `INSERT INTO driver_devices (driver_id, device_id)
         VALUES ($1, $2)
         ON CONFLICT (driver_id, device_id) DO NOTHING`,
        [row.id, deviceId],
      );

      return {
        token: signDriverToken(row.id),
        driver: mapDriver(row),
        heartbeatSeconds: config.driverHeartbeatSeconds,
      };
    },

    async getProfile(driverId) {
      const result = await query<DriverRow>(
        `SELECT ${DRIVER_COLUMNS} FROM drivers WHERE id = $1`,
        [driverId],
      );
      const row = result.rows[0];
      return row ? mapDriver(row) : null;
    },

    async setOnline(driverId, online, location) {
      const released = await query<{ locality_id: string }>(
        `UPDATE tickets
            SET status = 'open',
                assigned_driver_id = NULL,
                assigned_at = NULL,
                sla_deadline = NULL
          WHERE assigned_driver_id = $1
            AND status = 'assigned'
          RETURNING locality_id`,
        [driverId],
      );

      const result = await query<DriverRow>(
        `UPDATE drivers
            SET is_online = $2,
                last_location = CASE
                  WHEN $3::double precision IS NULL THEN last_location
                  ELSE ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography
                END,
                last_ping_at = CASE WHEN $2 THEN now() ELSE last_ping_at END
          WHERE id = $1
          RETURNING ${DRIVER_COLUMNS}`,
        [driverId, online, location?.lat ?? null, location?.lng ?? null],
      );

      const row = result.rows[0];
      if (!row) {
        throw new ApiError(404, 'Driver not found', 'not_found');
      }

      for (const ticket of released.rows) {
        emitRouteChanged(ticket.locality_id);
      }
      return mapDriver(row);
    },

    async heartbeat(driverId, lat, lng) {
      const result = await query(
        `UPDATE drivers
            SET last_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                last_ping_at = now()
          WHERE id = $1`,
        [driverId, lng, lat],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}

