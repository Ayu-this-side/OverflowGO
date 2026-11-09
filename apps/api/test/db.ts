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
  online?: boolean;
  vanFull?: boolean;
  lat?: number;
  lng?: number;
  lastPingSecondsAgo?: number;
}

export async function seedDriver({
  name = 'Driver',
  email = `driver-${Math.random().toString(36).slice(2)}@example.com`,
  online = true,
  vanFull = false,
  lat = 18.5204,
  lng = 73.8567,
  lastPingSecondsAgo = 0,
}: SeedDriverInput = {}): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO drivers (
       name, email, password_hash, is_online, van_full,
       last_location, last_ping_at
     )
     VALUES (
       $1, $2, 'test-hash', $3, $4,
       ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
       now() - make_interval(secs => $7)
     )
     RETURNING id`,
    [name, email, online, vanFull, lng, lat, lastPingSecondsAgo],
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
