#!/usr/bin/env tsx
/**
 * Seed drivers and their regular route order.
 *
 * CSV columns: name,email,password,phone,vehicle_no,route
 * `route` is a semicolon-separated list of locality names in regular order.
 *
 * Usage:
 *   npm run seed:drivers
 *   npm run seed:drivers -- --file scripts/data/drivers.sample.csv
 *
 * Re-running updates the driver password/details and replaces their route.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { hashPassword } from '../apps/api/src/services/auth';

const DEFAULT_FILE = 'scripts/data/drivers.sample.csv';
const DEFAULT_DATABASE_URL =
  'postgres://overflowgo:overflowgo_dev@localhost:5433/overflowgo';

interface DriverCsvRow {
  name: string;
  email: string;
  password: string;
  phone: string;
  vehicleNo: string;
  route: string[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseCsv(path: string): DriverCsvRow[] {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (lines.length < 2) {
    throw new Error(`No driver rows found in ${path}`);
  }

  const header = lines[0]!.split(',').map((column) => column.trim());
  const required = ['name', 'email', 'password', 'phone', 'vehicle_no', 'route'];
  for (const column of required) {
    if (!header.includes(column)) {
      throw new Error(`Missing CSV column "${column}" in ${path}`);
    }
  }

  return lines.slice(1).map((line, index) => {
    const values = line.split(',').map((value) => value.trim());
    const record = Object.fromEntries(
      header.map((column, columnIndex) => [column, values[columnIndex] ?? '']),
    ) as Record<string, string>;

    if (!record.name || !record.email || !record.password) {
      throw new Error(`Row ${index + 2} needs name, email and password`);
    }

    return {
      name: record.name,
      email: record.email,
      password: record.password,
      phone: record.phone ?? '',
      vehicleNo: record.vehicle_no ?? '',
      route: (record.route ?? '')
        .split(';')
        .map((name) => name.trim())
        .filter(Boolean),
    };
  });
}

async function main(): Promise<void> {
  const file = resolve(argValue('--file') ?? DEFAULT_FILE);
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const drivers = parseCsv(file);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const localityResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM localities',
    );
    const localities = new Map(
      localityResult.rows.map((row) => [row.name, row.id]),
    );

    await client.query('BEGIN');
    for (const driver of drivers) {
      const missing = driver.route.filter((name) => !localities.has(name));
      if (missing.length) {
        throw new Error(
          `Driver ${driver.email} references unknown localities: ${missing.join(', ')}. Run npm run seed:localities first.`,
        );
      }

      const passwordHash = await hashPassword(driver.password);
      const upserted = await client.query<{ id: string }>(
        `INSERT INTO drivers (name, email, password_hash, phone, vehicle_no)
         VALUES ($1, lower($2), $3, $4, $5)
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name,
               password_hash = EXCLUDED.password_hash,
               phone = EXCLUDED.phone,
               vehicle_no = EXCLUDED.vehicle_no
         RETURNING id`,
        [
          driver.name,
          driver.email,
          passwordHash,
          driver.phone,
          driver.vehicleNo,
        ],
      );
      const driverId = upserted.rows[0]!.id;

      await client.query('DELETE FROM route_stops WHERE driver_id = $1', [
        driverId,
      ]);
      for (const [index, localityName] of driver.route.entries()) {
        await client.query(
          `INSERT INTO route_stops (driver_id, locality_id, position)
           VALUES ($1, $2, $3)`,
          [driverId, localities.get(localityName), index + 1],
        );
      }

      console.log(
        `[seed] ${driver.email} -> ${driver.route.join(' -> ') || '(no route)'}`,
      );
    }
    await client.query('COMMIT');

    console.log(`[seed] done. ${drivers.length} driver(s) from ${file}`);
    console.log('[seed] sample password: driver123 (change in production)');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
