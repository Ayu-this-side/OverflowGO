import { mkdtempSync, rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../src/services/ai';
import type { AiPrediction } from '@overflowgo/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { query } from '../src/db/pool';
import { AiServiceUnavailableError } from '../src/errors';
import {
  REJECT_NO_GARBAGE,
  REJECT_NOTHING_VISIBLE,
} from '../src/services/reports';
import {
  closeTestDatabase,
  registerDriverDevice,
  resetDatabase,
  seedDriver,
  seedLocality,
  setupTestDatabase,
} from './db';

const config = loadConfig();
const PHOTO_LAT = 18.5204;
const PHOTO_LNG = 73.8567;

const basePrediction: AiPrediction = {
  overflow_conf: 0,
  garbage_conf: 0,
  bin_conf: 0,
  detections: [],
};

function fakeAi(overrides: Partial<AiPrediction> = {}): AiClient {
  return {
    predict: async () => ({ ...basePrediction, ...overrides }),
  };
}

function failingAi(): AiClient {
  return {
    predict: async () => {
      throw new AiServiceUnavailableError();
    },
  };
}

function appWith(ai: AiClient): Express {
  return createApp({ config, ai });
}

async function makePhoto(seed: number): Promise<Buffer> {
  const width = 96;
  const height = 72;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      raw[index] = (x * 3 + seed * 17) % 256;
      raw[index + 1] = (y * 4 + seed * 31) % 256;
      raw[index + 2] = ((x + y) * 2 + seed * 7) % 256;
    }
  }

  return sharp(raw, { raw: { width, height, channels } }).jpeg().toBuffer();
}

interface PostReportOptions {
  photo: Buffer;
  lat?: number;
  lng?: number;
  deviceId?: string;
  clientReportId?: string;
  note?: string;
}

function postReport(app: Express, options: PostReportOptions) {
  let builder = request(app)
    .post('/api/reports')
    .field('lat', String(options.lat ?? PHOTO_LAT))
    .field('lng', String(options.lng ?? PHOTO_LNG))
    .field('deviceId', options.deviceId ?? 'citizen-device');

  if (options.clientReportId) {
    builder = builder.field('clientReportId', options.clientReportId);
  }
  if (options.note) {
    builder = builder.field('note', options.note);
  }

  return builder.attach('photo', options.photo, {
    filename: 'photo.jpg',
    contentType: 'image/jpeg',
  });
}

let photoDir: string;
const originalPhotoDir = process.env.PHOTO_STORAGE_DIR;

beforeAll(async () => {
  photoDir = mkdtempSync(join(tmpdir(), 'overflowgo-test-photos-'));
  process.env.PHOTO_STORAGE_DIR = photoDir;
  await setupTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
  rmSync(photoDir, { recursive: true, force: true });
  if (originalPhotoDir === undefined) {
    delete process.env.PHOTO_STORAGE_DIR;
  } else {
    process.env.PHOTO_STORAGE_DIR = originalPhotoDir;
  }
});

beforeEach(async () => {
  await resetDatabase();
});

