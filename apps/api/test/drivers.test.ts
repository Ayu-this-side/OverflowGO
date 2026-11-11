import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
import {
  closeTestDatabase,
  resetDatabase,
  seedDriver,
  seedLocality,
  seedRouteStop,
  seedTicket,
  setupTestDatabase,
} from './db';

const config = loadConfig();
const PASSWORD = 'driver-pass-123';

const cleanPrediction: AiPrediction = {
  overflow_conf: 0,
  garbage_conf: 0,
  bin_conf: 0.9,
  detections: [],
};

function fakeAi(overrides: Partial<AiPrediction> = {}): AiClient {
  return {
    predict: async () => ({ ...cleanPrediction, ...overrides }),
  };
}

function appWith(ai: AiClient = fakeAi()): Express {
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

async function seedLoginDriver(email = 'driver@example.com'): Promise<string> {
  return seedDriver({
    email,
    passwordHash: await hashPassword(PASSWORD),
    online: false,
  });
}

async function login(
  app: Express,
  email = 'driver@example.com',
): Promise<string> {
  const response = await request(app).post('/api/driver/login').send({
    email,
    password: PASSWORD,
    deviceId: 'driver-device',
  });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

function authed(app: Express, token: string) {
  return {
    get: (url: string) =>
      request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) =>
      request(app).post(url).set('Authorization', `Bearer ${token}`),
  };
}

async function completeTicket(
  app: Express,
  token: string,
  ticketId: string,
  photo: Buffer,
  lat = 18.5204,
  lng = 73.8567,
) {
  return authed(app, token)
    .post(`/api/driver/tickets/${ticketId}/complete`)
    .field('lat', String(lat))
    .field('lng', String(lng))
    .attach('photo', photo, {
      filename: 'after.jpg',
      contentType: 'image/jpeg',
    });
}

let photoDir: string;
const originalPhotoDir = process.env.PHOTO_STORAGE_DIR;

beforeAll(async () => {
  photoDir = mkdtempSync(join(tmpdir(), 'overflowgo-driver-photos-'));
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

describe('driver auth', () => {
  it('logs in, registers the device and returns a session', async () => {
    await seedLoginDriver();
    const app = appWith();

    const response = await request(app).post('/api/driver/login').send({
      email: 'DRIVER@example.com',
      password: PASSWORD,
      deviceId: 'phone-1',
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
    expect(response.body.driver).toMatchObject({
      email: 'driver@example.com',
      isOnline: false,
    });
    expect(response.body.heartbeatSeconds).toBe(config.driverHeartbeatSeconds);

    const devices = await query(
      'SELECT device_id FROM driver_devices WHERE device_id = $1',
      ['phone-1'],
    );
    expect(devices.rows).toHaveLength(1);
  });

  it('rejects a wrong password and missing tokens', async () => {
    await seedLoginDriver();
    const app = appWith();

    const bad = await request(app).post('/api/driver/login').send({
      email: 'driver@example.com',
      password: 'wrong',
      deviceId: 'phone-1',
    });
    expect(bad.status).toBe(401);

    const me = await request(app).get('/api/driver/me');
    expect(me.status).toBe(401);
  });
});

describe('driver duty state', () => {
  it('goes online, records heartbeats and releases assigned tickets offline', async () => {
    const driverId = await seedLoginDriver();
    const localityId = await seedLocality();
    const ticketId = await seedTicket({
      localityId,
      status: 'assigned',
      assignedDriverId: driverId,
    });
    const app = appWith();
    const token = await login(app);

    const online = await authed(app, token).post('/api/driver/online').send({
      online: true,
      lat: 18.52,
      lng: 73.85,
    });
    expect(online.status).toBe(200);
    expect(online.body.driver.isOnline).toBe(true);

    const heartbeat = await authed(app, token)
      .post('/api/driver/location')
      .send({ lat: 18.53, lng: 73.86 });
    expect(heartbeat.status).toBe(200);

    const fresh = await query<{ lat: string; lng: string }>(
      `SELECT ST_Y(last_location::geometry) AS lat,
              ST_X(last_location::geometry) AS lng
         FROM drivers WHERE id = $1`,
      [driverId],
    );
    expect(Number(fresh.rows[0]!.lat)).toBeCloseTo(18.53, 4);
    expect(Number(fresh.rows[0]!.lng)).toBeCloseTo(73.86, 4);

    const offline = await authed(app, token).post('/api/driver/online').send({
      online: false,
    });
    expect(offline.status).toBe(200);
    expect(offline.body.driver.isOnline).toBe(false);

    const released = await query(
      'SELECT status, assigned_driver_id FROM tickets WHERE id = $1',
      [ticketId],
    );
    expect(released.rows[0]).toMatchObject({
      status: 'open',
      assigned_driver_id: null,
    });
  });
});

describe('driver route ordering', () => {
  it('puts stops with tickets first, oldest report first', async () => {
    const driverId = await seedLoginDriver();
    const a = await seedLocality({ name: 'A', lat: 18.5204, lng: 73.8567 });
    const b = await seedLocality({ name: 'B', lat: 18.5214, lng: 73.8577 });
    const c = await seedLocality({ name: 'C', lat: 18.5224, lng: 73.8587 });
    const d = await seedLocality({ name: 'D', lat: 18.5234, lng: 73.8597 });
    await seedRouteStop(driverId, a, 1);
    await seedRouteStop(driverId, b, 2);
    await seedRouteStop(driverId, c, 3);
    await seedRouteStop(driverId, d, 4);

    await seedTicket({
      localityId: c,
      firstReportedAt: new Date('2026-11-10T15:00:00Z'),
    });
    await seedTicket({
      localityId: b,
      firstReportedAt: new Date('2026-11-10T16:00:00Z'),
    });

    const app = appWith();
    const token = await login(app);

    const first = await authed(app, token).get('/api/driver/route');
    expect(first.status).toBe(200);
    expect(first.body.stops.map((stop: { localityName: string }) => stop.localityName)).toEqual([
      'C',
      'B',
      'A',
      'D',
    ]);
    expect(first.body.stops[0]).toMatchObject({
      hasTicket: true,
      reportCount: 1,
      current: false,
    });

    await seedTicket({
      localityId: d,
      firstReportedAt: new Date('2026-11-10T17:00:00Z'),
    });

    const second = await authed(app, token).get('/api/driver/route');
    expect(second.body.stops.map((stop: { localityName: string }) => stop.localityName)).toEqual([
      'C',
      'B',
      'D',
      'A',
    ]);
  });
});

describe('complete job', () => {
  async function setupTicket() {
    const driverId = await seedLoginDriver();
    const localityId = await seedLocality({ name: 'A' });
    await seedRouteStop(driverId, localityId, 1);
    const ticketId = await seedTicket({ localityId });
    const app = appWith();
    const token = await login(app);
    return { driverId, localityId, ticketId, app, token };
  }

  it('verifies a clean after photo and completes the ticket', async () => {
    const { ticketId, app, token } = await setupTicket();

    const response = await completeTicket(
      app,
      token,
      ticketId,
      await makePhoto(20),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ verified: true });

    const ticket = await query(
      'SELECT status, completed_at FROM tickets WHERE id = $1',
      [ticketId],
    );
    expect(ticket.rows[0].status).toBe('completed');
    expect(ticket.rows[0].completed_at).not.toBeNull();

    const completion = await query(
      'SELECT verified, after_photo_path FROM completions WHERE ticket_id = $1',
      [ticketId],
    );
    expect(completion.rows[0].verified).toBe(true);
    expect(completion.rows[0].after_photo_path).toBeTruthy();
    expect(readdirSync(join(photoDir, 'completions'))).toHaveLength(1);
  });

  it('rejects a photo that still shows overflow or garbage', async () => {
    const { ticketId, app, token } = await setupTicket();
    const dirtyApp = appWith(
      fakeAi({ overflow_conf: 0.8, bin_conf: 0.9 }),
    );
    const dirtyToken = token;
    void app;

    const response = await completeTicket(
      dirtyApp,
      dirtyToken,
      ticketId,
      await makePhoto(21),
    );

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(false);
    expect(response.body.reason).toMatch(/still visible/i);

    const ticket = await query(
      'SELECT status FROM tickets WHERE id = $1',
      [ticketId],
    );
    expect(ticket.rows[0].status).toBe('open');
  });

  it('rejects an after photo taken too far from the ticket', async () => {
    const { ticketId, app, token } = await setupTicket();

    const response = await completeTicket(
      app,
      token,
      ticketId,
      await makePhoto(22),
      18.5304,
      73.8567,
    );

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('too_far');
  });

  it('rejects a driver who does not cover the ticket locality', async () => {
    const { ticketId } = await setupTicket();
    await seedLoginDriver('other@example.com');
    const app = appWith();
    const otherToken = await login(app, 'other@example.com');

    const response = await completeTicket(
      app,
      otherToken,
      ticketId,
      await makePhoto(23),
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('not_your_ticket');
  });
});
