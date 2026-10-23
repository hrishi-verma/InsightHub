require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { loadConfig } = require('./config');
const { log } = require('./logger');
const { createKafka, createKafkaCheck, runErrorConsumer } = require('./kafka');
const { runLegacyConsumer } = require('./legacyLogs');
const { createProcessor } = require('./processor');
const { createMlShadow } = require('./mlShadow');
const { createHealthServer, createMetrics } = require('./health');

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
  const metrics = createMetrics();
  // Count retries from the existing log call instead of changing the processor.
  const countingLog = (event, fields) => {
    if (event === 'event_retry') metrics.retry();
    log(event, fields);
  };
  const rawProcess = createProcessor({ pool, config, log: countingLog, mlScore: createMlShadow(config.ml, { log }) });
  const processMessage = async (...args) => {
    const result = await rawProcess(...args);
    metrics.record(result);
    return result;
  };
  const health = createHealthServer({
    host: config.health.host,
    port: config.health.port,
    checkDb: () => pool.query('SELECT 1'),
    checkKafka: createKafkaCheck(kafka, { isStopping: () => stopping }),
    metrics,
    log,
  });
  try {
    await health.listen();
  } catch (err) {
    log('health_listen_failed', { code: err && err.code }); // fail closed: no endpoint, no start
    process.exit(1);
  }
  log('health_listening', { host: config.health.host, port: config.health.port });

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
    await health.close().catch(() => {});
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
