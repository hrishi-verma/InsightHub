require('dotenv').config();

const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createKafka, createEventPublisher, createLegacyPublisher } = require('./services/kafka');
const { MemoryRateLimitStore } = require('./services/rateLimitStore');
const { createApp } = require('./app');
const { logger, describeError } = require('./lib/logger');

const SESSION_CLEANUP_EVERY_MS = 10 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // The message names the bad variable and rule, never its value.
    logger.error('refusing to start', { reason: err.message });
    process.exit(1);
  }

  const pool = createPool(config.db);
  const kafka = createKafka(config.kafka.brokers);
  const eventPublisher = createEventPublisher(kafka, config.kafka.eventsTopic);
  const legacyPublisher = createLegacyPublisher(kafka, config.kafka.legacyTopic);
  const rateLimitStore = new MemoryRateLimitStore();
  const { app, sessions } = createApp({ config, pool, eventPublisher, legacyPublisher, rateLimitStore });

  // Connect early so the first event doesn't pay for it; failure here is not fatal (ingest returns 503).
  eventPublisher.connect().catch((err) => logger.warn('kafka not reachable at startup', describeError(err)));

  const cleanup = setInterval(() => {
    sessions.deleteExpired().catch((err) => logger.warn('session cleanup failed', describeError(err)));
  }, SESSION_CLEANUP_EVERY_MS);
  cleanup.unref();

  const server = app.listen(config.port, () => logger.info('backend listening', { port: config.port, env: config.nodeEnv }));
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => {
      logger.error('shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    clearInterval(cleanup);
    await new Promise((resolve) => server.close(resolve));
    rateLimitStore.close();
    await Promise.allSettled([eventPublisher.disconnect(), legacyPublisher.disconnect()]);
    await pool.end().catch((err) => logger.warn('closing db pool failed', describeError(err)));
    logger.info('shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
