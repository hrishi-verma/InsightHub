import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import helpers from './helpers.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';
import { MemoryRateLimitStore } from '../src/services/rateLimitStore.js';

const { buildApp, closePool, testEnv, fakePublisher } = helpers;
const TOKEN = 'x'.repeat(40);

afterAll(closePool);

describe('legacy /api/logs', () => {
  it('is switched off (503) when SERVICE_TOKEN is not set', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/logs').set('Authorization', 'Bearer dev-token-123').send({ service: 's', level: 'INFO', message: 'm' });
    expect(res.status).toBe(503);
  });

  it('rejects the old hardcoded dev token and wrong tokens (401)', async () => {
    const { app } = buildApp({ env: { SERVICE_TOKEN: TOKEN } });
    expect((await request(app).get('/api/logs').set('Authorization', 'Bearer dev-token-123')).status).toBe(401);
    expect((await request(app).get('/api/logs')).status).toBe(401);
  });

  it('still queues logs with the configured token', async () => {
    const { app, legacyPublisher } = buildApp({ env: { SERVICE_TOKEN: TOKEN } });
    const res = await request(app).post('/api/logs').set('Authorization', `Bearer ${TOKEN}`).send({ service: 's', level: 'INFO', message: 'm' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'queued' });
    expect(legacyPublisher.logs).toHaveLength(1);
  });

  it('no longer sends Access-Control-Allow-Origin: *', async () => {
    const { app } = buildApp({ env: { SERVICE_TOKEN: TOKEN } });
    const res = await request(app).get('/api/logs').set('Origin', 'https://evil.example').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('database down', () => {
  it('health returns 503 and API errors carry no internals', async () => {
    const brokenPool = { query: async () => { throw Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' }); } };
    const { app } = createApp({
      config: loadConfig(testEnv()),
      pool: brokenPool,
      eventPublisher: fakePublisher(),
      legacyPublisher: fakePublisher(),
      rateLimitStore: new MemoryRateLimitStore(),
    });
    const health = await request(app).get('/health');
    expect(health.status).toBe(503);
    expect(health.body).toEqual({ status: 'unavailable' });

    const res = await request(app).post('/api/v1/events').set('Authorization', `Bearer ih_sk_${'A'.repeat(43)}`).set('Content-Type', 'application/json').send({ events: [] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Internal error' } });
  });
});
