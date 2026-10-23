import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import helpers from './helpers.js';
import { sha256Hex } from '../src/lib/crypto.js';

const { buildApp, resetDb, createUser, getPool, closePool, sessionCookie, DASHBOARD } = helpers;

const PASSWORD = 'correct horse battery staple';

beforeEach(async () => {
  await resetDb();
  await createUser('admin@example.com', PASSWORD, 'admin');
  await createUser('viewer@example.com', PASSWORD, 'viewer');
});
afterAll(closePool);

const login = (app, email, password, origin = DASHBOARD) =>
  request(app).post('/api/v1/auth/login').set('Origin', origin).set('Content-Type', 'application/json').send({ email, password });

describe('login', () => {
  it('logs in and sets a hardened session cookie', async () => {
    const { app } = buildApp();
    const res = await login(app, 'Admin@Example.com', PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'admin@example.com', role: 'admin' });
    expect(res.body.user.password_hash).toBeUndefined();

    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^ih_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=43200/);
    expect(cookie).not.toMatch(/Secure/); // only in production

    // Only the hash is stored.
    const token = sessionCookie(res).split('=')[1];
    const { rows } = await getPool().query('SELECT token_hash, expires_at FROM sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha256Hex(token));
    const hours = (new Date(rows[0].expires_at) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
  });

  it('sets Secure on the cookie in production', async () => {
    const { app } = buildApp({ env: { NODE_ENV: 'production', DASHBOARD_ORIGINS: 'https://dash.example' } });
    const res = await login(app, 'admin@example.com', PASSWORD, 'https://dash.example');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/; Secure/);
  });

  it('uses the __Host- cookie in production: Secure, Path=/, no Domain', async () => {
    const env = { NODE_ENV: 'production', DASHBOARD_ORIGINS: 'https://dash.example' };
    const { app } = buildApp({ env });
    const res = await login(app, 'admin@example.com', PASSWORD, 'https://dash.example');
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^__Host-ih_session=[A-Za-z0-9_-]{43}; /);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).not.toMatch(/Domain/i);

    const value = sessionCookie(res).split('=')[1];
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', `__Host-ih_session=${value}`)).status).toBe(200);
    // The development name is not accepted by the production app.
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', `ih_session=${value}`)).status).toBe(401);

    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', `__Host-ih_session=${value}`)
      .set('Origin', 'https://dash.example').set('Content-Type', 'application/json');
    expect(out.headers['set-cookie'][0]).toMatch(/^__Host-ih_session=;.*Max-Age=0.*Secure/);
  });

  it('does not accept the production cookie name in development', async () => {
    const { app } = buildApp();
    const value = sessionCookie(await login(app, 'admin@example.com', PASSWORD)).split('=')[1];
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', `__Host-ih_session=${value}`)).status).toBe(401);
  });

  // The 72-byte cap is enforced by create-user; login must keep older, longer passwords working.
  it('still logs in an account created with a password over 72 bytes', async () => {
    const long = `${'L'.repeat(90)}-pre-cap`;
    await createUser('legacy@example.com', long, 'viewer');
    const { app } = buildApp();
    expect((await login(app, 'legacy@example.com', long)).status).toBe(200);
  });

  it('rejects passwords over 128 characters with the generic 400', async () => {
    const { app } = buildApp();
    const res = await login(app, 'admin@example.com', 'a'.repeat(129));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Body must be { email, password }');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('gives the same response for unknown email and wrong password', async () => {
    const { app } = buildApp();
    const unknown = await login(app, 'nobody@example.com', PASSWORD);
    const wrong = await login(app, 'admin@example.com', 'wrong password!!');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('refuses disabled users with the same response', async () => {
    const { app } = buildApp();
    await getPool().query(`UPDATE users SET disabled_at = now() WHERE email = 'admin@example.com'`);
    const res = await login(app, 'admin@example.com', PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('throttles after 10 attempts per IP + email in 15 minutes', async () => {
    const { app } = buildApp();
    for (let i = 0; i < 10; i++) expect((await login(app, 'admin@example.com', 'wrong password!!')).status).toBe(401);
    const res = await login(app, 'admin@example.com', PASSWORD);
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // A different email from the same IP is a different bucket.
    expect((await login(app, 'viewer@example.com', PASSWORD)).status).toBe(200);
  });

  it('rejects unknown body fields', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/v1/auth/login').set('Origin', DASHBOARD).set('Content-Type', 'application/json')
      .send({ email: 'admin@example.com', password: PASSWORD, role: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('CSRF / Origin checks', () => {
  it('rejects POST without an Origin (403)', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send({ email: 'admin@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects POST from a foreign Origin (403)', async () => {
    const { app } = buildApp();
    expect((await login(app, 'admin@example.com', PASSWORD, 'https://evil.example')).status).toBe(403);
  });

  it('rejects form-encoded POSTs even from the dashboard origin (403)', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/v1/auth/login').set('Origin', DASHBOARD).type('form').send({ email: 'admin@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('allows credentialed CORS only for dashboard origins', async () => {
    const { app } = buildApp();
    const ok = await request(app).options('/api/v1/issues').set('Origin', DASHBOARD).set('Access-Control-Request-Method', 'PATCH');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(DASHBOARD);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).options('/api/v1/issues').set('Origin', 'https://evil.example');
    expect(bad.status).toBe(403);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('sessions', () => {
  it('me returns the user; logout deletes the session', async () => {
    const { app } = buildApp();
    const cookie = sessionCookie(await login(app, 'admin@example.com', PASSWORD));

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('admin@example.com');

    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', DASHBOARD).set('Content-Type', 'application/json');
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'][0]).toMatch(/^ih_session=;.*Max-Age=0/);
    expect((await getPool().query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(0);

    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects an expired session (401)', async () => {
    const { app } = buildApp();
    const cookie = sessionCookie(await login(app, 'admin@example.com', PASSWORD));
    await getPool().query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects sessions of users disabled after login (401)', async () => {
    const { app } = buildApp();
    const cookie = sessionCookie(await login(app, 'admin@example.com', PASSWORD));
    await getPool().query(`UPDATE users SET disabled_at = now()`);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects missing and forged cookies (401)', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', `ih_session=${'A'.repeat(43)}`)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', `ih_session=' OR 1=1 --`)).status).toBe(401);
  });

  it('deletes expired sessions on login', async () => {
    const { app } = buildApp();
    await login(app, 'admin@example.com', PASSWORD);
    await getPool().query(`UPDATE sessions SET expires_at = now() - interval '1 hour'`);
    await login(app, 'admin@example.com', PASSWORD);
    await new Promise((r) => setTimeout(r, 100));
    const { rows } = await getPool().query('SELECT count(*)::int AS n FROM sessions WHERE expires_at <= now()');
    expect(rows[0].n).toBe(0);
  });
});
