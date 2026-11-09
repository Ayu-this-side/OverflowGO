#!/usr/bin/env tsx
/**
 * Load localities from a CSV file into the database.
 *
 * CSV columns: name,lat,lng
 *
 * Usage:
 *   npm run seed:localities
 *   npm run seed:localities -- --file scripts/data/locality-areas.csv
 *
 * The sample file uses fake coordinates. Replace it with the real city areas
 * when they are available; re-running updates existing names in place.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const DEFAULT_FILE = 'scripts/data/localities.sample.csv';
const DEFAULT_DATABASE_URL =
  'postgres://overflowgo:overflowgo_dev@localhost:5433/overflowgo';

interface LocalityRow {
  name: string;
  lat: number;
  lng: number;
  line: number;
}

interface CliOptions {
  file: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { file: DEFAULT_FILE, dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file' || argument === '-f') {
      const value = argv[index + 1];
      if (!value) throw new Error('--file needs a path');
      options.file = value;
      index += 1;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: npm run seed:localities -- [--file <csv>] [--dry-run]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function parseCsv(contents: string): LocalityRow[] {
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length < 2) {
    throw new Error('CSV must contain a header and at least one locality');
  }

  const header = lines[0]!.split(',').map((cell) => cell.trim().toLowerCase());
  const nameIndex = header.indexOf('name');
  const latIndex = header.indexOf('lat');
  const lngIndex = header.indexOf('lng');

  if (nameIndex < 0 || latIndex < 0 || lngIndex < 0) {
    throw new Error(
      `CSV header must be "name,lat,lng" (found: ${lines[0]})`,
    );
  }

  const rows: LocalityRow[] = [];
  const names = new Set<string>();

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const cells = line.split(',').map((cell) => cell.trim());
    const name = cells[nameIndex] ?? '';
    const lat = Number(cells[latIndex]);
    const lng = Number(cells[lngIndex]);
    const lineNumber = index + 1;

    if (!name) {
      throw new Error(`Line ${lineNumber}: name is required`);
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error(`Line ${lineNumber}: lat must be between -90 and 90`);
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error(`Line ${lineNumber}: lng must be between -180 and 180`);
    }
    if (names.has(name)) {
      throw new Error(`Line ${lineNumber}: duplicate locality name "${name}"`);
    }

    names.add(name);
    rows.push({ name, lat, lng, line: lineNumber });
  }

  return rows;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const file = resolve(process.cwd(), options.file);
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

  console.log(`[seed] ${rows.length} localities from ${file}`);
  console.log(`[seed] database: ${databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);

  if (options.dryRun) {
    for (const row of rows) {
      console.log(`  ${row.name} (${row.lat}, ${row.lng})`);
    }
    console.log('[seed] dry run, nothing written');
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const table = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.localities') IS NOT NULL AS exists`,
    );
    if (!table.rows[0]?.exists) {
      throw new Error('The localities table is missing. Run `npm run db:migrate` first.');
    }

    let inserted = 0;
    let updated = 0;

    await client.query('BEGIN');
    try {
      for (const row of rows) {
        const result = await client.query<{ inserted: boolean }>(
          `INSERT INTO localities (name, center)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
           ON CONFLICT (name)
           DO UPDATE SET center = EXCLUDED.center
           RETURNING (xmax = 0) AS inserted`,
          [row.name, row.lng, row.lat],
        );
        if (result.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log(`[seed] done. inserted=${inserted}, updated=${updated}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
