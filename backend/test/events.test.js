import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import helpers from './helpers.js';
import { createRequire } from 'node:module';
import { createKafka, createEventPublisher } from '../src/services/kafka.js';

const { buildApp, resetDb, createKey, makeEvent, fakePublisher, getPool, closePool, SITE } = helpers;

let projects;
let secret;
let pub;

beforeEach(async () => {
  projects = await resetDb();
  secret = await createKey({ projectId: projects['education-enlightened'], kind: 'secret' });
  pub = await createKey({ projectId: projects['education-enlightened'], kind: 'public', origins: [SITE] });
});
afterAll(closePool);

const sendSecret = (app, body, key = secret.key) =>
  request(app).post('/api/v1/events').set('Authorization', `Bearer ${key}`).set('Content-Type', 'application/json').send(body);

const sendPublic = (app, body, origin = SITE, key = pub.key) => {
  const req = request(app).post('/api/v1/events').set('X-InsightHub-Key', key).set('Content-Type', 'application/json');
  if (origin) req.set('Origin', origin);
  return req.send(body);
};

function hasKafkaBinding() {
  try {
    createRequire(import.meta.url)('@confluentinc/kafka-javascript');
    return true;
  } catch {
    return false;
  }
}

describe('POST /api/v1/events: happy paths', () => {
  it('accepts a valid server batch and publishes the contract Kafka message', async () => {
    const { app, eventPublisher } = buildApp();
    const event = makeEvent({
      http: { method: 'POST', status: 500, route: '/api/auth/register' },
      url_path: '/api/auth/register',
      release: '07b4c36',
      runtime: 'node 24.1',
      tags: { region: 'eu' },
      stack: 'Error: x\n    at f (/app/a.js:1:2)',
    });
    const res = await sendSecret(app, { events: [event, makeEvent()] });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2 });
    expect(res.headers['cache-control']).toBe('no-store');

    expect(eventPublisher.calls).toHaveLength(1);
    const call = eventPublisher.calls[0];
    expect(call.projectId).toBe(projects['education-enlightened']);
    expect(new Date(call.receivedAt).toISOString()).toBe(call.receivedAt);
    expect(call.events[0]).toEqual(event);
  });

  it('builds messages as { schema, project_id, received_at, event } keyed by project id', async () => {
    const sent = [];
    const fakeKafka = { producer: () => ({ connect: async () => {}, send: async (r) => sent.push(r), disconnect: async () => {} }) };
    const publisher = createEventPublisher(fakeKafka, 'error-events');
    const event = makeEvent();
    await publisher.publish(7, [event], '2026-10-11T09:30:01.120Z');
    expect(sent[0].topic).toBe('error-events');
    expect(sent[0]).not.toHaveProperty('acks'); // acks=-1 is set on the producer config instead
    expect(sent[0].messages[0].key).toBe('7');
    expect(JSON.parse(sent[0].messages[0].value)).toEqual({ schema: 1, project_id: 7, received_at: '2026-10-11T09:30:01.120Z', event });
  });

  it('accepts a public key from an allowed origin and returns CORS headers', async () => {
    const { app } = buildApp();
    const res = await sendPublic(app, { events: [makeEvent({ source: 'browser' })] });
    expect(res.status).toBe(202);
    expect(res.headers['access-control-allow-origin']).toBe(SITE);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('updates last_used_at', async () => {
    const { app } = buildApp();
    await sendSecret(app, { events: [makeEvent()] });
    await new Promise((r) => setTimeout(r, 100));
    const { rows } = await getPool().query('SELECT last_used_at FROM api_keys WHERE id = $1', [secret.id]);
    expect(rows[0].last_used_at).not.toBeNull();
  });
});

