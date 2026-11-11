import type { AppConfig, DriverProfile, Wallet } from '@overflowgo/shared';
import { query } from '../db/pool';
import { ApiError } from '../errors';
import { signDriverToken, verifyPassword } from './auth';
import type { DispatchService } from './dispatch';
import { emitDriverRouteChanged, emitRouteChanged } from './route-events';

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
  setVanFull(driverId: string, full: boolean): Promise<DriverProfile>;
  wallet(driverId: string): Promise<Wallet>;
}

export function createDriverService({
  config,
  dispatch,
}: {
  config: AppConfig;
  dispatch?: DispatchService;
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
      const released = await query<{ id: string; locality_id: string }>(
        `UPDATE tickets
            SET status = 'open',
                assigned_driver_id = NULL,
                assigned_at = NULL,
                sla_deadline = NULL
          WHERE assigned_driver_id = $1
            AND status = 'assigned'
          RETURNING id, locality_id`,
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
        if (!online && dispatch) {
          // Released work goes back to the live market. Clearing the old offer
          // rows lets drivers who lost the first round see it again.
          await query('DELETE FROM offers WHERE ticket_id = $1', [ticket.id]);
          await query('UPDATE tickets SET offer_round = 0 WHERE id = $1', [
            ticket.id,
          ]);
          await dispatch
            .dispatchTicket(ticket.id, { excludeDriverIds: [driverId] })
            .catch((error: unknown) => {
              console.error('[dispatch] release re-offer failed:', error);
            });
        }
      }
      return mapDriver(row);
    },

    async setVanFull(driverId, full) {
      const result = await query<DriverRow>(
        `UPDATE drivers
            SET van_full = $2
          WHERE id = $1
          RETURNING ${DRIVER_COLUMNS}`,
        [driverId, full],
      );
      const row = result.rows[0];
      if (!row) {
        throw new ApiError(404, 'Driver not found', 'not_found');
      }
      emitDriverRouteChanged(driverId);
      return mapDriver(row);
    },

    async wallet(driverId) {
      const startOfDay =
        "(date_trunc('day', now() AT TIME ZONE $2)) AT TIME ZONE $2";
      const [balance, today, jobs, items] = await Promise.all([
        query<{ balance: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS balance
             FROM reward_ledger
            WHERE driver_id = $1`,
          [driverId],
        ),
        query<{ earned: string }>(
          `SELECT COALESCE(SUM(amount), 0)::text AS earned
             FROM reward_ledger
            WHERE driver_id = $1 AND created_at >= ${startOfDay}`,
          [driverId, config.timezone],
        ),
        query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM completions
            WHERE driver_id = $1
              AND verified = true
              AND created_at >= ${startOfDay}`,
          [driverId, config.timezone],
        ),
        query<{ ticket_id: string; amount: string; created_at: Date }>(
          `SELECT ticket_id, amount::text AS amount, created_at
             FROM reward_ledger
            WHERE driver_id = $1
            ORDER BY created_at DESC
            LIMIT 50`,
          [driverId],
        ),
      ]);

      return {
        balance: Number(balance.rows[0]?.balance ?? 0),
        todayEarned: Number(today.rows[0]?.earned ?? 0),
        todayCompletedJobs: Number(jobs.rows[0]?.count ?? 0),
        items: items.rows.map((row) => ({
          ticketId: row.ticket_id,
          amount: Number(row.amount),
          createdAt: row.created_at.toISOString(),
        })),
      };
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