describe('POST /api/reports', () => {
  it('accepts an overflowing bin, creates a ticket and stores the photo', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.92, bin_conf: 0.88 }));

    const response = await postReport(app, { photo: await makePhoto(1) });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: 'accepted',
      merged: false,
    });
    expect(typeof response.body.reportId).toBe('string');
    expect(typeof response.body.ticketId).toBe('string');

    const ticket = await query(
      'SELECT status, report_count, reward_eligible, flag_reason, locality_id FROM tickets WHERE id = $1',
      [response.body.ticketId],
    );
    expect(ticket.rows[0]).toMatchObject({
      status: 'open',
      report_count: 1,
      reward_eligible: true,
      flag_reason: null,
    });

    const report = await query(
      'SELECT result, ai_trigger, ai_overflow_conf, photo_path FROM reports WHERE id = $1',
      [response.body.reportId],
    );
    expect(report.rows[0]).toMatchObject({
      result: 'accepted',
      ai_trigger: 'overflow',
    });
    expect(Number(report.rows[0].ai_overflow_conf)).toBeCloseTo(0.92, 2);
    expect(existsSync(join(photoDir, 'reports', report.rows[0].photo_path))).toBe(
      true,
    );
  });

  it('accepts loose garbage as well as overflow', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ garbage_conf: 0.8, bin_conf: 0.5 }));

    const response = await postReport(app, { photo: await makePhoto(2) });

    expect(response.status).toBe(201);
    const report = await query(
      'SELECT ai_trigger, result FROM reports WHERE id = $1',
      [response.body.reportId],
    );
    expect(report.rows[0]).toMatchObject({
      result: 'accepted',
      ai_trigger: 'garbage',
    });
  });

  it('marks a report as "both" when overflow and garbage both pass', async () => {
    await seedLocality();
    const app = appWith(
      fakeAi({ overflow_conf: 0.9, garbage_conf: 0.9, bin_conf: 0.9 }),
    );

    const response = await postReport(app, { photo: await makePhoto(3) });

    const report = await query('SELECT ai_trigger FROM reports WHERE id = $1', [
      response.body.reportId,
    ]);
    expect(report.rows[0].ai_trigger).toBe('both');
  });

  it('rejects a photo with no visible bin or garbage', async () => {
    await seedLocality();
    const app = appWith(fakeAi());

    const response = await postReport(app, { photo: await makePhoto(4) });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'rejected',
      reportId: expect.any(String),
      reason: REJECT_NOTHING_VISIBLE,
    });

    const tickets = await query('SELECT count(*)::int AS count FROM tickets');
    expect(tickets.rows[0].count).toBe(0);

    const report = await query(
      'SELECT result, reject_reason, ticket_id, photo_path FROM reports WHERE id = $1',
      [response.body.reportId],
    );
    expect(report.rows[0]).toMatchObject({
      result: 'rejected',
      reject_reason: REJECT_NOTHING_VISIBLE,
      ticket_id: null,
      photo_path: null,
    });
  });

  it('accepts a bin-only photo and records the garbage_bin trigger', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ bin_conf: 0.9 }));

    const response = await postReport(app, { photo: await makePhoto(5) });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('accepted');

    const report = await query(
      'SELECT result, ai_trigger FROM reports WHERE id = $1',
      [response.body.reportId],
    );
    expect(report.rows[0]).toMatchObject({
      result: 'accepted',
      ai_trigger: 'garbage_bin',
    });
  });

  it('rejects when every detection is below its configured threshold', async () => {
    await seedLocality();
    const app = appWith(
      fakeAi({ overflow_conf: 0.2, garbage_conf: 0.2, bin_conf: 0.2 }),
    );

    const response = await postReport(app, { photo: await makePhoto(5) });

    expect(response.status).toBe(200);
    expect(response.body.reason).toBe(REJECT_NO_GARBAGE);
  });

  it('merges a nearby report into the open ticket', async () => {
    const localityId = await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));

    const first = await postReport(app, { photo: await makePhoto(10) });
    const second = await postReport(app, {
      photo: await makePhoto(137),
      lat: PHOTO_LAT + 0.00002,
      lng: PHOTO_LNG + 0.00002,
      deviceId: 'other-device',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      status: 'merged',
      merged: true,
      ticketId: first.body.ticketId,
    });

    const tickets = await query(
      'SELECT id, report_count, locality_id FROM tickets',
    );
    expect(tickets.rows).toHaveLength(1);
    expect(tickets.rows[0]).toMatchObject({
      id: first.body.ticketId,
      report_count: 2,
      locality_id: localityId,
    });

    const reports = await query(
      'SELECT result FROM reports ORDER BY created_at ASC',
    );
    expect(reports.rows.map((row) => row.result)).toEqual([
      'accepted',
      'merged',
    ]);
  });

  it('creates a separate ticket when the report is outside the merge radius', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));

    const first = await postReport(app, { photo: await makePhoto(12) });
    const second = await postReport(app, {
      photo: await makePhoto(13),
      lat: PHOTO_LAT + 0.0001,
    });

    expect(second.body.status).toBe('accepted');
    expect(second.body.ticketId).not.toBe(first.body.ticketId);
    const tickets = await query('SELECT count(*)::int AS count FROM tickets');
    expect(tickets.rows[0].count).toBe(2);
  });

  it('returns the same result for a retried clientReportId', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));
    const photo = await makePhoto(14);

    const first = await postReport(app, {
      photo,
      clientReportId: 'report-key-1',
    });
    const second = await postReport(app, {
      photo,
      clientReportId: 'report-key-1',
      lat: PHOTO_LAT + 0.001,
    });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    const reports = await query(
      'SELECT count(*)::int AS count FROM reports WHERE client_report_id = $1',
      ['report-key-1'],
    );
    expect(reports.rows[0].count).toBe(1);
    const tickets = await query('SELECT count(*)::int AS count FROM tickets');
    expect(tickets.rows[0].count).toBe(1);
  });

  it('treats the same photo inside 24 hours as a duplicate', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));
    const photo = await makePhoto(15);

    const first = await postReport(app, { photo });
    const second = await postReport(app, {
      photo,
      lat: PHOTO_LAT + 0.01,
      clientReportId: 'different-key',
    });

    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      status: 'merged',
      merged: true,
      ticketId: first.body.ticketId,
    });
    expect(second.body.message).toContain('already submitted');

    const tickets = await query('SELECT count(*)::int AS count FROM tickets');
    expect(tickets.rows[0].count).toBe(1);
    const reports = await query('SELECT count(*)::int AS count FROM reports');
    expect(reports.rows[0].count).toBe(2);
  });

  it('marks a ticket from a registered driver device as reward-ineligible', async () => {
    await seedLocality();
    const driverId = await seedDriver();
    await registerDriverDevice(driverId, 'driver-phone');
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));

    const response = await postReport(app, {
      photo: await makePhoto(16),
      deviceId: 'driver-phone',
    });

    const ticket = await query(
      'SELECT reward_eligible, flag_reason FROM tickets WHERE id = $1',
      [response.body.ticketId],
    );
    expect(ticket.rows[0]).toMatchObject({
      reward_eligible: false,
      flag_reason: 'driver_device',
    });
  });

  it('excludes online drivers within 150 m but keeps far and stale drivers eligible', async () => {
    await seedLocality();
    const nearDriver = await seedDriver({ lat: PHOTO_LAT + 0.0005 });
    const farDriver = await seedDriver({ lat: PHOTO_LAT + 0.02 });
    const staleDriver = await seedDriver({
      lat: PHOTO_LAT + 0.0005,
      lastPingSecondsAgo: 120,
    });
    const fullVanDriver = await seedDriver({
      lat: PHOTO_LAT + 0.0005,
      vanFull: true,
    });

    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));
    const response = await postReport(app, { photo: await makePhoto(17) });

    const exclusions = await query(
      'SELECT driver_id, reason FROM ticket_reward_exclusions WHERE ticket_id = $1',
      [response.body.ticketId],
    );
    expect(exclusions.rows).toEqual([
      { driver_id: nearDriver, reason: 'driver_nearby' },
    ]);
    for (const driverId of [farDriver, staleDriver, fullVanDriver]) {
      expect(exclusions.rows.map((row) => row.driver_id)).not.toContain(driverId);
    }
  });

  it('returns 503 and stores nothing when the AI service is unavailable', async () => {
    await seedLocality();
    const app = appWith(failingAi());

    const response = await postReport(app, { photo: await makePhoto(18) });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ error: 'ai_unavailable' });
    const reports = await query('SELECT count(*)::int AS count FROM reports');
    const tickets = await query('SELECT count(*)::int AS count FROM tickets');
    expect(reports.rows[0].count).toBe(0);
    expect(tickets.rows[0].count).toBe(0);
  });

  it('returns 503 when no locality has been seeded', async () => {
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));

    const response = await postReport(app, { photo: await makePhoto(19) });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('no_locality');
    const tickets = await query('SELECT count(*)::int AS count FROM tickets');
    expect(tickets.rows[0].count).toBe(0);
  });

  it('requires a photo', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));

    const response = await request(app)
      .post('/api/reports')
      .field('lat', String(PHOTO_LAT))
      .field('lng', String(PHOTO_LNG))
      .field('deviceId', 'citizen-device');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('missing_photo');
  });

  it('rejects invalid coordinates', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));

    const response = await postReport(app, {
      photo: await makePhoto(20),
      lat: 999,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('validation_error');
  });

  it('rejects a photo over 5 MB with 413', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 64, 1);

    const response = await postReport(app, { photo: oversized });

    expect(response.status).toBe(413);
    expect(response.body.error).toBe('file_too_large');
  });
});

