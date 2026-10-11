import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createProcessor, ShutdownError } = require('../src/processor');
const { createMlShadow, NONE } = require('../src/mlShadow');
const { testConfig, createPool, resetDb, makeEvent, kafkaMessage } = require('./helpers');

const config = testConfig();
let pool;
let projectId;
let logs;
const log = (event, fields) => logs.push({ event, ...fields });

function processor(overrides = {}) {
  return createProcessor({
    pool,
    config: { ...config, rules: { ...config.rules, ...(overrides.rules || {}) } },
    mlScore: overrides.mlScore || (async () => NONE),
    log,
    retry: overrides.retry,
  });
}

const one = async (sql, params) => (await pool.query(sql, params)).rows[0];
const alertKinds = async () => (await pool.query('SELECT kind FROM issue_alerts ORDER BY id')).rows.map((r) => r.kind);
const eventCount = async () => Number((await one('SELECT count(*) AS n FROM error_events')).n);

beforeAll(async () => { pool = createPool(config); });
afterAll(async () => { await pool.end(); });
beforeEach(async () => { logs = []; projectId = await resetDb(pool); });

describe('storing events', () => {
  it('creates an issue and stores the event with every field', async () => {
    const event = makeEvent({ tags: { area: 'checkout' } });
    const r = await processor()(kafkaMessage(projectId, event));
    expect(r.status).toBe('stored');

    const issue = await one('SELECT * FROM issues WHERE id = $1', [r.issueId]);
    expect(issue).toMatchObject({
      project_id: projectId, source: 'server', error_type: 'TypeError', status: 'unresolved',
      event_count: '1', last_release: 'abc1234', culprit: 'getUser (/app/src/services/users.js)',
    });
    const row = await one('SELECT * FROM error_events WHERE event_id = $1', [event.event_id]);
    expect(row).toMatchObject({
      issue_id: r.issueId, http_method: 'GET', http_status: 500, http_route: '/api/users/:id',
      tags: { area: 'checkout' }, ml_score: null, ml_model_version: null,
    });
  });

  it('groups similar events into one issue and counts them', async () => {
    const p = processor();
    const a = await p(kafkaMessage(projectId, makeEvent({ message: 'Order 12 failed' })));
    const b = await p(kafkaMessage(projectId, makeEvent({ message: 'Order 9876 failed' })));
    expect(a.issueId).toBe(b.issueId);
    expect((await one('SELECT event_count FROM issues WHERE id = $1', [a.issueId])).event_count).toBe('2');
  });

  it('stores a duplicate event_id once and counts it once', async () => {
    const p = processor();
    const msg = kafkaMessage(projectId, makeEvent());
    expect((await p(msg)).status).toBe('stored');
    expect((await p(msg)).status).toBe('duplicate');
    expect(await eventCount()).toBe(1);
    expect((await one('SELECT event_count FROM issues')).event_count).toBe('1');
    expect(await alertKinds()).toEqual(['new_issue']);
  });

  it('handles concurrent duplicates and same-issue events safely', async () => {
    const p = processor();
    const dup = kafkaMessage(projectId, makeEvent());
    const others = Array.from({ length: 8 }, () => kafkaMessage(projectId, makeEvent()));
    await Promise.all([dup, dup, dup, ...others].map((m) => p(m)));
    expect(await eventCount()).toBe(9);
    expect((await one('SELECT event_count FROM issues')).event_count).toBe('9');
    expect(await alertKinds()).toEqual(['new_issue']);
  });

  it('keeps last_seen/last_release from the newest event when events arrive out of order', async () => {
    const p = processor();
    const now = Date.now();
    await p(kafkaMessage(projectId, makeEvent({ occurred_at: new Date(now).toISOString(), release: 'new' })));
    await p(kafkaMessage(projectId, makeEvent({ occurred_at: new Date(now - 3600000).toISOString(), release: 'old' })));
    const issue = await one('SELECT * FROM issues');
    expect(issue.last_release).toBe('new');
    expect(issue.last_seen.getTime()).toBe(now);
    expect(issue.first_seen.getTime()).toBe(now - 3600000);
  });
});

