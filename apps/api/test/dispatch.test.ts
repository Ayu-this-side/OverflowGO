import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../src/services/ai';
import type { AiPrediction, DriverRoute } from '@overflowgo/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { query } from '../src/db/pool';
import { hashPassword } from '../src/services/auth';
import type { DispatchService } from '../src/services/dispatch';
import { dispatchEvents } from '../src/services/dispatch-events';
import {
  closeTestDatabase,
  resetDatabase,
  seedDriver,
  seedLocality,
  seedOffer,
  seedRouteStop,
  seedTicket,
  setupTestDatabase,
} from './db';

const config = loadConfig();
const PASSWORD = 'driver-pass-123';

function fakeAi(overrides: Partial<AiPrediction> = {}): AiClient {
  return {
    predict: async () => ({
      overflow_conf: 0,
      garbage_conf: 0,
      bin_conf: 0.9,
      detections: [],
      ...overrides,
    }),
  };
}

function appWith(ai: AiClient = fakeAi()): Express {
  return createApp({ config, ai });
}

function dispatchOf(app: Express): DispatchService {
  return app.locals.dispatch as DispatchService;
}

function captureEvents<T>(event: string): { events: T[]; stop: () => void } {
  const events: T[] = [];
  const handler = (payload: T) => events.push(payload);
  dispatchEvents.on(event, handler);
  return {
    events,
    stop: () => dispatchEvents.removeListener(event, handler),
  };
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

async function seedLoginDriver(
  email = 'driver@example.com',
  overrides: Parameters<typeof seedDriver>[0] = {},
): Promise<string> {
  return seedDriver({
    email,
    passwordHash: await hashPassword(PASSWORD),
    online: true,
    ...overrides,
  });
}

async function login(app: Express, email = 'driver@example.com'): Promise<string> {
  const response = await request(app).post('/api/driver/login').send({
    email,
    password: PASSWORD,
    deviceId: 'dispatch-test-device',
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

async function complete(
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
  photoDir = mkdtempSync(join(tmpdir(), 'overflowgo-dispatch-photos-'));
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

describe('dispatch offers', () => {
  it('offers only to fresh nearby drivers who do not cover the locality', async () => {
    const localityId = await seedLocality({ name: 'A' });
    const near = await seedLoginDriver('near@example.com', {
      lat: 18.5214,
      lng: 73.8567,
    });
    const routeDriver = await seedLoginDriver('route@example.com', {
      lat: 18.5209,
      lng: 73.8567,
    });
    await seedRouteStop(routeDriver, localityId, 1);
    await seedLoginDriver('full@example.com', {
      lat: 18.5209,
      lng: 73.8567,
      vanFull: true,
    });
    await seedLoginDriver('stale@example.com', {
      lat: 18.5209,
      lng: 73.8567,
      lastPingSecondsAgo: config.driverStaleAfterSeconds + 30,
    });
    await seedLoginDriver('far@example.com', {
      lat: 18.6,
      lng: 73.8567,
    });

    const ticketId = await seedTicket({ localityId });
    const app = appWith();
    const events = captureEvents<{
      driverId: string;
      offer: { reward: number; distanceMeters: number };
    }>('offer:new');

    await dispatchOf(app).dispatchTicket(ticketId);
    events.stop();

    const ticket = await query<{ status: string; offer_round: number }>(
      'SELECT status, offer_round FROM tickets WHERE id = $1',
      [ticketId],
    );
    expect(ticket.rows[0]).toMatchObject({ status: 'offered', offer_round: 1 });

    const offers = await query<{ driver_id: string }>(
      'SELECT driver_id FROM offers WHERE ticket_id = $1',
      [ticketId],
    );
    expect(offers.rows).toEqual([{ driver_id: near }]);
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      driverId: near,
      offer: { reward: config.rewardPerExtraJob },
    });
    expect(events.events[0]!.offer.distanceMeters).toBeGreaterThan(50);

    // A second dispatch never duplicates an outstanding offer.
    await dispatchOf(app).dispatchTicket(ticketId);
    const again = await query('SELECT count(*)::int AS count FROM offers');
    expect(again.rows[0].count).toBe(1);
  });

  it('awards the job to the first accept and closes the others', async () => {
    const localityId = await seedLocality({ name: 'A' });
    const first = await seedLoginDriver('first@example.com', {
      lat: 18.521,
      lng: 73.8567,
    });
    const second = await seedLoginDriver('second@example.com', {
      lat: 18.5211,
      lng: 73.8567,
    });
    const ticketId = await seedTicket({ localityId });
    const app = appWith();
    const dispatch = dispatchOf(app);

    await dispatch.dispatchTicket(ticketId);
    const offers = await query<{ id: string; driver_id: string }>(
      'SELECT id, driver_id FROM offers WHERE ticket_id = $1',
      [ticketId],
    );
    const firstOffer = offers.rows.find((row) => row.driver_id === first)!;
    const secondOffer = offers.rows.find((row) => row.driver_id === second)!;

    const winner = await dispatch.respond(first, firstOffer.id, 'accept');
    const loser = await dispatch.respond(second, secondOffer.id, 'accept');

    expect(winner.assigned).toBe(true);
    expect(winner.slaDeadline).toBeTruthy();
    expect(loser).toMatchObject({ assigned: false, reason: 'taken' });

    const ticket = await query<{
      status: string;
      assigned_driver_id: string;
      sla_deadline: Date;
    }>('SELECT status, assigned_driver_id, sla_deadline FROM tickets WHERE id = $1', [
      ticketId,
    ]);
    expect(ticket.rows[0]).toMatchObject({
      status: 'assigned',
      assigned_driver_id: first,
    });
    const remainingMinutes =
      (ticket.rows[0]!.sla_deadline.getTime() - Date.now()) / 60_000;
    expect(remainingMinutes).toBeGreaterThan(config.taskSlaMinutes - 2);

    const responses = await query<{ response: string }>(
      'SELECT response FROM offers WHERE ticket_id = $1 ORDER BY driver_id',
      [ticketId],
    );
    expect(responses.rows.map((row) => row.response).sort()).toEqual([
      'accepted',
      'taken_by_other',
    ]);

    // The accepted extra job appears on the winner's route.
    const token = await login(app, 'first@example.com');
    const route = await authed(app, token).get('/api/driver/route');
    expect(route.status).toBe(200);
    const stop = (route.body as DriverRoute).stops.find((item) =>
      item.ticketIds.includes(ticketId),
    );
    expect(stop).toMatchObject({ localityName: 'A', hasTicket: true });
  });

  it('expands the geofence once after rejects, then leaves the ticket open', async () => {
    const localityId = await seedLocality({ name: 'A' });
    const near = await seedLoginDriver('near@example.com', {
      lat: 18.521,
      lng: 73.8567,
    });
    const far = await seedLoginDriver('far@example.com', {
      lat: 18.556,
      lng: 73.8567,
    });
    const ticketId = await seedTicket({ localityId });
    const app = appWith();
    const dispatch = dispatchOf(app);

    await dispatch.dispatchTicket(ticketId);
    const initial = await query<{ driver_id: string; id: string }>(
      'SELECT driver_id, id FROM offers WHERE ticket_id = $1',
      [ticketId],
    );
    expect(initial.rows).toEqual([{ driver_id: near, id: initial.rows[0]!.id }]);

    await dispatch.respond(near, initial.rows[0]!.id, 'reject');

    const expanded = await query<{ driver_id: string; id: string }>(
      'SELECT driver_id, id FROM offers WHERE ticket_id = $1 AND response IS NULL',
      [ticketId],
    );
    expect(expanded.rows).toEqual([
      { driver_id: far, id: expanded.rows[0]!.id },
    ]);
    const offered = await query<{ status: string; offer_round: number }>(
      'SELECT status, offer_round FROM tickets WHERE id = $1',
      [ticketId],
    );
    expect(offered.rows[0]).toMatchObject({ status: 'offered', offer_round: 2 });

    await dispatch.respond(far, expanded.rows[0]!.id, 'reject');

    const open = await query<{ status: string }>(
      'SELECT status FROM tickets WHERE id = $1',
      [ticketId],
    );
    expect(open.rows[0]!.status).toBe('open');
  });

  it('releases missed SLAs, penalises the driver and re-offers to others', async () => {
    const localityId = await seedLocality({ name: 'A' });
    const late = await seedLoginDriver('late@example.com', {
      lat: 18.521,
      lng: 73.8567,
    });
    const other = await seedLoginDriver('other@example.com', {
      lat: 18.5211,
      lng: 73.8567,
    });
    const ticketId = await seedTicket({
      localityId,
      status: 'assigned',
      assignedDriverId: late,
      slaDeadline: new Date(Date.now() - 60_000),
    });
    await seedOffer({ ticketId, driverId: late, response: 'accepted' });
    await seedOffer({ ticketId, driverId: other, response: 'taken_by_other' });

    const app = appWith();
    const events = captureEvents<{ driverId: string; ticketId: string }>(
      'ticket:released',
    );
    await dispatchOf(app).tick();
    events.stop();

    expect(events.events).toEqual([{ driverId: late, ticketId }]);

    const released = await query<{
      status: string;
      assigned_driver_id: string | null;
    }>('SELECT status, assigned_driver_id FROM tickets WHERE id = $1', [ticketId]);
    expect(released.rows[0]).toEqual({
      status: 'offered',
      assigned_driver_id: null,
    });

    const scored = await query<{ acceptance_score: string }>(
      'SELECT acceptance_score FROM drivers WHERE id = $1',
      [late],
    );
    expect(Number(scored.rows[0]!.acceptance_score)).toBeCloseTo(
      1 - config.acceptanceScorePenalty,
      2,
    );

    const offers = await query<{ driver_id: string; response: string | null }>(
      'SELECT driver_id, response FROM offers WHERE ticket_id = $1',
      [ticketId],
    );
    expect(offers.rows).toEqual([{ driver_id: other, response: null }]);
  });

  it('expires offer timeouts and starts the expanded round', async () => {
    const localityId = await seedLocality({ name: 'A' });
    const near = await seedLoginDriver('near@example.com', {
      lat: 18.521,
      lng: 73.8567,
    });
    const far = await seedLoginDriver('far@example.com', {
      lat: 18.556,
      lng: 73.8567,
    });
    const ticketId = await seedTicket({ localityId, status: 'offered' });
    await seedOffer({
      ticketId,
      driverId: near,
      expiresAt: new Date(Date.now() - 1_000),
    });

    const app = appWith();
    await dispatchOf(app).tick();

    const offers = await query<{
      driver_id: string;
      response: string | null;
    }>(
      `SELECT o.driver_id, o.response
         FROM offers o
         JOIN drivers d ON d.id = o.driver_id
        WHERE o.ticket_id = $1
        ORDER BY d.email`,
      [ticketId],
    );
    expect(offers.rows).toEqual([
      { driver_id: far, response: null },
      { driver_id: near, response: 'expired' },
    ]);
    const ticket = await query<{ offer_round: number }>(
      'SELECT offer_round FROM tickets WHERE id = $1',
      [ticketId],
    );
    expect(ticket.rows[0]!.offer_round).toBe(2);
  });
});

describe('rewards and wallet', () => {
  async function setupAcceptedJob() {
    const localityId = await seedLocality({ name: 'A' });
    const driverId = await seedLoginDriver();
    const ticketId = await seedTicket({
      localityId,
      status: 'assigned',
      assignedDriverId: driverId,
    });
    await seedOffer({ ticketId, driverId, response: 'accepted' });
    const app = appWith();
    const token = await login(app);
    return { localityId, driverId, ticketId, app, token };
  }

  it('credits the reward for a verified extra job and reports the wallet', async () => {
    const { ticketId, app, token } = await setupAcceptedJob();

    const response = await complete(app, token, ticketId, await makePhoto(31));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verified: true,
      reward: config.rewardPerExtraJob,
    });

    const wallet = await authed(app, token).get('/api/driver/wallet');
    expect(wallet.status).toBe(200);
    expect(wallet.body).toMatchObject({
      balance: config.rewardPerExtraJob,
      todayEarned: config.rewardPerExtraJob,
      todayCompletedJobs: 1,
    });
    expect(wallet.body.items).toHaveLength(1);
    expect(wallet.body.items[0]).toMatchObject({
      ticketId,
      amount: config.rewardPerExtraJob,
    });
  });

  it('pays nothing for a route stop cleared without an accepted offer', async () => {
    const localityId = await seedLocality({ name: 'A' });
    const driverId = await seedLoginDriver();
    await seedRouteStop(driverId, localityId, 1);
    const ticketId = await seedTicket({ localityId });
    const app = appWith();
    const token = await login(app);

    const response = await complete(app, token, ticketId, await makePhoto(32));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verified: true,
      reward: 0,
      rewardSkippedReason: 'route_stop',
    });

    const ledger = await query('SELECT count(*)::int AS count FROM reward_ledger');
    expect(ledger.rows[0].count).toBe(0);
  });

  it('stops paying after the daily cap', async () => {
    const { localityId, driverId, ticketId, app, token } =
      await setupAcceptedJob();
    const priorTicket = await seedTicket({
      localityId,
      status: 'completed',
    });
    await query(
      'INSERT INTO reward_ledger (driver_id, ticket_id, amount) VALUES ($1, $2, $3)',
      [driverId, priorTicket, config.rewardDailyCapPerDriver - 5],
    );

    const response = await complete(app, token, ticketId, await makePhoto(33));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verified: true,
      reward: 0,
      rewardSkippedReason: 'daily_cap',
    });
  });

  it('pays nothing when the driver is excluded by the proximity rule', async () => {
    const { driverId, ticketId, app, token } = await setupAcceptedJob();
    await query(
      `INSERT INTO ticket_reward_exclusions (ticket_id, driver_id, reason)
       VALUES ($1, $2, 'driver_nearby')`,
      [ticketId, driverId],
    );

    const response = await complete(app, token, ticketId, await makePhoto(34));
    expect(response.body).toMatchObject({
      verified: true,
      reward: 0,
      rewardSkippedReason: 'not_reward_eligible',
    });
  });
});

describe('van full', () => {
  it('adds the dump-yard stop and removes it once emptied', async () => {
    await seedLocality({ name: 'A' });
    await seedLoginDriver();
    const app = createApp({ config });
    const token = await login(app);

    const full = await authed(app, token).post('/api/driver/van-full');
    expect(full.status).toBe(200);
    expect(full.body.driver.vanFull).toBe(true);

    const fullRoute = await authed(app, token).get('/api/driver/route');
    expect(fullRoute.body.stops[0]).toMatchObject({
      localityName: config.dumpYard.name,
      isDumpYard: true,
    });

    const emptied = await authed(app, token).post('/api/driver/van-emptied');
    expect(emptied.body.driver.vanFull).toBe(false);

    const emptyRoute = await authed(app, token).get('/api/driver/route');
    expect(
      (emptyRoute.body as DriverRoute).stops.some((stop) => stop.isDumpYard),
    ).toBe(false);
  });
});
