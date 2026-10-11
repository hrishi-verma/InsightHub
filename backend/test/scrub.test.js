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
    ['url query + fragment', 'GET https://a.com/x?y=1&email=z#top failed', 'GET https://a.com/x failed'],
  ])('scrubs %s', (_name, input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it('keeps ordinary error text and stack frames', () => {
    const text = 'PrismaClientKnownRequestError: Unique constraint failed\n    at register (/var/task/backend/services/auth.service.js:42:11) at 09:30:00';
    expect(scrub(text)).toBe(text);
  });
});