describe('invalid messages', () => {
  it('skips bad messages without throwing or storing anything', async () => {
    const p = processor();
    const bad = [
      { key: null, value: Buffer.from('not json') },
      { key: null, value: Buffer.alloc(70000, 'a') },
      kafkaMessage(projectId, { ...makeEvent(), password: 'x' }),
      kafkaMessage(projectId, makeEvent(), { extra: true }),
      kafkaMessage(projectId, makeEvent({ message: 'x'.repeat(5000) })),
      { key: null, value: null },
    ];
    for (const m of bad) expect((await p(m)).status).toBe('invalid');
    expect(await eventCount()).toBe(0);
    expect(logs.every((l) => l.event === 'event_invalid')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('password');
  });

  it('skips events for an unknown project and keeps going', async () => {
    const p = processor();
    expect((await p(kafkaMessage(999999, makeEvent()))).status).toBe('failed');
    expect(logs.at(-1)).toMatchObject({ event: 'event_failed', code: '23503' });
    expect((await p(kafkaMessage(projectId, makeEvent()))).status).toBe('stored');
  });
});

describe('alert rules', () => {
  it('raises new_issue on the first event only', async () => {
    const p = processor();
    await p(kafkaMessage(projectId, makeEvent()));
    await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual(['new_issue']);
  });

  it('raises regression for a resolved issue and flips it back to unresolved', async () => {
    const p = processor();
    const { issueId } = await p(kafkaMessage(projectId, makeEvent()));
    await pool.query(`UPDATE issues SET status = 'resolved', resolved_at = now() - interval '1 minute' WHERE id = $1`, [issueId]);
    await p(kafkaMessage(projectId, makeEvent({ release: 'fix2' })));
    const issue = await one('SELECT status, resolved_at FROM issues WHERE id = $1', [issueId]);
    expect(issue).toEqual({ status: 'unresolved', resolved_at: null });
    expect(await alertKinds()).toEqual(['new_issue', 'regression']);
    const reg = await one(`SELECT details FROM issue_alerts WHERE kind = 'regression'`);
    expect(reg.details.release).toBe('fix2');
  });

  it('a late event that happened before the resolve is counted but is not a regression', async () => {
    const p = processor();
    const { issueId } = await p(kafkaMessage(projectId, makeEvent()));
    await pool.query(`UPDATE issues SET status = 'resolved', resolved_at = now() WHERE id = $1`, [issueId]);
    const before = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await p(kafkaMessage(projectId, makeEvent({ occurred_at: before })));
    const issue = await one('SELECT status, event_count FROM issues WHERE id = $1', [issueId]);
    expect(issue.status).toBe('resolved');
    expect(Number(issue.event_count)).toBe(2);
    expect(await alertKinds()).toEqual(['new_issue']);
  });

  it('ignored issues store and count events but raise nothing (not even a spike)', async () => {
    const p = processor();
    const { issueId } = await p(kafkaMessage(projectId, makeEvent()));
    await pool.query(`UPDATE issues SET status = 'ignored' WHERE id = $1`, [issueId]);
    await pool.query('DELETE FROM issue_alerts');
    for (let i = 0; i < 12; i++) await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual([]);
    const issue = await one('SELECT status, event_count FROM issues WHERE id = $1', [issueId]);
    expect(issue).toEqual({ status: 'ignored', event_count: '13' });
  });

  it('raises spike at the threshold, then respects the cooldown', async () => {
    const p = processor();
    for (let i = 0; i < 9; i++) await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual(['new_issue']);

    await p(kafkaMessage(projectId, makeEvent())); // 10th event in 5 min
    expect(await alertKinds()).toEqual(['new_issue', 'spike']);
    const spike = await one(`SELECT details FROM issue_alerts WHERE kind = 'spike'`);
    expect(spike.details).toEqual({ window_minutes: 5, count: 10, baseline_avg: 0, threshold: 10 });

    for (let i = 0; i < 5; i++) await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual(['new_issue', 'spike']); // within the hour

    // An hour later the cooldown is over.
    await pool.query(`UPDATE issue_alerts SET created_at = now() - interval '61 minutes' WHERE kind = 'spike'`);
    await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual(['new_issue', 'spike', 'spike']);
  });

  it('raises the spike threshold for issues with a busy baseline', async () => {
    const p = processor({ rules: { spikeMinCount: 3, spikeMultiplier: 2 } });
    const { issueId } = await p(kafkaMessage(projectId, makeEvent()));
    // Baseline: 864 events spread over the previous 24 h = an average of 3 per 5 minutes.
    await pool.query(
      `INSERT INTO error_events (event_id, occurred_at, received_at, project_id, issue_id, source, environment, level, error_type, message)
       SELECT gen_random_uuid(), now() - interval '6 minutes' - (i * interval '100 seconds'), now(), $1, $2,
              'server', 'production', 'error', 'TypeError', 'x'
       FROM generate_series(0, 863) AS i`,
      [projectId, issueId],
    );
    // Threshold is max(3, 2 × 3) = 6: the 5th event isn't a spike, the 6th is.
    for (let i = 0; i < 4; i++) await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual(['new_issue']);
    await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual(['new_issue', 'spike']);
    const spike = await one(`SELECT details FROM issue_alerts WHERE kind = 'spike'`);
    expect(spike.details).toMatchObject({ count: 6, baseline_avg: 3, threshold: 6 });
  });

  it('does not raise a spike for a replayed backlog of old events', async () => {
    const p = processor();
    const old = new Date(Date.now() - 2 * 3600000).toISOString();
    for (let i = 0; i < 12; i++) await p(kafkaMessage(projectId, makeEvent({ occurred_at: old })));
    expect(await alertKinds()).toEqual(['new_issue']);
  });

  it('reads spike thresholds from config', async () => {
    const p = processor({ rules: { spikeMinCount: 2 } });
    await p(kafkaMessage(projectId, makeEvent()));
    await p(kafkaMessage(projectId, makeEvent()));
    expect(await alertKinds()).toEqual(['new_issue', 'spike']);
  });
});

describe('ML shadow', () => {
  const mlCfg = { enabled: true, url: 'http://ml.test', timeoutMs: 500, modelVersion: 'synthetic-v0' };

  it('stores score and version when the ML engine answers', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ anomaly_score: 0.75 }), { status: 200 });
    const p = processor({ mlScore: createMlShadow(mlCfg, { fetchImpl }) });
    const event = makeEvent();
    await p(kafkaMessage(projectId, event));
    const row = await one('SELECT ml_score, ml_model_version FROM error_events WHERE event_id = $1', [event.event_id]);
    expect(row).toEqual({ ml_score: 0.75, ml_model_version: 'synthetic-v0' });
  });

  it('stores nulls and carries on when the ML engine times out', async () => {
    const fetchImpl = (url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
    const p = processor({ mlScore: createMlShadow(mlCfg, { fetchImpl, log }) });
    const event = makeEvent();
    const r = await p(kafkaMessage(projectId, event));
    expect(r.status).toBe('stored');
    const row = await one('SELECT ml_score, ml_model_version FROM error_events WHERE event_id = $1', [event.event_id]);
    expect(row).toEqual({ ml_score: null, ml_model_version: null });
    expect(logs.some((l) => l.event === 'ml_shadow_failed' && l.reason === 'timeout')).toBe(true);
  });

  it('does not let the score affect alerts', async () => {
    const run = async (score) => {
      projectId = await resetDb(pool);
      const fetchImpl = async () => new Response(JSON.stringify({ anomaly_score: score }), { status: 200 });
      const p = processor({ mlScore: createMlShadow(mlCfg, { fetchImpl }) });
      for (let i = 0; i < 10; i++) await p(kafkaMessage(projectId, makeEvent()));
      return alertKinds();
    };
    const high = await run(1);
    const low = await run(0);
    expect(high).toEqual(['new_issue', 'spike']);
    expect(low).toEqual(high);
  });
});

