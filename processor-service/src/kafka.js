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
 * Health check: lists topics through one reused admin client. The client can't connect() twice,
 * so after any error (or hang) it is dropped and a fresh one is made on the next check.
 */
function createKafkaCheck(kafka, { isStopping, timeoutMs = 1800 }) {
  let admin = null;
  const drop = () => {
    const old = admin;
    admin = null;
    if (old) Promise.resolve().then(() => old.disconnect()).catch(() => {});
  };
  return async function checkKafka() {
    if (isStopping()) throw new Error('stopping');
    if (!admin) {
      admin = kafka.admin();
      admin.ready = admin.connect(); // shared by concurrent callers
    }
    const current = admin;
    let timer;
    try {
      await Promise.race([
        current.ready.then(() => current.listTopics()),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
      ]);
    } catch (err) {
      if (admin === current) drop();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
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
    kafkaJS: {
      groupId: kafkaConfig.errorGroup,
      fromBeginning: false,
      autoCommit: false,
      // eachMessage blocks while processMessage retries a DB outage forever (no data loss), and the
      // library maps this to max.poll.interval.ms: past it the member is kicked from the group.
      // 15 min covers long outages; after a longer one the redelivery is safe because storing is
      // idempotent on (event_id, occurred_at).
      rebalanceTimeout: 900000,
    },
  });

  await consumer.connect();
  await consumer.subscribe({ topics: [kafkaConfig.errorTopic] });
  await consumer.run({
    partitionsConsumedConcurrently: kafkaConfig.concurrency, // bounded parallelism; one partition stays in order
    eachMessage: async ({ topic, partition, message }) => {
      // The library has no per-message heartbeat; liveness is covered by the poll interval above.
      await processMessage(message, { shouldStop: isStopping });
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

module.exports = { createKafka, createKafkaCheck, runErrorConsumer };
