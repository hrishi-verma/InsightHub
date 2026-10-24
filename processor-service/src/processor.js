const { parseMessage } = require('./schema');
const { describe } = require('./fingerprint');
const { upsertIssue, insertEvent, countEvent } = require('./store');
const { applyRules } = require('./rules');

// Errors worth retrying: the DB is down, restarting, overloaded, or we lost a race.
// Anything else (bad data, unknown project, a bug) is permanent and the message is skipped.
const TRANSIENT_SQLSTATE = /^(08|53|57P0[1-3]|40001|40P01|55P03|57014)/;
const TRANSIENT_NODE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH']);
const TRANSIENT_MESSAGE = /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/;

function isTransient(err) {
  if (!err) return false;
  if (typeof err.code === 'string' && (TRANSIENT_SQLSTATE.test(err.code) || TRANSIENT_NODE.has(err.code))) return true;
  return TRANSIENT_MESSAGE.test(String(err.message));
}

class ShutdownError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Builds the function that handles one Kafka message from `error-events`.
 * Result: { status: 'stored' | 'duplicate' | 'invalid' | 'failed', alerts?, issueId?, title?, reason? }.
 * It only throws ShutdownError (DB still unavailable while shutting down), so the offset
 * is not committed and the message is redelivered later.
 */
function createProcessor({ pool, config, mlScore, log, retry = {}, onRetry = () => {} }) {
  const baseMs = retry.baseMs ?? 200;
  const maxMs = retry.maxMs ?? 30000;
  const maxAttempts = retry.maxAttempts ?? Infinity; // block rather than lose data while the DB is down

  async function storeOnce(msg, desc, ml) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const issue = await upsertIssue(client, msg.project_id, msg.event, desc);
      const inserted = await insertEvent(client, msg, issue.id, ml);
      if (!inserted) {
        await client.query('ROLLBACK');
        return { status: 'duplicate', issueId: issue.id };
      }
      await countEvent(client, issue.id, msg.event);
      const alerts = await applyRules(client, { projectId: msg.project_id, issue, event: msg.event }, config.rules);
      await client.query('COMMIT');
      return { status: 'stored', issueId: issue.id, alerts, title: desc.title, projectId: msg.project_id };
    } catch (err) {
      // A connection-level failure means this client is unusable; destroy it instead of pooling it.
      broken = isTransient(err);
      await client.query('ROLLBACK').catch(() => { broken = true; });
      throw err;
    } finally {
      client.release(broken);
    }
  }

  return async function processMessage(kafkaMessage, { shouldStop = () => false, heartbeat = async () => {} } = {}) {
    const parsed = parseMessage(kafkaMessage, { maxBytes: config.kafka.maxMessageBytes });
    if (!parsed.ok) {
      log('event_invalid', { reason: parsed.reason });
      return { status: 'invalid', reason: parsed.reason };
    }
    const msg = parsed.message;
    const ids = { event_id: msg.event.event_id, project_id: msg.project_id };

    let desc;
    let ml;
    try {
      desc = describe(msg.project_id, msg.event);
      ml = await mlScore(msg.project_id, msg.event); // outside the transaction; never throws
    } catch (err) {
      log('event_failed', { ...ids, reason: 'describe', error: err && err.name });
      return { status: 'failed', reason: 'describe' };
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await storeOnce(msg, desc, ml);
        if (result.status === 'duplicate') log('event_duplicate', ids);
        for (const a of result.alerts || []) log('alert_raised', { ...ids, issue_id: result.issueId, kind: a.kind });
        return result;
      } catch (err) {
        const code = err && typeof err.code === 'string' ? err.code : undefined;
        if (!isTransient(err)) {
          // e.g. 23503 = project_id doesn't exist. Logged by code only: pg details can echo values.
          log('event_failed', { ...ids, reason: 'permanent db error', code });
          return { status: 'failed', reason: 'permanent db error' };
        }
        if (attempt >= maxAttempts || shouldStop()) {
          log('event_retry_aborted', { ...ids, code, attempt });
          throw new ShutdownError('database unavailable');
        }
        const wait = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
        log('event_retry', { ...ids, code, attempt, wait_ms: wait });
        try { onRetry(); } catch { /* a metrics hook must never break processing */ }
        await sleep(wait);
        await heartbeat().catch(() => {});
      }
    }
  };
}

module.exports = { createProcessor, isTransient, ShutdownError };
