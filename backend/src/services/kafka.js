const { Kafka, Partitioners, logLevel } = require('kafkajs');
const { logger, describeError } = require('../lib/logger');

const CONNECT_TIMEOUT_MS = 5000;
const SEND_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createKafka(brokers) {
  return new Kafka({
    clientId: 'insighthub-backend',
    brokers,
    connectionTimeout: 3000,
    requestTimeout: 5000,
    retry: { retries: 2, initialRetryTime: 200, maxRetryTime: 2000 },
    logLevel: logLevel.WARN,
  });
}

// A producer that connects lazily, never hangs the caller (every call has a timeout),
// and reconnects on the next send after a failure.
function createPublisher(kafka, producerOptions = {}) {
  const producer = kafka.producer(producerOptions);
  let connected = false;
  let connecting = null;
  let disconnecting = Promise.resolve();

  producer.on(producer.events.DISCONNECT, () => {
    connected = false;
  });

  async function connect() {
    if (connected) return;
    if (!connecting) {
      // Don't reconnect while a teardown from a failed send is still running.
      connecting = withTimeout(disconnecting.then(() => producer.connect()), CONNECT_TIMEOUT_MS, 'kafka connect')
        .then(() => {
          connected = true;
        })
        .finally(() => {
          connecting = null;
        });
    }
    await connecting;
  }

  async function send(record) {
    await connect();
    try {
      return await withTimeout(producer.send(record), SEND_TIMEOUT_MS, 'kafka send');
    } catch (err) {
      // Force a fresh connection next time; the old one may be half-broken.
      connected = false;
      disconnecting = producer.disconnect().catch(() => {});
      throw err;
    }
  }

  async function disconnect() {
    try {
      await withTimeout(producer.disconnect(), CONNECT_TIMEOUT_MS, 'kafka disconnect');
    } catch (err) {
      logger.warn('kafka disconnect failed', describeError(err));
    }
  }

  return { connect, send, disconnect, isConnected: () => connected };
}

// Contract §2: topic "error-events", key = project id, one message per event.
function createEventPublisher(kafka, topic) {
  // Idempotent producer: broker-side dedup of retried sends (needs acks=all, one in-flight request).
  const publisher = createPublisher(kafka, {
    idempotent: true,
    maxInFlightRequests: 1,
    createPartitioner: Partitioners.DefaultPartitioner,
    // Bounded retries (kafkajs warns about this): the send timeout returns 503 anyway, and the
    // sender's retry is deduplicated downstream by event_id.
    retry: { retries: 3, initialRetryTime: 200, maxRetryTime: 2000 },
  });
  return {
    connect: publisher.connect,
    disconnect: publisher.disconnect,
    isConnected: publisher.isConnected,
    async publish(projectId, events, receivedAt) {
      const key = String(projectId);
      await publisher.send({
        topic,
        acks: -1,
        messages: events.map((event) => ({
          key,
          value: JSON.stringify({ schema: 1, project_id: projectId, received_at: receivedAt, event }),
        })),
      });
    },
  };
}

function createLegacyPublisher(kafka, topic) {
  const publisher = createPublisher(kafka, { createPartitioner: Partitioners.DefaultPartitioner });
  return {
    disconnect: publisher.disconnect,
    async publishLog(log) {
      await publisher.send({ topic, messages: [{ value: JSON.stringify(log) }] });
    },
  };
}

module.exports = { createKafka, createEventPublisher, createLegacyPublisher, withTimeout };
