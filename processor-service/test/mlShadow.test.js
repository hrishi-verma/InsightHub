import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createMlShadow } = require('../src/mlShadow');
const { makeEvent } = require('./helpers');

const NULLS = { ml_score: null, ml_model_version: null };
const cfg = (url) => ({ enabled: true, url, timeoutMs: 500, modelVersion: 'synthetic-v0' });

let server;
function startServer(handler) {
  return new Promise((resolve) => {
    server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}
afterAll(() => server && server.close());

describe('ML shadow', () => {
  it('is a no-op when off', async () => {
    const score = createMlShadow({ enabled: false });
    expect(await score(1, makeEvent())).toEqual(NULLS);
  });

  it('stores the score and model version on success', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ anomaly_score: 0.42 }), { status: 200 });
    const score = createMlShadow(cfg('http://ml.test'), { fetchImpl });
    expect(await score(1, makeEvent())).toEqual({ ml_score: 0.42, ml_model_version: 'synthetic-v0' });
  });

  it('gives up after 500 ms on a slow server', async () => {
    const url = await startServer((req, res) => setTimeout(() => res.end('{"anomaly_score":1}'), 3000));
    const score = createMlShadow(cfg(url));
    const start = Date.now();
    expect(await score(1, makeEvent())).toEqual(NULLS);
    expect(Date.now() - start).toBeLessThan(1500);
  });

  it('returns nulls on errors and bad responses', async () => {
    const cases = [
      async () => { throw new TypeError('fetch failed'); },
      async () => new Response('oops', { status: 500 }),
      async () => new Response('not json', { status: 200 }),
      async () => new Response(JSON.stringify({ anomaly_score: 'high' }), { status: 200 }),
      async () => new Response(JSON.stringify({ anomaly_score: 1e300 }), { status: 200 }),
    ];
    for (const fetchImpl of cases) {
      const score = createMlShadow(cfg('http://ml.test'), { fetchImpl });
      expect(await score(1, makeEvent())).toEqual(NULLS);
    }
    // Nothing listening on this port.
    expect(await createMlShadow(cfg('http://127.0.0.1:1'))(1, makeEvent())).toEqual(NULLS);
  });
});
