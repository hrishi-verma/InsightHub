require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { loadConfig } = require('./config');
const { log } = require('./logger');
const { createKafka, createKafkaCheck, runErrorConsumer } = require('./kafka');
const { runLegacyConsumer } = require('./legacyLogs');
const { createProcessor } = require('./processor');
const { createPipeline } = require('./pipeline');
const { createNotifier } = require('./notify');
const { createDlq } = require('./dlq');
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
  const rawProcess = createProcessor({
    pool, config, log, mlScore: createMlShadow(config.ml, { log }), onRetry: metrics.retry,
  });
  const notifier = createNotifier({ config: config.notify, log });
  const processMessage = createPipeline({ rawProcess, metrics, notifier });
  const dlq = config.dlq.enabled
    ? createDlq({ kafka, topic: config.dlq.topic, log, timeoutMs: config.dlq.timeoutMs, onSent: metrics.dlqSent })
    : null;
  let errorConsumer = null; // set once runErrorConsumer resolves; the health server starts first
  const health = createHealthServer({
    host: config.health.host,
    port: config.health.port,
    checkDb: () => pool.query('SELECT 1'),
    checkKafka: createKafkaCheck(kafka, { isStopping: () => stopping }),
    // assignment() returns [{ topic, partition }] and throws if not connected (-> down).
    checkConsumer: () => errorConsumer !== null && errorConsumer.assignment().length > 0,
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
    if (dlq) await dlq.disconnect().catch(() => {});
    await health.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  errorConsumer = await runErrorConsumer({
    kafka, kafkaConfig: config.kafka, processMessage, log, isStopping: () => stopping, dlq,
  });
  consumers.push(errorConsumer);
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
