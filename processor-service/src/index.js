require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { loadConfig } = require('./config');
const { log } = require('./logger');
const { createKafka, runErrorConsumer } = require('./kafka');
const { runLegacyConsumer } = require('./legacyLogs');
const { createProcessor } = require('./processor');
const { createMlShadow } = require('./mlShadow');

const SHUTDOWN_TIMEOUT_MS = 30000;

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    log('config_error', { reason: err.message }); // names the bad keys, never their values
    process.exit(1);
  }

  const pool = new Pool(config.db);
  // An idle client losing its connection must not crash the process; the next query retries.
  pool.on('error', (err) => log('db_pool_error', { code: err && err.code }));
  await pool.query('SELECT 1');
  log('db_connected');

  let stopping = false;
  const consumers = [];
  const kafka = createKafka(config.kafka);
  const processMessage = createProcessor({ pool, config, log, mlScore: createMlShadow(config.ml, { log }) });

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    log('shutdown', { signal });
    const timer = setTimeout(() => {
      log('shutdown_timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    // disconnect() waits for in-flight messages, which then commit their offsets.
    await Promise.allSettled(consumers.map((c) => c.disconnect()));
    await pool.end().catch(() => {});
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  consumers.push(await runErrorConsumer({
    kafka, kafkaConfig: config.kafka, processMessage, log, isStopping: () => stopping,
  }));
  log('consumer_started', { topic: config.kafka.errorTopic, group: config.kafka.errorGroup, ml_shadow: config.ml.enabled });

  if (config.kafka.legacyLogs) {
    consumers.push(await runLegacyConsumer({ kafka, pool, mlEngineUrl: config.ml.url, log }));
    log('consumer_started', { topic: 'logs', group: 'log-processors' });
  }
}

process.on('unhandledRejection', (err) => {
  log('fatal', { error: err && err.name, code: err && err.code });
  process.exit(1);
});

main().catch((err) => {
  log('startup_failed', { error: err && err.name, code: err && err.code });
  process.exit(1);
});
