#!/usr/bin/env tsx
/**
 * Phase 4 load test: 200 reports/hour with 50 concurrent drivers.
 *
 * This writes real tickets and offers to the configured database, so it only
 * runs with an explicit --confirm flag. It also removes the temporary
 * `load-*@overflowgo.local` drivers when it finishes.
 *
 * Usage:
 *   npm run load:test -- --confirm
 *   npm run load:test -- --confirm --reports 200 --drivers 50 --duration 60
 */

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import sharp from 'sharp';
import { hashPassword } from '../apps/api/src/services/auth';

const DEFAULT_DATABASE_URL =
  'postgres://overflowgo:overflowgo_dev@localhost:5433/overflowgo';

interface Options {
  reports: number;
  drivers: number;
  durationSeconds: number;
  concurrency: number;
  apiUrl: string;
}

function readOptions(): Options {
  const args = process.argv.slice(2);
  if (!args.includes('--confirm')) {
    console.error(
      'This test writes tickets and offers. Re-run with --confirm.\n' +
        'Usage: npm run load:test -- --confirm [--reports 200] [--drivers 50] [--duration 60]',
    );
    process.exit(1);
  }

  const value = (name: string, fallback: number): number => {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    const parsed = Number(args[index + 1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    reports: value('--reports', 200),
    drivers: value('--drivers', 50),
    durationSeconds: value('--duration', 60),
    concurrency: value('--concurrency', 8),
    apiUrl: process.env.API_URL ?? 'http://127.0.0.1:4000',
  };
}

interface Sample {
  ok: boolean;
  status: number;
  ms: number;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index]!;
}

async function main(): Promise<void> {
  const options = readOptions();
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const runId = Date.now().toString(36);
  const emails = Array.from(
    { length: options.drivers },
    (_, index) => `load-${runId}-${index}@overflowgo.local`,
  );

  try {
    const locality = await client.query<{
      id: string;
      lat: string;
      lng: string;
    }>(
      `SELECT id, ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng
         FROM localities ORDER BY name LIMIT 1`,
    );
    if (!locality.rows[0]) {
      throw new Error('Seed at least one locality first (npm run seed:localities)');
    }
    const centre = locality.rows[0];

    await client.query("DELETE FROM drivers WHERE email LIKE 'load-%@overflowgo.local'");
    const passwordHash = await hashPassword('load-pass-123');

    for (const [index, email] of emails.entries()) {
      await client.query(
        `INSERT INTO drivers (
           name, email, password_hash, phone, vehicle_no, is_online,
           last_location, last_ping_at
         )
         VALUES (
           $1, $2, $3, '', '', true,
           ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, now()
         )`,
        [
          `Load Driver ${index + 1}`,
          email,
          passwordHash,
          Number(centre.lng) + (Math.random() - 0.5) * 0.01,
          Number(centre.lat) + (Math.random() - 0.5) * 0.01,
        ],
      );
    }

    const tokens: string[] = [];
    for (let index = 0; index < emails.length; index += 10) {
      const batch = emails.slice(index, index + 10);
      const results = await Promise.all(
        batch.map(async (email) => {
          const response = await fetch(`${options.apiUrl}/api/driver/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              email,
              password: 'load-pass-123',
              deviceId: `load-device-${runId}-${email}`,
            }),
          });
          const body = (await response.json()) as { token?: string };
          return response.ok ? body.token ?? null : null;
        }),
      );
      tokens.push(...results.filter((token): token is string => !!token));
    }
    console.log(
      `[load] ${tokens.length}/${options.drivers} drivers online near ${centre.id}`,
    );

    let heartbeatTimer: NodeJS.Timeout | null = null;
    if (tokens.length) {
      heartbeatTimer = setInterval(() => {
        for (const token of tokens) {
          void fetch(`${options.apiUrl}/api/driver/location`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              lat: Number(centre.lat) + (Math.random() - 0.5) * 0.01,
              lng: Number(centre.lng) + (Math.random() - 0.5) * 0.01,
            }),
          }).catch(() => undefined);
        }
      }, 10_000);
    }

    const basePhoto = readFileSync(
      'apps/api/uploads/reports/7ba94d1c-715f-4b91-8cf4-231e5fa3b36a.jpg',
    );
    const samples: Sample[] = [];
    const gapMs = (options.durationSeconds * 1000) / options.reports;

    async function submit(index: number): Promise<void> {
      const photo = await sharp(basePhoto)
        .extend({
          top: 1 + (index % 5),
          bottom: 1 + (index % 7),
          left: 1 + (index % 3),
          right: 1 + (index % 11),
          background: {
            r: (index * 37) % 256,
            g: (index * 71) % 256,
            b: (index * 13) % 256,
          },
        })
        .jpeg({ quality: 70 })
        .toBuffer();

      const form = new FormData();
      form.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'load.jpg');
      form.append('lat', String(Number(centre.lat) + Math.random() * 0.001));
      form.append('lng', String(Number(centre.lng) + Math.random() * 0.001));
      form.append('deviceId', `load-citizen-${runId}-${index}`);
      form.append('clientReportId', `load-report-${runId}-${index}`);

      const started = performance.now();
      try {
        const response = await fetch(`${options.apiUrl}/api/reports`, {
          method: 'POST',
          body: form,
        });
        samples.push({
          ok: response.ok,
          status: response.status,
          ms: performance.now() - started,
        });
        await response.arrayBuffer();
      } catch {
        samples.push({
          ok: false,
          status: 0,
          ms: performance.now() - started,
        });
      }
    }

    console.log(
      `[load] sending ${options.reports} reports over ${options.durationSeconds}s ` +
        `(${options.concurrency} at a time)`,
    );

    let next = 0;
    const startedAt = Date.now();
    async function worker(): Promise<void> {
      while (next < options.reports) {
        const index = next;
        next += 1;
        const wait = startedAt + index * gapMs - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        await submit(index);
      }
    }
    await Promise.all(
      Array.from({ length: options.concurrency }, () => worker()),
    );

    if (heartbeatTimer) clearInterval(heartbeatTimer);

    const latencies = samples.map((sample) => sample.ms);
    const accepted = samples.filter((sample) => sample.ok).length;
    console.log(
      `[load] reports: ${samples.length}, ok: ${accepted}, ` +
        `failed: ${samples.length - accepted}`,
    );
    console.log(
      `[load] latency ms p50=${percentile(latencies, 0.5).toFixed(0)} ` +
        `p95=${percentile(latencies, 0.95).toFixed(0)} ` +
        `max=${Math.max(...latencies, 0).toFixed(0)}`,
    );
  } finally {
    await client.query("DELETE FROM drivers WHERE email LIKE 'load-%@overflowgo.local'");
    await client.end();
  }
}

main().catch((error) => {
  console.error('[load] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
