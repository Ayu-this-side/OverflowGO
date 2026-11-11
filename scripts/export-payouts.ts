#!/usr/bin/env tsx
/**
 * Export verified driver rewards for a date range as CSV.
 * Payouts happen outside the app.
 *
 * Usage:
 *   npm run export:payouts -- --from 2026-11-01 --to 2026-11-30
 *   npm run export:payouts -- --from 2026-11-01 --to 2026-11-30 --out payouts.csv
 *
 * Dates are inclusive calendar days in the configured timezone.
 */

import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { loadConfig } from '../apps/api/src/config';

const DEFAULT_DATABASE_URL =
  'postgres://overflowgo:overflowgo_dev@localhost:5433/overflowgo';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function main(): Promise<void> {
  const from = argValue('--from');
  const to = argValue('--to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Usage: npm run export:payouts -- --from YYYY-MM-DD --to YYYY-MM-DD [--out file.csv]');
  }

  const config = loadConfig();
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query<{
      driver_id: string;
      driver_name: string;
      email: string;
      ticket_id: string;
      amount: string;
      created_at: Date;
    }>(
      `SELECT d.id AS driver_id,
              d.name AS driver_name,
              d.email,
              r.ticket_id,
              r.amount::text AS amount,
              r.created_at
         FROM reward_ledger r
         JOIN drivers d ON d.id = r.driver_id
        WHERE r.created_at >= ($1::date::timestamp AT TIME ZONE $3)
          AND r.created_at < (($2::date + 1)::timestamp AT TIME ZONE $3)
        ORDER BY d.name, r.created_at`,
      [from, to, config.timezone],
    );

    const lines = [
      'driver_id,driver_name,email,ticket_id,amount,created_at',
      ...result.rows.map((row) =>
        [
          row.driver_id,
          row.driver_name,
          row.email,
          row.ticket_id,
          row.amount,
          row.created_at.toISOString(),
        ]
          .map((value) => csvCell(String(value)))
          .join(','),
      ),
    ];

    const csv = `${lines.join('\n')}\n`;
    const out = argValue('--out');
    if (out) {
      writeFileSync(out, csv, 'utf8');
      console.log(`[payouts] wrote ${result.rowCount} row(s) to ${out}`);
    } else {
      process.stdout.write(csv);
    }

    const total = result.rows.reduce((sum, row) => sum + Number(row.amount), 0);
    console.error(
      `[payouts] ${result.rows.length} reward(s), total ${total.toFixed(2)}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[payouts] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
