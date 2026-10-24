// Dead-letter topic. Records METADATA ONLY about messages that were skipped (invalid or permanently
// failed). The original value is never copied: it may not have passed the backend's scrubber.
// Bounded and best-effort: a DLQ failure is logged and never blocks the partition.

const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createDlq({ kafka, topic, log, timeoutMs = 5000, now = () => new Date(), onSent = () => {} }) {
  let producer = null;
  let connecting = null;

  // This client can't connect() the same producer twice, so a failed one is replaced.
  function retire(failed) {
    if (producer !== failed) return;
    producer = null;
    connecting = null;
    Promise.resolve().then(() => withTimeout(failed.disconnect(), timeoutMs, 'disconnect')).catch(() => {});
  }

  async function ready() {
    if (!producer) {
      const created = kafka.producer({ kafkaJS: { acks: -1 } });
      producer = created;
      connecting = created.connect();
      connecting.catch(() => {}); // the awaiting caller handles it; avoid an unhandled rejection
    }
    return { current: producer, connected: connecting };
  }

  /** meta: { reason, partition, offset, message } where message is the raw Kafka message. */
  async function send({ reason, partition, offset, message }) {
    const value = message && message.value;
    const record = {
      schema: 1,
      reason: String(reason ?? 'unknown').replace(CONTROL, ' ').slice(0, 100),
      source_partition: partition,
      source_offset: String(offset),
      key_present: !!(message && message.key != null),
      value_bytes: value == null ? 0 : Buffer.byteLength(value),
      failed_at: now().toISOString(),
    };
    let current = null;
    try {
      const r = await ready();
      current = r.current;
      await withTimeout(
        r.connected.then(() => current.send({ topic, messages: [{ value: JSON.stringify(record) }] })),
        timeoutMs,
        'dlq send',
      );
      onSent();
      return true;
    } catch (err) {
      if (current) retire(current);
      log('dlq_failed', { code: err && typeof err.code === 'string' ? err.code : undefined });
      return false;
    }
  }

  async function disconnect() {
    const current = producer;
    producer = null;
    if (current) await withTimeout(current.disconnect(), timeoutMs, 'disconnect').catch(() => {});
  }

  return { send, disconnect };
}

module.exports = { createDlq };