describe('reliability', () => {
  function flakyPool(failures, error) {
    let left = failures;
    return {
      connect: async () => {
        if (left-- > 0) throw error;
        return pool.connect();
      },
    };
  }

  it('retries transient DB errors with backoff, then stores', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const p = createProcessor({
      pool: flakyPool(2, err), config, mlScore: async () => NONE, log, retry: { baseMs: 5 },
    });
    expect((await p(kafkaMessage(projectId, makeEvent()))).status).toBe('stored');
    expect(logs.filter((l) => l.event === 'event_retry')).toHaveLength(2);
  });

  it('stops retrying on shutdown so the offset is not committed', async () => {
    const err = Object.assign(new Error('the database system is shutting down'), { code: '57P03' });
    let stop = false;
    const p = createProcessor({
      pool: flakyPool(100, err), config, mlScore: async () => NONE, log, retry: { baseMs: 5 },
    });
    const pending = p(kafkaMessage(projectId, makeEvent()), { shouldStop: () => stop });
    setTimeout(() => { stop = true; }, 30);
    await expect(pending).rejects.toBeInstanceOf(ShutdownError);
    expect(await eventCount()).toBe(0);
  });

  it('does not retry permanent errors', async () => {
    const err = Object.assign(new Error('boom'), { code: '22P02' });
    const p = createProcessor({
      pool: flakyPool(1, err), config, mlScore: async () => NONE, log, retry: { baseMs: 5 },
    });
    expect((await p(kafkaMessage(projectId, makeEvent()))).status).toBe('failed');
  });

  it('commits nothing when the transaction fails part-way', async () => {
    // Fail on the alert insert (last step) and check the event and count were rolled back.
    const failing = {
      connect: async () => {
        const client = await pool.connect();
        const query = client.query.bind(client);
        client.query = (sql, params) => (/INSERT INTO issue_alerts/.test(sql)
          ? Promise.reject(Object.assign(new Error('nope'), { code: '23514' }))
          : query(sql, params));
        const release = client.release.bind(client);
        client.release = () => { client.query = query; release(); };
        return client;
      },
    };
    const p = createProcessor({ pool: failing, config, mlScore: async () => NONE, log });
    expect((await p(kafkaMessage(projectId, makeEvent()))).status).toBe('failed');
    expect(await eventCount()).toBe(0);
    expect(Number((await one('SELECT count(*) AS n FROM issues')).n)).toBe(0);
  });
});
