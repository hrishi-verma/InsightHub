import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, buildQuery, createEndpoints, createHttp, errorMessage, seg } from '../lib/http.js';

function fakeFetch(status, body, { contentType = 'application/json' } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(contentType ? { 'content-type': contentType } : {}),
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    };
  };
  return { impl, calls };
}

test('every request sends credentials: include and no Authorization header', async () => {
  const { impl, calls } = fakeFetch(200, { user: { id: 1 } });
  const api = createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: impl }));
  await api.me();
  await api.setIssueStatus(5, 'resolved');
  for (const { init } of calls) {
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal, 'has a timeout signal');
    assert.equal(init.headers.Authorization, undefined);
  }
  assert.equal(calls[0].url, 'https://api.test/api/v1/auth/me');
});

test('state-changing requests are JSON (CSRF rule in contract §4)', async () => {
  const { impl, calls } = fakeFetch(200, { alert: {} });
  const api = createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: impl }));
  await api.ackAlert(3);
  await api.setIssueStatus(3, 'ignored');
  const { impl: impl204, calls: calls204 } = fakeFetch(204, null);
  await createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: impl204 })).logout();
  for (const { init } of [...calls, ...calls204]) {
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.doesNotThrow(() => JSON.parse(init.body));
  }
  assert.equal(calls[1].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].init.body), { status: 'ignored' });
});

test('ids are encoded as a single path segment', async () => {
  const { impl, calls } = fakeFetch(200, { issue: {} });
  const api = createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: impl }));
  await api.issue('../../auth/logout?x=1#y');
  assert.equal(calls[0].url, 'https://api.test/api/v1/issues/..%2F..%2Fauth%2Flogout%3Fx%3D1%23y');
  assert.equal(seg('a/b'), 'a%2Fb');
});

test('query building drops empty values and encodes the rest', () => {
  assert.equal(buildQuery({ project: 'education-enlightened', q: 'a&b=c', status: '', cursor: undefined }),
    '?project=education-enlightened&q=a%26b%3Dc');
  assert.equal(buildQuery({}), '');
});

test('401 triggers the unauthorized handler, except for login/me/logout', async () => {
  let fired = 0;
  const { impl } = fakeFetch(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
  const api = createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: impl, onUnauthorized: () => fired++ }));
  await assert.rejects(api.projects(), (e) => e instanceof ApiError && e.status === 401);
  assert.equal(fired, 1);
  await assert.rejects(api.me());
  await assert.rejects(api.login('a@b.c', 'x'));
  await assert.rejects(api.logout());
  assert.equal(fired, 1);
});

test('error codes come from the contract list only; messages never from the body', async () => {
  const { impl } = fakeFetch(403, { error: { code: '<script>', message: '<img src=x onerror=alert(1)>' } });
  const api = createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: impl }));
  const err = await api.projects().catch((e) => e);
  assert.equal(err.code, 'FORBIDDEN');
  assert.ok(!errorMessage(err).includes('<'));
  assert.ok(!err.message.includes('img'));
});

test('non-JSON or empty success bodies are rejected', async () => {
  const { impl } = fakeFetch(200, '<html>', { contentType: 'text/html' });
  const api = createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: impl }));
  await assert.rejects(api.projects(), (e) => e.code === 'INTERNAL');
});

test('network failures and timeouts become ApiErrors', async () => {
  const api = createEndpoints(createHttp({ baseUrl: 'https://api.test', fetchImpl: async () => { throw new TypeError('fail'); } }));
  await assert.rejects(api.projects(), (e) => e.code === 'NETWORK');
  const slow = createEndpoints(createHttp({
    baseUrl: 'https://api.test',
    timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
  }));
  await assert.rejects(slow.projects(), (e) => e.code === 'TIMEOUT');
});
