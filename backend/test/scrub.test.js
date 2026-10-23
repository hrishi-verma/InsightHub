import { describe, it, expect } from 'vitest';
import { scrub } from '../src/services/scrub.js';

describe('scrub', () => {
  it.each([
    ['email', 'user jane.doe+x@mail.example.com failed', 'user [email] failed'],
    ['bearer credential', 'header Bearer abc123.def', 'header [credential]'],
    ['basic credential', 'Authorization: Basic dXNlcjpwYXNz', 'Authorization: [credential]'],
    ['jwt', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk end', 'token [jwt] end'],
    ['hex token', 'reset 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b', 'reset [token]'],
    ['base64url token', 'session Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFi', 'session [token]'],
    ['ipv4', 'connect ECONNREFUSED 10.1.2.3:5432', 'connect ECONNREFUSED [ip]:5432'],
    ['ipv6', 'from 2001:db8:85a3::8a2e:370:7334 and ::1', 'from [ip] and [ip]'],
    ['macOS home dir', 'at fn (/Users/jane/Projects/app/x.js:1:2)', 'at fn (~/Projects/app/x.js:1:2)'],
    ['linux home dir', 'at /home/deploy/app/x.js:1:2', 'at ~/app/x.js:1:2'],
    ['file URL home dir', 'at file:///Users/jane/app/x.js:3:4', 'at file://~/app/x.js:3:4'],
    ['windows home dir', 'at fn (C:\\Users\\Jane Doe\\app\\x.js:1:2)', 'at fn (~\\app\\x.js:1:2)'],
    ['url query + fragment', 'GET https://a.com/x?y=1&email=z#top failed', 'GET https://a.com/x failed'],
  ])('scrubs %s', (_name, input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it('keeps ordinary error text and stack frames', () => {
    const text = 'PrismaClientKnownRequestError: Unique constraint failed\n    at register (/var/task/backend/services/auth.service.js:42:11) at 09:30:00';
    expect(scrub(text)).toBe(text);
  });

  it('keeps non-home absolute paths', () => {
    const text = 'at x (/var/task/app.js:1:1) at y (/app/node_modules/z/index.js:2:2) at /usr/lib/node.js';
    expect(scrub(text)).toBe(text);
  });

  // ReDoS guard: the old email pattern was quadratic (~2 s on 64 KB without an '@').
  it.each(['a', 'a.', '1.', 'a1', '-', 'wss://', 'https://a', '=/a'])('scrubs 64 KB of %j in linear time', (unit) => {
    const text = unit.repeat(64000 / unit.length);
    const started = performance.now();
    scrub(text);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
