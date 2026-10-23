const { Kafka, logLevel } = require('@confluentinc/kafka-javascript').KafkaJS;

function createKafka(kafkaConfig) {
  return new Kafka({
    kafkaJS: {
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers,
      logLevel: logLevel.WARN,
      connectionTimeout: 5000,
      requestTimeout: 30000,
    },
  });
}

/**
 * Consumes `error-events`. Offsets are committed manually, one message at a time and only after
 * processMessage returns (i.e. after the DB transaction committed, or the message was judged
 * invalid/permanently failing and skipped). A redelivery after a crash is harmless because
 * storing is idempotent on (event_id, occurred_at).
 */
async function runErrorConsumer({ kafka, kafkaConfig, processMessage, log, isStopping }) {
  // No CRASH event in this client (consumer.events throws), so there is no crash log line.
  const consumer = kafka.consumer({
    kafkaJS: { groupId: kafkaConfig.errorGroup, fromBeginning: false, autoCommit: false },
  });

  await consumer.connect();
  await consumer.subscribe({ topics: [kafkaConfig.errorTopic] });
  await consumer.run({
    partitionsConsumedConcurrently: kafkaConfig.concurrency, // bounded parallelism; one partition stays in order
    eachMessage: async ({ topic, partition, message }) => {
      // The library keeps the session alive itself; processMessage still expects a heartbeat().
      await processMessage(message, { shouldStop: isStopping, heartbeat: async () => {} });
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
