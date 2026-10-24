import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDlq } = require('../src/dlq');
const { createMessageHandler } = require('../src/kafka');
const { createPipeline } = require('../src/pipeline');
const { createMetrics } = require('../src/health');

const SECRET_VALUE = 'jane.doe@example.com Bearer abcdefghijklmnopqrstuvwxyz';

function fakeKafka({ failSends = 0, failConnects = 0 } = {}) {
  const producers = [];
  let sendFails = failSends;
  let connectFails = failConnects;
  return {
    producers,
    producer() {
      const p = {
        sent: [], connects: 0, disconnected: false,
        async connect() {
          p.connects += 1;
          if (p.connects > 1) throw new Error('cannot connect twice');
          if (connectFails-- > 0) throw new Error('down');
        },
        async send(r) {
          if (sendFails-- > 0) throw new Error('send failed');
          p.sent.push(r);
        },
        async disconnect() { p.disconnected = true; },
      };
      producers.push(p);
      return p;
    },
  };
}

const msg = { key: Buffer.from('1'), value: Buffer.from(SECRET_VALUE), offset: '41' };

describe('dlq', () => {
  it('produces metadata only, never the original value', async () => {
    const kafka = fakeKafka();
    const logs = [];
    const dlq = createDlq({ kafka, topic: 'error-events-dlq', log: (e, f) => logs.push({ e, ...f }), now: () => new Date('2026-10-24T00:00:00Z') });
    expect(await dlq.send({ reason: 'not JSON', partition: 2, offset: '41', message: msg })).toBe(true);
    const sent = kafka.producers[0].sent[0];
    expect(sent.topic).toBe('error-events-dlq');
    expect(sent.messages).toHaveLength(1);
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/jane|Bearer|abcdefghij/);
    expect(JSON.parse(sent.messages[0].value)).toEqual({
      schema: 1, reason: 'not JSON', source_partition: 2, source_offset: '41', key_present: true,
      value_bytes: Buffer.byteLength(SECRET_VALUE), failed_at: '2026-10-24T00:00:00.000Z',
    });
    expect(sent.messages[0].key).toBeUndefined(); // the key is message content too
    await dlq.send({ reason: 'x', partition: 0, offset: '1', message: { key: null, value: null } });
    expect(JSON.parse(kafka.producers[0].sent[1].messages[0].value)).toMatchObject({ key_present: false, value_bytes: 0 });
  });

  it('reuses one producer, and replaces it after a failure', async () => {
    const kafka = fakeKafka({ failSends: 1 });
    const logs = [];
    const dlq = createDlq({ kafka, topic: 't', log: (e, f) => logs.push({ e, ...f }) });
    expect(await dlq.send({ reason: 'a', partition: 0, offset: '1', message: msg })).toBe(false);
    expect(logs).toEqual([{ e: 'dlq_failed', code: undefined }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(kafka.producers[0].disconnected).toBe(true);
    expect(await dlq.send({ reason: 'b', partition: 0, offset: '2', message: msg })).toBe(true);
    expect(await dlq.send({ reason: 'c', partition: 0, offset: '3', message: msg })).toBe(true);
    expect(kafka.producers).toHaveLength(2);
    expect(kafka.producers[1].sent).toHaveLength(2);
    expect(kafka.producers[1].connects).toBe(1);
  });

  it('replaces the producer when connecting fails', async () => {
    const kafka = fakeKafka({ failConnects: 1 });
    const dlq = createDlq({ kafka, topic: 't', log: () => {} });
    expect(await dlq.send({ reason: 'a', partition: 0, offset: '1', message: msg })).toBe(false);
    expect(await dlq.send({ reason: 'b', partition: 0, offset: '2', message: msg })).toBe(true);
    expect(kafka.producers).toHaveLength(2);
  });

  it('gives up after the timeout instead of blocking', async () => {
    const kafka = { producer: () => ({ connect: () => new Promise(() => {}), send: async () => {}, disconnect: async () => {} }) };
    const logs = [];
    const dlq = createDlq({ kafka, topic: 't', log: (e) => logs.push(e), timeoutMs: 30 });
    expect(await dlq.send({ reason: 'a', partition: 0, offset: '1', message: msg })).toBe(false);
    expect(logs).toEqual(['dlq_failed']);
  });

  it('strips control characters from the reason and caps its length', async () => {
    const kafka = fakeKafka();
    const dlq = createDlq({ kafka, topic: 't', log: () => {} });
    await dlq.send({ reason: `a\nb${'z'.repeat(300)}`, partition: 0, offset: '1', message: msg });
    const { reason } = JSON.parse(kafka.producers[0].sent[0].messages[0].value);
    expect(reason).toHaveLength(100);
    expect(reason).not.toContain('\n');
  });
});

describe('message handler', () => {
  function handler(result, { dlq, commitFails = false } = {}) {
    const events = [];
    const h = createMessageHandler({
      processMessage: async () => { events.push('process'); return result; },
      dlq: dlq && { send: async (m) => { events.push(`dlq:${m.reason}`); return dlq(m); } },
      commit: async (o) => { events.push(`commit:${o[0].offset}`); if (commitFails) throw new Error('x'); },
      log: (e) => events.push(`log:${e}`),
      isStopping: () => false,
    });
    return { h, events };
  }
  const input = { topic: 'error-events', partition: 3, message: { ...msg, offset: '9' } };

  it('dead-letters invalid and failed messages before committing', async () => {
    for (const status of ['invalid', 'failed']) {
      const { h, events } = handler({ status, reason: 'why' }, { dlq: async () => true });
      await h(input);
      expect(events).toEqual(['process', 'dlq:why', 'commit:10']);
    }
  });

  it('does not dead-letter stored or duplicate messages', async () => {
    for (const status of ['stored', 'duplicate']) {
      const { h, events } = handler({ status, alerts: [] }, { dlq: async () => true });
      await h(input);
      expect(events).toEqual(['process', 'commit:10']);
    }
  });

  it('still commits when the DLQ send fails (dlq.send resolves false)', async () => {
    const { h, events } = handler({ status: 'invalid', reason: 'r' }, { dlq: async () => false });
    await h(input);
    expect(events).toEqual(['process', 'dlq:r', 'commit:10']);
  });

  it('still commits when the DLQ is off, and survives a commit error', async () => {
    const { h, events } = handler({ status: 'invalid', reason: 'r' }, { commitFails: true });
    await h(input);
    expect(events).toEqual(['process', 'commit:10', 'log:commit_failed']);
  });

  it('end to end with the real DLQ over a failing producer: commits anyway', async () => {
    const kafka = fakeKafka({ failSends: 5 });
    const events = [];
    const dlq = createDlq({ kafka, topic: 't', log: (e) => events.push(e) });
    const h = createMessageHandler({
      processMessage: async () => ({ status: 'invalid', reason: 'r' }), dlq,
      commit: async () => events.push('commit'), log: () => {}, isStopping: () => false,
    });
    await h(input);
    expect(events).toEqual(['dlq_failed', 'commit']);
  });
});

describe('pipeline wiring', () => {
  function pipeline(result) {
    const notified = [];
    const metrics = createMetrics();
    const p = createPipeline({ rawProcess: async () => result, metrics, notifier: { notify: (r) => notified.push(r) } });
    return { p, notified, metrics };
  }

  it('notifies only stored results that raised alerts', async () => {
    const stored = { status: 'stored', issueId: 1, alerts: [{ kind: 'new_issue', details: {} }] };
    const a = pipeline(stored);
    expect(await a.p({})).toBe(stored);
    expect(a.notified).toEqual([stored]);
    expect(a.metrics.snapshot().alerts_raised).toBe(1);

    for (const r of [
      { status: 'stored', issueId: 1, alerts: [] },
      { status: 'duplicate', issueId: 1 },
      { status: 'invalid', reason: 'x' },
      { status: 'failed', reason: 'y' },
    ]) {
      const b = pipeline(r);
      await b.p({});
      expect(b.notified).toEqual([]);
    }
  });

  it('counts dlq_sent and retries in metrics', () => {
    const m = createMetrics();
    m.dlqSent();
    m.retry();
    expect(m.snapshot()).toMatchObject({ dlq_sent: 1, retries: 1 });
  });
});
