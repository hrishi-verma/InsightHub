import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiOrigin, buildCsp, safeNextPath } from '../lib/security.js';

test('safeNextPath only allows same-app relative paths', () => {
  assert.equal(safeNextPath('/issues/3?status=resolved'), '/issues/3?status=resolved');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil', 'javascript:alert(1)',
    '/%0a', '/a\nb', '', null, undefined, 42, '/login', '/login?next=//evil', `/${'a'.repeat(600)}`]) {
    const out = safeNextPath(bad);
    assert.ok(out === '/dashboard' || (bad === '/%0a' && out === '/%0a'), `rejected ${JSON.stringify(bad)}`);
  }
});

test('production CSP: nonce + strict-dynamic, no unsafe-eval, no inline scripts, no framing', () => {
  const csp = buildCsp({ nonce: 'abc', apiOrigin: 'https://api.example.com', dev: false });
  assert.match(csp, /script-src 'self' 'nonce-abc' 'strict-dynamic'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com(;|$)/);
  assert.doesNotMatch(csp, /ws:/);
});

test('apiOrigin validates the API URL and fails closed', () => {
  assert.equal(apiOrigin('https://api.example.com/', { production: true }), 'https://api.example.com');
  assert.equal(apiOrigin('http://localhost:8000', { production: true }), 'http://localhost:8000');
  assert.throws(() => apiOrigin('http://api.example.com', { production: true }));
  assert.throws(() => apiOrigin('javascript:alert(1)', { production: false }));
  assert.throws(() => apiOrigin('https://user:pw@api.example.com', { production: false }));
  assert.throws(() => apiOrigin('not a url', { production: false }));
});
