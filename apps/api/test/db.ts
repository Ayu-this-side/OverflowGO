import { Client } from 'pg';
import { closePool, query } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

const DEFAULT_TEST_DATABASE_URL =
  'postgres://overflowgo:overflowgo_dev@localhost:5433/overflowgo_test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

if (!/\/[^/?]+_test(?:\?|$)/.test(testDatabaseUrl)) {
  throw new Error(
    `Refusing to run destructive tests against a non-test database: ${testDatabaseUrl}`,
  );
}

// pool.ts reads DATABASE_URL lazily, so this must happen before the first query.
process.env.DATABASE_URL = testDatabaseUrl;

export const TEST_DATABASE_URL = testDatabaseUrl;

const TABLES_TO_TRUNCATE = [
  'ticket_reward_exclusions',
  'reward_ledger',
  'completions',
  'offers',
  'reports',
  'tickets',
  'route_stops',
  'driver_devices',
  'drivers',
  'localities',
];

export async function resetDatabase(): Promise<void> {
  await query(`TRUNCATE ${TABLES_TO_TRUNCATE.join(', ')} CASCADE`);
}

async function ensureTestDatabase(): Promise<void> {
  const url = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe test database name: ${databaseName}`);
  }

  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await client.end();
  }
}

export async function setupTestDatabase(): Promise<void> {
  await ensureTestDatabase();
  await runMigrations(testDatabaseUrl);
  await resetDatabase();
}

export async function closeTestDatabase(): Promise<void> {
  await closePool();
}

export interface SeedLocalityInput {
  name?: string;
  lat?: number;
  lng?: number;
}

export async function seedLocality({
  name = 'Test Locality',
  lat = 18.5204,
  lng = 73.8567,
}: SeedLocalityInput = {}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO localities (name, center)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
     RETURNING id`,
    [name, lng, lat],
  );
  return result.rows[0]!.id;
}

export interface SeedDriverInput {
  name?: string;
  email?: string;
  passwordHash?: string;
  phone?: string;
  vehicleNo?: string;
  online?: boolean;
  vanFull?: boolean;
  lat?: number;
  lng?: number;
  lastPingSecondsAgo?: number;
}

export async function seedDriver({
  name = 'Driver',
  email = `driver-${Math.random().toString(36).slice(2)}@example.com`,
  passwordHash = 'test-hash',
  phone = '',
  vehicleNo = '',
  online = true,
  vanFull = false,
  lat = 18.5204,
  lng = 73.8567,
  lastPingSecondsAgo = 0,
}: SeedDriverInput = {}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO drivers (
       name, email, password_hash, phone, vehicle_no, is_online, van_full,
       last_location, last_ping_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
       now() - make_interval(secs => $10)
     )
     RETURNING id`,
    [
      name,
      email,
      passwordHash,
      phone,
      vehicleNo,
      online,
      vanFull,
      lng,
      lat,
      lastPingSecondsAgo,
    ],
  );
  return result.rows[0]!.id;
}

export async function seedRouteStop(
  driverId: string,
  localityId: string,
  position: number,
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO route_stops (driver_id, locality_id, position)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [driverId, localityId, position],
  );
  return result.rows[0]!.id;
}

export interface SeedTicketInput {
  localityId: string;
  lat?: number;
  lng?: number;
  firstReportedAt?: Date;
  status?: 'open' | 'offered' | 'assigned' | 'completed';
  reportCount?: number;
  assignedDriverId?: string | null;
  rewardEligible?: boolean;
  slaDeadline?: Date | null;
}

export async function seedTicket({
  localityId,
  lat = 18.5204,
  lng = 73.8567,
  firstReportedAt = new Date(),
  status = 'open',
  reportCount = 1,
  assignedDriverId = null,
  rewardEligible = true,
  slaDeadline = null,
}: SeedTicketInput): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO tickets (
       locality_id, location, status, report_count, first_reported_at,
       assigned_driver_id, reward_eligible, assigned_at, sla_deadline,
       offer_round
     )
     VALUES (
       $1,
       ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
       $4, $5, $6, $7, $8,
       CASE WHEN $7::uuid IS NULL THEN NULL ELSE now() END,
       $9,
       CASE WHEN $4::ticket_status = 'offered' THEN 1 ELSE 0 END
     )
     RETURNING id`,
    [
      localityId,
      lng,
      lat,
      status,
      reportCount,
      firstReportedAt,
      assignedDriverId,
      rewardEligible,
      slaDeadline,
    ],
  );
  return result.rows[0]!.id;
}

export async function seedOffer({
  ticketId,
  driverId,
  response = null,
  expiresAt = new Date(Date.now() + 30_000),
  distanceMeters = 500,
}: {
  ticketId: string;
  driverId: string;
  response?: 'accepted' | 'rejected' | 'ignored' | 'expired' | 'taken_by_other' | null;
  expiresAt?: Date;
  distanceMeters?: number;
}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO offers (ticket_id, driver_id, response, expires_at, distance_meters)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [ticketId, driverId, response, expiresAt, distanceMeters],
  );
  return result.rows[0]!.id;
}

export async function registerDriverDevice(
  driverId: string,
  deviceId: string,
): Promise<void> {
  await query(
    `INSERT INTO driver_devices (driver_id, device_id) VALUES ($1, $2)`,
    [driverId, deviceId],
  );
}
