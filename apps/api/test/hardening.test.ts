import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
import { hashPassword } from '../src/services/auth';
import { createRetentionService } from '../src/services/retention';
import {
  saveCompletionPhoto,
  saveReportPhoto,
} from '../src/services/storage';
import { maybeSaveTrainingSample } from '../src/services/training';
import {
  closeTestDatabase,
  resetDatabase,
  seedDriver,
  seedLocality,
  seedTicket,
  setupTestDatabase,
} from './db';

const config = loadConfig();

function fakeAi(overrides: Partial<AiPrediction> = {}): AiClient {
  return {
    predict: async () => ({
      overflow_conf: 0.92,
      garbage_conf: 0.1,
      bin_conf: 0.3,
      detections: [],
      ...overrides,
    }),
  };
}

function appWith(ai: AiClient = fakeAi()): Express {
  return createApp({ config, ai });
}

async function makePhoto(seed: number, border = 0): Promise<Buffer> {
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
  let pipeline = sharp(raw, { raw: { width, height, channels } });
  if (border > 0) {
    pipeline = pipeline.extend({
      top: border,
      bottom: border,
      left: border,
      right: border,
      background: { r: 210, g: 40, b: 60 },
    });
  }
  return pipeline.jpeg().toBuffer();
}

async function submitReport(
  app: Express,
  photo: Buffer,
  lat: number,
  lng: number,
  clientReportId: string,
) {
  return request(app)
    .post('/api/reports')
    .field('lat', String(lat))
    .field('lng', String(lng))
    .field('deviceId', 'hardening-test-device')
    .field('clientReportId', clientReportId)
    .attach('photo', photo, {
      filename: 'report.jpg',
      contentType: 'image/jpeg',
    });
}

let photoDir: string;
const originalPhotoDir = process.env.PHOTO_STORAGE_DIR;

