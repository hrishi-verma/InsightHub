const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ApiError, sendError } = require('./lib/errors');
const { logger, describeError } = require('./lib/logger');
const { dashboardCors, requireTrustedOrigin } = require('./middleware/dashboard');
const { createApiKeyService } = require('./services/apiKeys');
const { createSessionService } = require('./services/sessions');
const { createEventsRouter } = require('./routes/v1/events');
const { createAuthRouter } = require('./routes/v1/auth');
const { createDashboardRouter } = require('./routes/v1/dashboard');
const { createLogsRouter } = require('./routes/logs');

// Coarse per-IP cap on every request, in front of the per-key and per-login limits.
const REQUESTS_PER_IP_PER_MINUTE = 1200;

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // Path only: no query string, headers, body or client IP.
    logger.info('request', {
      method: req.method,
      path: req.originalUrl.split('?')[0].slice(0, 200),
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
    });
  });
  next();
}

function errorHandler(err, req, res, _next) {
  if (res.headersSent) return res.end();
  if (err instanceof ApiError) return sendError(res, err.code, err.message, err.retryAfter);
  // body-parser errors
  switch (err.type) {
    case 'entity.too.large':
      return sendError(res, 'PAYLOAD_TOO_LARGE', 'Body is too large');
    case 'entity.parse.failed':
      return sendError(res, 'VALIDATION_ERROR', 'Body is not valid JSON');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return sendError(res, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding or charset');
    case 'request.aborted':
    case 'request.size.invalid':
    case 'stream.encoding.set':
      return sendError(res, 'VALIDATION_ERROR', 'Could not read the request body');
    default:
      logger.error('unhandled error', { path: req.originalUrl.split('?')[0].slice(0, 200), ...describeError(err) });
      return sendError(res, 'INTERNAL', 'Internal error');
  }
}

/**
 * Builds the Express app. Dependencies are injected so tests can swap Kafka for a fake.
 * @param {{ config, pool, eventPublisher, legacyPublisher, rateLimitStore }} deps
 */
function createApp({ config, pool, eventPublisher, legacyPublisher, rateLimitStore }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // Flat query values only (no nested objects from qs).
  app.set('query parser', 'simple');

  const apiKeys = createApiKeyService(pool);
  const sessions = createSessionService(pool);

  app.use(requestLogger);
  app.use(helmet());
  app.use(async (req, res, next) => {
    try {
      const r = await rateLimitStore.consume([{ key: `ip:${req.ip}`, limit: REQUESTS_PER_IP_PER_MINUTE, windowMs: 60_000 }]);
      if (!r.allowed) throw new ApiError('RATE_LIMITED', 'Too many requests', { retryAfter: r.retryAfter });
      next();
    } catch (err) {
      next(err);
    }
  });

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.set('Cache-Control', 'no-store').json({ status: 'ok' });
    } catch (err) {
      logger.warn('health check failed', describeError(err));
      res.set('Cache-Control', 'no-store').status(503).json({ status: 'unavailable' });
    }
  });

  const v1 = express.Router();
  v1.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  v1.use('/events', createEventsRouter({ apiKeys, publisher: eventPublisher, rateLimitStore }));
  v1.use(dashboardCors(config.dashboardOrigins));
  v1.use(requireTrustedOrigin(config.dashboardOrigins));
  v1.use(express.json({ limit: '16kb', strict: true, inflate: false }));
  v1.use('/auth', createAuthRouter({ pool, sessions, rateLimitStore, config }));
  v1.use(createDashboardRouter({ pool, sessions }));
  app.use('/api/v1', v1);

  // Legacy pipeline. CORS narrowed from "*" to the dashboard origins (no credentials).
  const legacyOrigins = new Set(config.dashboardOrigins);
  app.use('/api/logs', (req, res, next) => {
    const origin = req.get('Origin');
    res.vary('Origin');
    if (origin && legacyOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(origin && legacyOrigins.has(origin) ? 204 : 403);
    next();
  });
  app.use('/api/logs', rateLimit({ windowMs: 60_000, max: 1000, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/logs', express.json({ limit: '100kb' }));
  app.use('/api/logs', createLogsRouter({ pool, legacyPublisher, serviceToken: config.serviceToken }));

  app.use((req, res) => sendError(res, 'NOT_FOUND', 'Not found'));
  app.use(errorHandler);

  return { app, sessions };
}

module.exports = { createApp };
