const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { ApiError } = require('../../lib/errors');
const { requireSession, SESSION_COOKIE } = require('../../middleware/dashboard');
const { SESSION_TTL_MS } = require('../../services/sessions');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT_PER_IP_EMAIL = 10;
// Extra cap so one IP can't spray passwords across many emails.
const LOGIN_LIMIT_PER_IP = 50;
const BCRYPT_COST = 12;
const BAD_LOGIN = 'Invalid email or password';

const loginSchema = z.strictObject({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
});

function createAuthRouter({ pool, sessions, rateLimitStore, config }) {
  const router = express.Router();
  // Compared against when the email is unknown, so both paths cost one bcrypt check.
  const dummyHash = bcrypt.hash('insighthub-timing-equaliser', BCRYPT_COST);

  const cookieAttrs = (maxAgeSeconds) =>
    [`Path=/`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`, ...(config.isProduction ? ['Secure'] : [])].join('; ');

  router.post('/login', async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError('VALIDATION_ERROR', 'Body must be { email, password }');
      const email = parsed.data.email.trim().toLowerCase();

      const limited = await rateLimitStore.consume([
        { key: `login:${req.ip}:${email}`, limit: LOGIN_LIMIT_PER_IP_EMAIL, windowMs: LOGIN_WINDOW_MS },
        { key: `login-ip:${req.ip}`, limit: LOGIN_LIMIT_PER_IP, windowMs: LOGIN_WINDOW_MS },
      ]);
      if (!limited.allowed) throw new ApiError('RATE_LIMITED', 'Too many login attempts', { retryAfter: limited.retryAfter });

      const { rows } = await pool.query(
        'SELECT id, email, role, password_hash, disabled_at FROM users WHERE email = $1',
        [email],
      );
      const user = rows[0];
      const passwordOk = await bcrypt.compare(parsed.data.password, user ? user.password_hash : await dummyHash);
      if (!user || !passwordOk || user.disabled_at) throw new ApiError('UNAUTHORIZED', BAD_LOGIN);

      // Opportunistic cleanup; a periodic job also does this.
      sessions.deleteExpired().catch(() => {});
      const token = await sessions.create(user.id);
      res.set('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttrs(Math.floor(SESSION_TTL_MS / 1000))}`);
      res.status(200).json({ user: { id: user.id, email: user.email, role: user.role } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', requireSession(sessions), async (req, res, next) => {
    try {
      await sessions.destroy(req.sessionToken);
      res.set('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs(0)}`);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireSession(sessions), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

module.exports = { createAuthRouter, BCRYPT_COST };
