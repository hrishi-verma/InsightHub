const express = require('express');
const { ApiError } = require('../../lib/errors');
const { logger, describeError } = require('../../lib/logger');
const { batchSchema, describeIssue } = require('../../services/eventSchema');
const { scrub } = require('../../services/scrub');

const MINUTE = 60_000;
const LIMITS = { secretPerKey: 600, publicPerKey: 600, publicPerKeyAndIp: 60 };
const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'Content-Type, X-InsightHub-Key',
  'Access-Control-Max-Age': '600',
};

const truncate = (s, max) => (typeof s === 'string' && s.length > max ? s.slice(0, max) : s);

// Scrubbing can lengthen a string slightly ("a@b.io" → "[email]"), so re-apply the limits.
function scrubEvent(event) {
  const out = { ...event, message: truncate(scrub(event.message), 1000) };
  if (out.stack !== undefined) out.stack = truncate(scrub(out.stack), 16000);
  if (out.url_path !== undefined) out.url_path = truncate(scrub(out.url_path, { homeDirs: false }), 512);
  if (out.tags !== undefined) {
    out.tags = Object.fromEntries(Object.entries(out.tags).map(([k, v]) => [k, truncate(scrub(v), 128)]));
  }
  return out;
}

function createEventsRouter({ apiKeys, publisher, rateLimitStore }) {
  const router = express.Router();
  const parseJson = express.json({ limit: '64kb', strict: true, inflate: false, type: () => true });

  router.options('/', async (req, res, next) => {
    try {
      const origin = req.get('Origin');
      res.vary('Origin');
      if (!origin || !(await apiKeys.isAllowedPublicOrigin(origin))) {
        throw new ApiError('FORBIDDEN', 'Origin not allowed');
      }
      res.set({ 'Access-Control-Allow-Origin': origin, ...PREFLIGHT_HEADERS });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  async function authenticate(req, res, next) {
    try {
      const authHeader = req.get('Authorization');
      const publicKey = req.get('X-InsightHub-Key');
      if (authHeader !== undefined && publicKey !== undefined) {
        throw new ApiError('UNAUTHORIZED', 'Send exactly one API key');
      }
      let key = null;
      if (authHeader !== undefined) {
        // Secret keys are server-side only. An Origin header (even "null") means a browser sent it,
        // so the key is exposed: refuse before any lookup. Message doesn't echo key or origin.
        if (req.get('Origin') !== undefined) {
          throw new ApiError('UNAUTHORIZED', 'Secret keys must not be used from a browser');
        }
        const m = /^Bearer (\S+)$/.exec(authHeader);
        key = m ? await apiKeys.authenticate(m[1], 'secret') : null;
      } else if (publicKey !== undefined) {
        key = await apiKeys.authenticate(publicKey, 'public');
      }
      if (!key) throw new ApiError('UNAUTHORIZED', 'Missing, unknown or revoked API key');

      if (key.kind === 'public') {
        const origin = req.get('Origin');
        res.vary('Origin');
        if (!origin || !key.allowedOrigins.includes(origin)) {
          throw new ApiError('FORBIDDEN', 'Origin not allowed for this key');
        }
        res.set('Access-Control-Allow-Origin', origin);
      }
      req.apiKey = key;
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireJson(req, res, next) {
    if (!req.is('application/json')) return next(new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
    next();
  }

  async function rateLimit(req, res, next) {
    try {
      const { id, kind } = req.apiKey;
      const events = req.body?.events;
      const cost = Array.isArray(events) ? Math.min(Math.max(events.length, 1), 20) : 1;
      const buckets = kind === 'secret'
        ? [{ key: `sk:${id}`, limit: LIMITS.secretPerKey, windowMs: MINUTE }]
        : [
            { key: `pk:${id}`, limit: LIMITS.publicPerKey, windowMs: MINUTE },
            { key: `pkip:${id}:${req.ip}`, limit: LIMITS.publicPerKeyAndIp, windowMs: MINUTE },
          ];
      const result = await rateLimitStore.consume(buckets, cost);
      if (!result.allowed) throw new ApiError('RATE_LIMITED', 'Too many events', { retryAfter: result.retryAfter });
      next();
    } catch (err) {
      next(err);
    }
  }

  router.post('/', requireJson, authenticate, parseJson, rateLimit, async (req, res, next) => {
    try {
      const parsed = batchSchema(Date.now()).safeParse(req.body);
      if (!parsed.success) throw new ApiError('VALIDATION_ERROR', describeIssue(parsed.error));

      const expectedSource = req.apiKey.kind === 'secret' ? 'server' : 'browser';
      if (parsed.data.events.some((e) => e.source !== expectedSource)) {
        throw new ApiError('FORBIDDEN', `Events sent with a ${req.apiKey.kind} key must have source "${expectedSource}"`);
      }

      const events = parsed.data.events.map(scrubEvent);
      try {
        await publisher.publish(req.apiKey.projectId, events, new Date().toISOString());
      } catch (err) {
        logger.error('publishing events failed', describeError(err));
        throw new ApiError('UNAVAILABLE', 'Event queue unavailable, retry later');
      }
      res.status(202).json({ accepted: events.length });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createEventsRouter, LIMITS };
