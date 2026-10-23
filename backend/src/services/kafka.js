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
  // Loaded here, not at the top, so unit tests with a fake client don't need the native binding.
  const { Kafka, logLevel } = require('@confluentinc/kafka-javascript').KafkaJS;
  return new Kafka({
    kafkaJS: {
      clientId: 'insighthub-backend',
      brokers,
      connectionTimeout: 3000,
      requestTimeout: 5000,
      retry: { retries: 2, initialRetryTime: 200, maxRetryTime: 2000 },
      logLevel: logLevel.WARN,
    },
  });
}

// A producer that connects lazily, never hangs the caller (every call has a timeout),
// and recovers on the next send after a failure.
function createPublisher(kafka, producerOptions = {}) {
  let producer = null;
  let connected = false;
  let connecting = null;

  // This client's producer can't connect() again once connect was called, so a failed producer
  // is replaced, not reconnected. The old one is torn down in the background (bounded).
  function retire(failed) {
    if (!failed || producer !== failed) return;
    producer = null;
    connected = false;
    withTimeout(failed.disconnect(), CONNECT_TIMEOUT_MS, 'kafka disconnect').catch(() => {});
  }

  // Resolves to the connected producer, so callers never read `producer` after an await
  // (a concurrent failure may have retired it in between).
  async function connect() {
    if (connected && producer) return producer;
    if (!connecting) {
      if (!producer) producer = kafka.producer(producerOptions);
      const current = producer;
      connecting = withTimeout(current.connect(), CONNECT_TIMEOUT_MS, 'kafka connect')
        .then(() => {
          // A disconnect() during the connect leaves nothing to mark as connected.
          if (producer !== current) throw new Error('kafka producer was replaced while connecting');
          connected = true;
          return current;
        })
        .catch((err) => {
          retire(current);
          throw err;
        })
        .finally(() => {
          connecting = null;
        });
    }
    return connecting;
  }

  async function send(record) {
    const current = await connect();
    try {
      return await withTimeout(current.send(record), SEND_TIMEOUT_MS, 'kafka send');
    } catch (err) {
      // The connection may be half-broken: start from a new producer next time.
      retire(current);
      throw err;
    }
  }

  async function disconnect() {
    if (!producer) return;
    const current = producer;
    producer = null;
    connected = false;
    try {
      await withTimeout(current.disconnect(), CONNECT_TIMEOUT_MS, 'kafka disconnect');
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
    kafkaJS: {
      idempotent: true,
      acks: -1,
      maxInFlightRequests: 1,
      // Bounded retries: the send timeout returns 503 anyway, and the sender's retry is
      // deduplicated downstream by event_id.
      retry: { retries: 3, initialRetryTime: 200, maxRetryTime: 2000 },
    },
    // Same partition choice as the old kafkajs default (Java-compatible murmur2).
    partitioner: 'murmur2_random',
    // librdkafka queues while the broker is down; fail the queued message with the send timeout.
    'message.timeout.ms': SEND_TIMEOUT_MS,
  });
  return {
    connect: publisher.connect,
    disconnect: publisher.disconnect,
    isConnected: publisher.isConnected,
    async publish(projectId, events, receivedAt) {
      const key = String(projectId);
      await publisher.send({
        topic,
        messages: events.map((event) => ({
          key,
          value: JSON.stringify({ schema: 1, project_id: projectId, received_at: receivedAt, event }),
        })),
      });
    },
  };
}

function createLegacyPublisher(kafka, topic) {
  const publisher = createPublisher(kafka, {
    partitioner: 'murmur2_random',
    'message.timeout.ms': SEND_TIMEOUT_MS,
  });
  return {
    disconnect: publisher.disconnect,
    async publishLog(log) {
      await publisher.send({ topic, messages: [{ value: JSON.stringify(log) }] });
    },
  };
}

module.exports = { createKafka, createEventPublisher, createLegacyPublisher, withTimeout };
