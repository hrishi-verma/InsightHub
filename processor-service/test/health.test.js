import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createHealthServer, createMetrics } = require('../src/health');
const { loadConfig } = require('../src/config');

const servers = [];
async function start(overrides = {}) {
  const h = createHealthServer({
    host: '127.0.0.1', port: 0, log: () => {},
    checkDb: async () => {}, checkKafka: async () => {}, metrics: createMetrics(),
    ...overrides,
  });
  await h.listen();
  servers.push(h);
  const base = `http://127.0.0.1:${h.server.address().port}`;
  return { h, get: (p, init) => fetch(base + p, init) };
}
afterEach(async () => { await Promise.all(servers.splice(0).map((h) => h.close())); });

describe('GET /health', () => {
  it('200 when both are up, with hardening headers', async () => {
    const { get } = await start();
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'up', kafka: 'up' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('503 and names the failing part, without leaking the error', async () => {
    const secret = 'ECONNREFUSED db.internal.example:5432 password=hunter2';
    const { get } = await start({ checkDb: async () => { throw new Error(secret); } });
    const res = await get('/health');
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: 'degraded', db: 'down', kafka: 'up' });
    expect(text).not.toContain('internal');
    expect(text).not.toContain('hunter2');

    const k = await start({ checkKafka: async () => { throw new Error(secret); } });
    expect(await (await k.get('/health')).json()).toEqual({ status: 'degraded', db: 'up', kafka: 'down' });
  });

  it('cuts off a check that hangs', async () => {
    const { get } = await start({ checkDb: () => new Promise(() => {}), timeoutMs: 100 });
    const t = Date.now();
    const res = await get('/health');
    expect(Date.now() - t).toBeLessThan(1500);
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe('down');
  });

  it('caches results across requests', async () => {
    const checkDb = vi.fn(async () => {});
    const checkKafka = vi.fn(async () => {});
    const { get } = await start({ checkDb, checkKafka });
    await Promise.all([get('/health'), get('/health'), get('/health')]);
    await get('/health');
    expect(checkDb).toHaveBeenCalledTimes(1);
    expect(checkKafka).toHaveBeenCalledTimes(1);
  });
});

describe('GET /metrics', () => {
  it('counts wrapped results and never leaks content', async () => {
    const metrics = createMetrics();
    for (const r of [
      { status: 'stored', alerts: [{ kind: 'new_issue' }, { kind: 'spike' }] },
      { status: 'stored' }, { status: 'duplicate' }, { status: 'invalid' }, { status: 'failed' },
    ]) metrics.record(r);
    metrics.retry();
    const { get } = await start({ metrics });
    const res = await get('/metrics');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ stored: 2, duplicate: 1, invalid: 1, failed: 1, retries: 1, alerts_raised: 2 });
    expect(typeof body.started_at).toBe('string');
    expect(typeof body.last_event_at).toBe('string');
    expect(body.uptime_s).toBeGreaterThanOrEqual(0);
    expect(Object.keys(body).sort()).toEqual([
      'alerts_raised', 'duplicate', 'failed', 'invalid', 'last_event_at', 'retries', 'started_at', 'stored', 'uptime_s',
    ]);
  });

  it('last_event_at is null before any event', async () => {
    const { get } = await start();
    expect((await (await get('/metrics')).json()).last_event_at).toBeNull();
  });
});

describe('routing', () => {
  it('404 for unknown paths, 405 for non-GET', async () => {
    const { get } = await start();
    expect((await get('/nope')).status).toBe(404);
    expect((await get('/')).status).toBe(404);
    const post = await get('/health', { method: 'POST', body: 'x'.repeat(1000) });
    expect(post.status).toBe(405);
    expect(await post.json()).toEqual({ error: 'method_not_allowed' });
    expect((await get('/metrics', { method: 'DELETE' })).status).toBe(405);
  });

  it('has short request timeouts', async () => {
    const { h } = await start();
    expect(h.server.requestTimeout).toBe(5000);
    expect(h.server.headersTimeout).toBe(5000);
  });
});

describe('health config', () => {
  const base = { KAFKA_BROKER: 'localhost:9093', DB_HOST: 'localhost', DB_PASSWORD: 'not-a-real-password' };
  it('defaults to loopback:9100', () => {
    expect(loadConfig(base).health).toEqual({ host: '127.0.0.1', port: 9100 });
  });
  it('rejects a bad HEALTH_PORT', () => {
    for (const v of ['0', '65536', 'abc', '1.5']) {
      expect(() => loadConfig({ ...base, HEALTH_PORT: v })).toThrow('HEALTH_PORT');
    }
    expect(loadConfig({ ...base, HEALTH_PORT: '9200', HEALTH_HOST: '0.0.0.0' }).health).toEqual({ host: '0.0.0.0', port: 9200 });
  });
});
