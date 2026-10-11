const { Kafka, logLevel } = require('kafkajs');

function createKafka(kafkaConfig) {
  return new Kafka({
    clientId: kafkaConfig.clientId,
    brokers: kafkaConfig.brokers,
    logLevel: logLevel.WARN,
    connectionTimeout: 5000,
    requestTimeout: 30000,
  });
}

/**
 * Consumes `error-events`. Offsets are committed manually, one message at a time and only after
 * processMessage returns (i.e. after the DB transaction committed, or the message was judged
 * invalid/permanently failing and skipped). A redelivery after a crash is harmless because
 * storing is idempotent on (event_id, occurred_at).
 */
async function runErrorConsumer({ kafka, kafkaConfig, processMessage, log, isStopping }) {
  const consumer = kafka.consumer({ groupId: kafkaConfig.errorGroup });
  consumer.on(consumer.events.CRASH, (e) => {
    log('consumer_crash', { group: kafkaConfig.errorGroup, error: e.payload && e.payload.error && e.payload.error.name, restart: e.payload && e.payload.restart });
  });

  await consumer.connect();
  await consumer.subscribe({ topic: kafkaConfig.errorTopic, fromBeginning: false });
  await consumer.run({
    autoCommit: false,
    partitionsConsumedConcurrently: kafkaConfig.concurrency, // bounded parallelism; one partition stays in order
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      await processMessage(message, { shouldStop: isStopping, heartbeat });
      const next = (BigInt(message.offset) + 1n).toString();
      try {
        await consumer.commitOffsets([{ topic, partition, offset: next }]);
      } catch (err) {
        // The message is stored; at worst it's redelivered and deduplicated.
        log('commit_failed', { partition, error: err && err.name });
      }
    },
  });
  return consumer;
}

module.exports = { createKafka, runErrorConsumer };
