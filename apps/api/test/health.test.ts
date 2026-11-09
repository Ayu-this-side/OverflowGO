import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';

describe('GET /api/health', () => {
  it('returns service metadata', async () => {
    const app = createApp({ config: loadConfig() });
    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      service: 'overflowgo-api',
      version: '0.1.0',
    });
    expect(typeof response.body.time).toBe('string');
  });
});

describe('unknown route', () => {
  it('returns a JSON 404', async () => {
    const app = createApp({ config: loadConfig() });
    const response = await request(app).get('/api/does-not-exist').expect(404);

    expect(response.body).toEqual({
      error: 'not_found',
      path: '/api/does-not-exist',
    });
  });
});
