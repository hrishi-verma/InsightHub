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

  // Review findings: length caps let long values through unscrubbed.
  it('drops the query of a URL with a very long path', () => {
    const path = 'p'.repeat(2100);
    expect(scrub(`GET https://x.com/${path}?token=abc&email=a@b.co failed`)).toBe(`GET https://x.com/${path} failed`);
  });

  it('redacts emails with a long local part or many domain labels completely', () => {
    expect(scrub(`${'a'.repeat(70)}@example.com sent`)).toBe('[email] sent');
    expect(scrub('to x@a.b.c.d.e.f.g.h.i.j.k.example.com now')).toBe('to [email] now');
  });

  it('scrubs percent-encoded emails, credentials and query strings', () => {
    expect(scrub('lookup failed for jane%40example.com')).toBe('lookup failed for [email]');
    expect(scrub('GET https://a.com/cb%3Fcode%3D123 failed')).toBe('GET https://a.com/cb failed');
    expect(scrub('header Bearer%20abc.def')).toBe('header [credential]');
    expect(scrub('100% done, 50%off')).toBe('100% done, 50%off'); // unrelated escapes untouched
  });

  // Over-scrubbing a 4-part version like 1.2.3.4 as [ip] is accepted: privacy first (D35).
  it('treats a 4-part dotted number as an IP', () => {
    expect(scrub('upgrade to 10.1.2.3 failed')).toBe('upgrade to [ip] failed');
  });

  it('keeps site routes under /home in url_path', () => {
    expect(scrub('/home/courses/intro', { homeDirs: false })).toBe('/home/courses/intro');
    expect(scrub('/home/courses/intro')).toBe('~/intro');
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