describe('GET /api/reports/:id', () => {
  it('returns the report and ticket status', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));
    const created = await postReport(app, { photo: await makePhoto(21) });

    const response = await request(app)
      .get(`/api/reports/${created.body.reportId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: created.body.reportId,
      status: 'accepted',
      reason: null,
      ticketId: created.body.ticketId,
      ticketStatus: 'open',
    });
    expect(typeof response.body.createdAt).toBe('string');
  });

  it('returns 404 for an unknown or malformed id', async () => {
    const app = appWith(fakeAi());
    await request(app).get('/api/reports/not-a-uuid').expect(404);
    await request(app)
      .get('/api/reports/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });
});

describe('GET /api/photos/:filename', () => {
  it('serves the stored JPEG and rejects unknown names', async () => {
    await seedLocality();
    const app = appWith(fakeAi({ overflow_conf: 0.9, bin_conf: 0.9 }));
    const created = await postReport(app, { photo: await makePhoto(22) });

    const report = await query<{ photo_path: string }>(
      'SELECT photo_path FROM reports WHERE id = $1',
      [created.body.reportId],
    );
    const filename = report.rows[0]!.photo_path;

    const photo = await request(app).get(`/api/photos/${filename}`).expect(200);
    expect(photo.headers['content-type']).toContain('image/jpeg');

    await request(app).get('/api/photos/not-a-photo.txt').expect(404);
    await request(app).get('/api/photos/../config.json').expect(404);
  });
});