describe('POST /api/v1/events: rejections', () => {
  it('rejects unknown fields (400)', async () => {
    const { app, eventPublisher } = buildApp();
    const res = await sendSecret(app, { events: [{ ...makeEvent(), user_email: 'a@b.com' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(eventPublisher.calls).toHaveLength(0);
  });

  it('rejects unknown top-level fields (400)', async () => {
    const { app } = buildApp();
    expect((await sendSecret(app, { events: [makeEvent()], extra: 1 })).status).toBe(400);
  });

  it.each([
    ['21 events', () => ({ events: Array.from({ length: 21 }, () => makeEvent()) })],
    ['0 events', () => ({ events: [] })],
    ['bad uuid', () => ({ events: [makeEvent({ event_id: 'not-a-uuid' })] })],
    ['uuid v1', () => ({ events: [makeEvent({ event_id: '9b2f7c1e-3a4d-1e8f-9c1a-2b3c4d5e6f70' })] })],
    ['no timezone', () => ({ events: [makeEvent({ occurred_at: '2026-10-11T09:30:00' })] })],
    ['too far in the future', () => ({ events: [makeEvent({ occurred_at: new Date(Date.now() + 10 * 60_000).toISOString() })] })],
    ['older than 7 days', () => ({ events: [makeEvent({ occurred_at: new Date(Date.now() - 8 * 86_400_000).toISOString() })] })],
    ['url_path with query', () => ({ events: [makeEvent({ url_path: '/x?token=1' })] })],
    ['message over 1000 chars', () => ({ events: [makeEvent({ message: 'a'.repeat(1001) })] })],
    ['11 tags', () => ({ events: [makeEvent({ tags: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`t${i}`, 'v'])) })] })],
    ['bad tag key', () => ({ events: [makeEvent({ tags: { 'Bad Key': 'v' } })] })],
    ['bad release', () => ({ events: [makeEvent({ release: 'v1 beta' })] })],
    ['NUL byte', () => ({ events: [makeEvent({ message: 'a\u0000b' })] })],
    ['unknown http field', () => ({ events: [makeEvent({ http: { method: 'GET', headers: {} } })] })],
    ['events not an array', () => ({ events: 'x' })],
  ])('rejects %s (400)', async (_name, body) => {
    const { app } = buildApp();
    const res = await sendSecret(app, body());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON without leaking parser details (400)', async () => {
    const { app } = buildApp();
    const res = await sendSecret(app, '{"events": [');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Body is not valid JSON' } });
  });

  it('rejects bodies over 64 KB (413)', async () => {
    const { app } = buildApp();
    const res = await sendSecret(app, JSON.stringify({ events: [makeEvent({ stack: 'x'.repeat(70_000) })] }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects non-JSON content types (415)', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/v1/events').set('Authorization', `Bearer ${secret.key}`).set('Content-Type', 'text/plain').send('{}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a missing key (401)', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/v1/events').set('Content-Type', 'application/json').send({ events: [makeEvent()] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unknown key (401)', async () => {
    const { app } = buildApp();
    const res = await sendSecret(app, { events: [makeEvent()] }, `ih_sk_${'A'.repeat(43)}`);
    expect(res.status).toBe(401);
  });

  it('rejects a revoked key (401)', async () => {
    const { app } = buildApp();
    await getPool().query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [secret.id]);
    expect((await sendSecret(app, { events: [makeEvent()] })).status).toBe(401);
  });

  it('rejects a public key sent as a Bearer token and a secret key in the public header (401)', async () => {
    const { app } = buildApp();
    expect((await sendSecret(app, { events: [makeEvent()] }, pub.key)).status).toBe(401);
    expect((await sendPublic(app, { events: [makeEvent({ source: 'browser' })] }, SITE, secret.key)).status).toBe(401);
  });

  it('rejects a secret key sent with any Origin header (401), without echoing key or origin', async () => {
    const { app, eventPublisher } = buildApp();
    for (const origin of [SITE, 'null', 'https://evil.example']) {
      const res = await sendSecret(app, { events: [makeEvent()] }).set('Origin', origin);
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toContain(secret.key);
      expect(JSON.stringify(res.body)).not.toContain(origin);
    }
    expect(eventPublisher.calls).toHaveLength(0);
  });

  it('rejects a public key from a disallowed origin (403)', async () => {
    const { app } = buildApp();
    const res = await sendPublic(app, { events: [makeEvent({ source: 'browser' })] }, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a public key without an Origin (403)', async () => {
    const { app } = buildApp();
    expect((await sendPublic(app, { events: [makeEvent({ source: 'browser' })] }, null)).status).toBe(403);
  });

  it('rejects source/key mismatch (403)', async () => {
    const { app, eventPublisher } = buildApp();
    expect((await sendSecret(app, { events: [makeEvent({ source: 'browser' })] })).status).toBe(403);
    expect((await sendPublic(app, { events: [makeEvent({ source: 'server' })] })).status).toBe(403);
    expect(eventPublisher.calls).toHaveLength(0);
  });

  it('rejects http on browser events (400)', async () => {
    const { app } = buildApp();
    expect((await sendPublic(app, { events: [makeEvent({ source: 'browser', http: { status: 500 } })] })).status).toBe(400);
  });

  it('returns 503 when Kafka is down, without details', async () => {
    const { app } = buildApp({ publisher: fakePublisher({ fail: true }) });
    const res = await sendSecret(app, { events: [makeEvent()] });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: 'UNAVAILABLE', message: 'Event queue unavailable, retry later' } });
  });

  // Needs the native librdkafka binding, which has no prebuilt build for every host Node version
  // (it is always present in the Docker image, where this test runs).
  it.runIf(hasKafkaBinding())('gives up quickly when the broker is unreachable (does not hang)', async () => {
    const publisher = createEventPublisher(createKafka(['127.0.0.1:1']), 'error-events');
    const started = Date.now();
    await expect(publisher.publish(1, [makeEvent()], new Date().toISOString())).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(12_000);
    await publisher.disconnect();
  });
});

describe('POST /api/v1/events: rate limits', () => {
  it('limits a secret key to 600 events per minute (429 + Retry-After)', async () => {
    const { app } = buildApp();
    const batch = () => ({ events: Array.from({ length: 20 }, () => makeEvent()) });
    for (let i = 0; i < 30; i++) expect((await sendSecret(app, batch())).status).toBe(202);
    const res = await sendSecret(app, { events: [makeEvent()] });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits a public key to 60 events per minute per client IP', async () => {
    const { app } = buildApp();
    const batch = () => ({ events: Array.from({ length: 20 }, () => makeEvent({ source: 'browser' })) });
    for (let i = 0; i < 3; i++) expect((await sendPublic(app, batch())).status).toBe(202);
    const res = await sendPublic(app, { events: [makeEvent({ source: 'browser' })] });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/v1/events: scrubbing', () => {
  it('scrubs message, stack, tags and url_path before Kafka', async () => {
    const { app, eventPublisher } = buildApp();
    const event = makeEvent({
      message: 'login failed for jane@example.com from 192.168.0.7 with Bearer abc.def at https://x.io/cb?code=123',
      stack: 'Error\n    at fetch (https://cdn.example/app.js?v=9#L1)\n    token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl ff 2001:db8::1',
      tags: { session: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4', user: 'bob@example.org' },
      url_path: '/reset/9f86d081884c7d659a2feaa0c55ad015',
    });
    expect((await sendSecret(app, { events: [event] })).status).toBe(202);
    const sent = eventPublisher.calls[0].events[0];
    expect(sent.message).toBe('login failed for [email] from [ip] with [credential] at https://x.io/cb');
    expect(sent.stack).toBe('Error\n    at fetch (https://cdn.example/app.js\n    token [jwt] ff [ip]');
    expect(sent.tags).toEqual({ session: '[token]', user: '[email]' });
    expect(sent.url_path).toBe('/reset/[token]');
  });

  it('keeps /home/... site routes in url_path but scrubs home directories in stacks', async () => {
    const { app, eventPublisher } = buildApp();
    const event = makeEvent({ url_path: '/home/courses/intro', stack: 'Error\n    at f (/home/deploy/app/x.js:1:2)' });
    expect((await sendSecret(app, { events: [event] })).status).toBe(202);
    const sent = eventPublisher.calls[0].events[0];
    expect(sent.url_path).toBe('/home/courses/intro');
    expect(sent.stack).toBe('Error\n    at f (~/app/x.js:1:2)');
  });
});

describe('OPTIONS /api/v1/events (CORS preflight)', () => {
  it('answers for origins of active public keys', async () => {
    const { app } = buildApp();
    const res = await request(app).options('/api/v1/events').set('Origin', SITE).set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(SITE);
    expect(res.headers['access-control-allow-methods']).toBe('POST');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type, X-InsightHub-Key');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('refuses other origins', async () => {
    const { app } = buildApp();
    const res = await request(app).options('/api/v1/events').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