beforeAll(async () => {
  photoDir = mkdtempSync(join(tmpdir(), 'overflowgo-hardening-photos-'));
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

describe('perceptual duplicate photos', () => {
  it('merges a visually similar photo beyond the location radius', async () => {
    const localityId = await seedLocality({ name: 'A' });
    void localityId;
    const app = appWith();
    const base = await makePhoto(5);

    const first = await submitReport(
      app,
      base,
      18.5204,
      73.8567,
      'similar-1',
    );
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('accepted');

    const second = await submitReport(
      app,
      await makePhoto(5, 2),
      18.5314,
      73.8567,
      'similar-2',
    );
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({
      status: 'merged',
      ticketId: first.body.ticketId,
      merged: true,
    });

    const tickets = await query<{ count: string }>(
      'SELECT count(*)::text AS count FROM tickets',
    );
    expect(Number(tickets.rows[0]!.count)).toBe(1);
  });

  it('keeps genuinely different photos as separate tickets', async () => {
    await seedLocality({ name: 'A' });
    const app = appWith();

    const first = await submitReport(
      app,
      await makePhoto(11),
      18.5204,
      73.8567,
      'distinct-1',
    );
    const second = await submitReport(
      app,
      await makePhoto(97),
      18.5314,
      73.8567,
      'distinct-2',
    );

    expect(first.body.status).toBe('accepted');
    expect(second.body.status).toBe('accepted');
    expect(second.body.ticketId).not.toBe(first.body.ticketId);
  });
});

describe('photo retention', () => {
  it('deletes photos and clears paths for old completed tickets only', async () => {
    const localityId = await seedLocality({ name: 'A' });
    const driverId = await seedDriver();

    const oldPhoto = await saveReportPhoto(await makePhoto(1));
    const oldAfter = await saveCompletionPhoto(await makePhoto(2));
    const oldTicket = await seedTicket({
      localityId,
      status: 'completed',
    });
    await query(
      'UPDATE tickets SET completed_at = now() - interval \'9 days\' WHERE id = $1',
      [oldTicket],
    );
    await query(
      `INSERT INTO reports (
         ticket_id, photo_path, location, device_id, result, ai_trigger
       )
       VALUES (
         $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
         'retention-device', 'accepted', 'overflow'
       )`,
      [oldTicket, oldPhoto, 73.8567, 18.5204],
    );
    await query(
      `INSERT INTO completions (
         ticket_id, driver_id, after_photo_path, location, verified
       )
       VALUES (
         $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, true
       )`,
      [oldTicket, driverId, oldAfter, 73.8567, 18.5204],
    );

    const recentPhoto = await saveReportPhoto(await makePhoto(3));
    const recentTicket = await seedTicket({
      localityId,
      status: 'completed',
    });
    await query(
      'UPDATE tickets SET completed_at = now() WHERE id = $1',
      [recentTicket],
    );
    await query(
      `INSERT INTO reports (
         ticket_id, photo_path, location, device_id, result, ai_trigger
       )
       VALUES (
         $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
         'retention-device', 'accepted', 'overflow'
       )`,
      [recentTicket, recentPhoto, 73.8567, 18.5204],
    );

    const result = await createRetentionService({ config }).run();

    expect(result).toMatchObject({ reportPhotos: 1, completionPhotos: 1 });
    expect(existsSync(join(photoDir, 'reports', oldPhoto))).toBe(false);
    expect(existsSync(join(photoDir, 'completions', oldAfter))).toBe(false);
    expect(existsSync(join(photoDir, 'reports', recentPhoto))).toBe(true);

    const oldPaths = await query<{
      photo_path: string | null;
      after_photo_path: string | null;
    }>(
      `SELECT r.photo_path, c.after_photo_path
         FROM reports r
         LEFT JOIN completions c ON c.ticket_id = r.ticket_id
        WHERE r.ticket_id = $1`,
      [oldTicket],
    );
    expect(oldPaths.rows[0]).toEqual({
      photo_path: null,
      after_photo_path: null,
    });

    const recent = await query<{ photo_path: string | null }>(
      'SELECT photo_path FROM reports WHERE ticket_id = $1',
      [recentTicket],
    );
    expect(recent.rows[0]!.photo_path).toBe(recentPhoto);
  });
});

describe('optional retraining collection', () => {
  it('is off by default and stores only uncertain photos when enabled', async () => {
    const buffer = await makePhoto(21);
    const uncertain: AiPrediction = {
      overflow_conf: 0.42,
      garbage_conf: 0.2,
      bin_conf: 0.8,
      detections: [],
    };

    await maybeSaveTrainingSample(buffer, uncertain, config);
    expect(
      (await query('SELECT count(*)::int AS count FROM retraining_samples'))
        .rows[0]!.count,
    ).toBe(0);

    await maybeSaveTrainingSample(buffer, uncertain, {
      ...config,
      retrainingCollection: true,
    });
    const enabled = await query<{ photo_path: string }>(
      'SELECT photo_path FROM retraining_samples',
    );
    expect(enabled.rows).toHaveLength(1);
    expect(existsSync(join(photoDir, 'training', enabled.rows[0]!.photo_path))).toBe(
      true,
    );

    await maybeSaveTrainingSample(
      buffer,
      { ...uncertain, overflow_conf: 0.95 },
      { ...config, retrainingCollection: true },
    );
    expect(
      (await query('SELECT count(*)::int AS count FROM retraining_samples'))
        .rows[0]!.count,
    ).toBe(1);

    const pruned = await createRetentionService({
      config: { ...config, retrainingRetentionDays: 0 },
    }).run(new Date(Date.now() + 1_000));
    expect(pruned.trainingSamples).toBe(1);
    expect(
      existsSync(join(photoDir, 'training', enabled.rows[0]!.photo_path)),
    ).toBe(false);
  });
});

describe('web push subscriptions', () => {
  it('reports configuration state and stores or removes a subscription', async () => {
    const password = 'push-pass-123';
    await seedDriver({
      email: 'push@example.com',
      passwordHash: await hashPassword(password),
    });
    const app = appWith();
    const login = await request(app).post('/api/driver/login').send({
      email: 'push@example.com',
      password,
      deviceId: 'push-test-device',
    });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.token}` };

    const key = await request(app).get('/api/driver/push/key').set(auth);
    expect(key.status).toBe(200);
    expect(key.body).toEqual({ enabled: false, publicKey: null });

    const subscription = {
      endpoint: 'https://push.example.com/subscription/abc',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    };
    const subscribed = await request(app)
      .post('/api/driver/push/subscribe')
      .set(auth)
      .send(subscription);
    expect(subscribed.status).toBe(201);
    expect(subscribed.body).toEqual({ subscribed: true });

    const stored = await query<{ endpoint: string }>(
      'SELECT endpoint FROM push_subscriptions',
    );
    expect(stored.rows).toEqual([{ endpoint: subscription.endpoint }]);

    const removed = await request(app)
      .post('/api/driver/push/unsubscribe')
      .set(auth)
      .send({ endpoint: subscription.endpoint });
    expect(removed.body).toEqual({ subscribed: false });
    const empty = await query('SELECT count(*)::int AS count FROM push_subscriptions');
    expect(empty.rows[0]!.count).toBe(0);
  });
});
