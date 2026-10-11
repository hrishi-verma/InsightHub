import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { describe: describeEvent, normalizeMessage, normalizeFile, topFrames } = require('../src/fingerprint');
const { makeEvent } = require('./helpers');

const fp = (overrides, projectId = 1) => describeEvent(projectId, makeEvent(overrides)).fingerprint;

describe('normalizeMessage', () => {
  it('replaces UUIDs, numbers, hex runs and quoted text, collapses whitespace and lower-cases', () => {
    expect(normalizeMessage('User 9b2f7c1e-3a4d-4e8f-9c1a-2b3c4d5e6f70 not found')).toBe('user <uuid> not found');
    expect(normalizeMessage('Timeout after 3000ms on   shard 12')).toBe('timeout after <n>ms on shard <n>');
    expect(normalizeMessage('Object 5f3a9c2b1d7e not found')).toBe('object <hex> not found');
    expect(normalizeMessage(`Unknown key "abc" and 'def' and \`x\``)).toBe('unknown key <str> and <str> and <str>');
  });
});

describe('normalizeFile', () => {
  it('removes line/column numbers and query strings', () => {
    expect(normalizeFile('/app/src/users.js:42:11')).toBe('/app/src/users.js');
    expect(normalizeFile('https://site.test/assets/app.js?v=3#x:10:2')).toBe('https://site.test/assets/app.js');
  });
  it('removes build hashes from file names', () => {
    expect(normalizeFile('https://site.test/assets/index-a1b2c3d4.js:1:200')).toBe('https://site.test/assets/index.js');
    expect(normalizeFile('/assets/index-BXk3a_9Z.js')).toBe('/assets/index.js');
    expect(normalizeFile('/assets/vendor-B-k3a_9Z.js')).toBe('/assets/vendor.js');
    expect(normalizeFile('/static/js/main.3f2a1b9c.chunk.js')).toBe('/static/js/main.chunk.js');
    expect(normalizeFile('/_next/static/chunks/page-3f2a1b9c4d5e6f70.js')).toBe('/_next/static/chunks/page.js');
  });
  it('leaves ordinary dotted names alone', () => {
    expect(normalizeFile('/app/src/user.controller.js')).toBe('/app/src/user.controller.js');
    expect(normalizeFile('/app/src/auth.service.js')).toBe('/app/src/auth.service.js');
  });
});

describe('topFrames', () => {
  it('parses V8 and Firefox/Safari frames', () => {
    const v8 = 'Error: x\n    at foo (/a.js:1:2)\n    at /b.js:3:4\n    at async bar (/c.js:5:6)\n    at baz (/d.js:7:8)';
    expect(topFrames(v8)).toEqual([
      { fn: 'foo', file: '/a.js' }, { fn: '', file: '/b.js' }, { fn: 'bar', file: '/c.js' },
    ]);
    const gecko = 'foo@https://s.test/assets/index-a1b2c3d4.js:1:2\n@https://s.test/x.js:3:4';
    expect(topFrames(gecko)).toEqual([
      { fn: 'foo', file: 'https://s.test/assets/index.js' }, { fn: '', file: 'https://s.test/x.js' },
    ]);
  });
  it('stays fast on hostile input', () => {
    const start = Date.now();
    topFrames(`    at ${' '.repeat(15000)}x`);
    topFrames(`@${'a '.repeat(8000)}`);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('library frames', () => {
  const prismaStack = (caller) =>
    [
      'PrismaClientKnownRequestError: Invalid `prisma.session.findUnique()` invocation in',
      '    at vn.handleRequestError (/var/task/node_modules/@prisma/client/runtime/library.js:121:7)',
      '    at vn.request (/var/task/node_modules/@prisma/client/runtime/library.js:121:6)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
      `    at ${caller} (/var/task/backend/services/${caller}.js:42:11)`,
    ].join('\n');
  const prismaEvent = (caller) => ({
    error_type: 'PrismaClientKnownRequestError',
    message: 'Invalid `prisma.session.findUnique()` invocation in',
    stack: prismaStack(caller),
  });

  it('skips node_modules and runtime frames', () => {
    expect(topFrames(prismaStack('getSession')).map((f) => f.fn)).toEqual(['getSession']);
  });

  it('keeps library frames when there are no in-app frames', () => {
    const stack = 'Error: x\n    at a (/app/node_modules/lib/a.js:1:1)\n    at node:internal/x:2:2';
    expect(topFrames(stack)).toHaveLength(2);
  });

  it('separates the same library error raised from different places in our code', () => {
    expect(fp(prismaEvent('getSession'))).not.toBe(fp(prismaEvent('register')));
  });

  it('names our code as the culprit', () => {
    const { culprit } = describeEvent(1, makeEvent(prismaEvent('getSession')));
    expect(culprit).toBe('getSession (/var/task/backend/services/getSession.js)');
  });
});

describe('fingerprint', () => {
  it('groups the same error with different numbers, IDs and line numbers', () => {
    const a = fp({
      message: 'Order 1234 for user 9b2f7c1e-3a4d-4e8f-9c1a-2b3c4d5e6f70 failed',
      stack: 'Error\n    at pay (/app/pay.js:10:5)\n    at run (/app/run.js:20:1)',
    });
    const b = fp({
      message: 'Order 98 for user 0e1d2c3b-4a59-4687-a6b5-c4d3e2f10a9b failed',
      stack: 'Error\n    at pay (/app/pay.js:77:9)\n    at run (/app/run.js:3:3)',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('groups browser errors across builds (hashed bundle names)', () => {
    const a = fp({ source: 'browser', http: undefined, stack: 'TypeError\n    at render (https://s.test/assets/index-a1b2c3d4.js:1:900)' });
    const b = fp({ source: 'browser', http: undefined, stack: 'TypeError\n    at render (https://s.test/assets/index-Zz9Yy8Xx.js:1:455)' });
    expect(a).toBe(b);
  });
  it('separates different error types, frames, sources and projects', () => {
    const base = fp({});
    expect(fp({ error_type: 'RangeError' })).not.toBe(base);
    expect(fp({ stack: 'TypeError: x\n    at other (/app/src/other.js:1:1)' })).not.toBe(base);
    expect(fp({ source: 'browser', http: undefined })).not.toBe(base);
    expect(fp({}, 2)).not.toBe(base);
  });
  it('builds title and culprit', () => {
    const d = describeEvent(1, makeEvent());
    expect(d.title).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(d.culprit).toBe('getUser (/app/src/services/users.js)');
    expect(describeEvent(1, makeEvent({ stack: undefined })).culprit).toBe('/api/users/:id');
    expect(describeEvent(1, makeEvent({ stack: undefined, http: undefined })).culprit).toBe('/api/users/42');
    expect(describeEvent(1, makeEvent({ message: 'x'.repeat(1000) })).title).toHaveLength(200);
  });
});
