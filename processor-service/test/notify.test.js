import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNotifier } = require('../src/notify');
const nodemailer = require('nodemailer');

const SECRET_URL = 'https://hooks.example.com/services/T000/B000/SECRETTOKEN';
const flush = () => new Promise((r) => setTimeout(r, 20));

function setup(cfg = {}, extra = {}) {
  const logs = [];
  const calls = [];
  const fetchImpl = extra.fetchImpl || (async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; });
  const notifier = createNotifier({
    config: { webhookUrl: SECRET_URL, email: null, dashboardUrl: 'https://dash.example.com', maxPerHour: 20, timeoutMs: 5000, ...cfg },
    log: (event, fields) => logs.push({ event, ...fields }),
    fetchImpl,
    ...extra.rest,
  });
  return { notifier, logs, calls };
}

const stored = (over = {}) => ({
  status: 'stored', issueId: 7, projectId: 1, title: 'TypeError: boom',
  alerts: [{ kind: 'new_issue', details: { event_id: 'x' } }], ...over,
});

describe('webhook', () => {
  it('posts { text } with kind, project, title and link only', async () => {
    const { notifier, calls, logs } = setup();
    notifier.notify(stored());
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SECRET_URL);
    expect(calls[0].opts).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(Object.keys(calls[0].body)).toEqual(['text']);
    expect(calls[0].body.text).toBe('New issue in project 1: TypeError: boom\nhttps://dash.example.com/issues/7');
    expect(logs).toEqual([{ event: 'notify_sent', channel: 'webhook', kind: 'new_issue' }]);
  });

  it('builds the link from a string id (pg bigint) and refuses odd ids', async () => {
    const { notifier, calls } = setup();
    notifier.notify(stored({ issueId: '35' }));
    notifier.notify(stored({ issueId: '3/../x' }));
    await flush();
    expect(calls[0].body.text).toContain('https://dash.example.com/issues/35');
    expect(calls[1].body.text).not.toContain('/issues/');
  });

  it('describes spikes with numbers and regressions in words', async () => {
    const { notifier, calls } = setup();
    notifier.notify(stored({ alerts: [
      { kind: 'spike', details: { window_minutes: 5, count: 42, baseline_avg: 1.5, threshold: 10 } },
      { kind: 'regression', details: { release: 'x' } },
    ] }));
    await flush();
    expect(calls[0].body.text).toContain('Spike in project 1');
    expect(calls[0].body.text).toContain('42 events in 5 min');
    expect(calls[0].body.text).toContain('threshold 10');
    expect(calls[1].body.text).toContain('Regression in project 1');
  });

  it('escapes Slack markup, strips control characters and cuts the title to 200 chars', async () => {
    const { notifier, calls } = setup();
    notifier.notify(stored({ title: `<!channel> a & b\n\r\u0007@here ${'x'.repeat(500)}` }));
    await flush();
    const text = calls[0].body.text;
    expect(text).toContain('&lt;!channel&gt; a &amp; b');
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
    const titleLine = text.split('\n')[0];
    expect(titleLine.length).toBeLessThanOrEqual('New issue in project 1: '.length + 200 + 20); // escaping may add a little
    expect(titleLine).not.toContain('x'.repeat(201));
  });

  it('leaks nothing else from the result (no stack, url_path, tags)', async () => {
    const { notifier, calls } = setup();
    notifier.notify(stored({ stack: 'at secretFn (/app/x.js:1:1)', url_path: '/secret/path', tags: { a: 'b' }, event: { stack: 's' } }));
    await flush();
    const body = JSON.stringify(calls[0].body);
    expect(body).not.toMatch(/secretFn|secret\/path|"a"/);
  });

  it('never logs the URL, title or errors', async () => {
    const { notifier, logs } = setup({}, { fetchImpl: async () => { throw new Error(`failed ${SECRET_URL} TypeError: boom`); } });
    notifier.notify(stored());
    await flush();
    expect(logs).toEqual([{ event: 'notify_failed', channel: 'webhook', kind: 'new_issue', code: 'Error' }]);
    expect(JSON.stringify(logs)).not.toMatch(/SECRETTOKEN|boom/);
  });

  it('treats a non-2xx answer as failed (code only)', async () => {
    const { notifier, logs } = setup({}, { fetchImpl: async () => ({ ok: false, status: 500 }) });
    notifier.notify(stored());
    await flush();
    expect(logs[0]).toEqual({ event: 'notify_failed', channel: 'webhook', kind: 'new_issue', code: 'http_500' });
  });

  it('times out without throwing, and aborts the request', async () => {
    let signal;
    const { notifier, logs } = setup({ timeoutMs: 30 }, { fetchImpl: (url, opts) => { signal = opts.signal; return new Promise(() => {}); } });
    expect(() => notifier.notify(stored())).not.toThrow();
    await new Promise((r) => setTimeout(r, 100));
    expect(logs).toEqual([{ event: 'notify_failed', channel: 'webhook', kind: 'new_issue', code: 'timeout' }]);
    expect(signal.aborted).toBe(true);
  });

  it('does not notify for anything but stored results with alerts', async () => {
    const { notifier, calls } = setup();
    notifier.notify({ status: 'duplicate', issueId: 1 });
    notifier.notify({ status: 'invalid', reason: 'x' });
    notifier.notify({ status: 'failed' });
    notifier.notify(stored({ alerts: [] }));
    notifier.notify(null);
    await flush();
    expect(calls).toHaveLength(0);
  });

  it('is off without configuration', async () => {
    const { notifier, calls } = setup({ webhookUrl: null });
    expect(notifier.enabled).toBe(false);
    notifier.notify(stored());
    await flush();
    expect(calls).toHaveLength(0);
  });
});

describe('rate limit', () => {
  it('drops over the hourly limit, then reports how many were missed', async () => {
    let t = 1000000;
    const { notifier, calls, logs } = setup({ maxPerHour: 2 }, { rest: { now: () => t } });
    for (let i = 0; i < 5; i++) notifier.notify(stored());
    await flush();
    expect(calls).toHaveLength(2);
    expect(logs.filter((l) => l.event === 'notify_suppressed')).toHaveLength(3);
    expect(calls[1].body.text).not.toContain('not sent');

    t += 3600001;
    notifier.notify(stored());
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].body.text).toContain('(3 alerts were not sent in the last hour; see the dashboard)');
    notifier.notify(stored());
    await flush();
    expect(calls[3].body.text).not.toContain('not sent');
  });

  it('limits each channel separately', async () => {
    const mail = nodemailer.createTransport({ jsonTransport: true });
    const sent = [];
    const origSend = mail.sendMail.bind(mail);
    mail.sendMail = async (m) => { sent.push(m); return origSend(m); };
    const { notifier, calls } = setup({
      maxPerHour: 1, email: { from: 'a@example.com', to: ['b@example.com'] },
    }, { rest: { transport: mail } });
    notifier.notify(stored());
    notifier.notify(stored());
    await flush();
    expect(calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});

describe('email', () => {
  it('sends plain text through the injected nodemailer transport', async () => {
    const mail = nodemailer.createTransport({ jsonTransport: true });
    const results = [];
    const origSend = mail.sendMail.bind(mail);
    mail.sendMail = async (m) => { const r = await origSend(m); results.push(JSON.parse(r.message)); return r; };
    const { notifier, logs } = setup({
      webhookUrl: null, email: { from: 'alerts@example.com', to: ['a@example.com', 'b@example.com'] },
    }, { rest: { transport: mail } });
    notifier.notify(stored({ title: 'Evil\r\nBcc: x@evil.example' }));
    await flush();
    expect(results).toHaveLength(1);
    const m = results[0];
    expect(m.subject).toBe('[InsightHub] New issue in project 1: Evil Bcc: x@evil.example');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).toContain('https://dash.example.com/issues/7');
    expect(m.html).toBeUndefined();
    expect(m.to.map((x) => x.address)).toEqual(['a@example.com', 'b@example.com']);
    expect(logs).toEqual([{ event: 'notify_sent', channel: 'email', kind: 'new_issue' }]);
    expect(JSON.stringify(logs)).not.toContain('example.com');
  });

  it('logs a failed send by code only', async () => {
    const mail = { sendMail: async () => { throw Object.assign(new Error('535 bad login for a@example.com'), { code: 'EAUTH' }); } };
    const { notifier, logs } = setup({
      webhookUrl: null, email: { from: 'alerts@example.com', to: ['a@example.com'] },
    }, { rest: { transport: mail } });
    notifier.notify(stored());
    await flush();
    expect(logs).toEqual([{ event: 'notify_failed', channel: 'email', kind: 'new_issue', code: 'EAUTH' }]);
  });

  it('builds a real transport that demands STARTTLS for remote hosts', () => {
    const { createNotifier: make } = require('../src/notify');
    const created = [];
    const orig = nodemailer.createTransport;
    nodemailer.createTransport = (opts) => { created.push(opts); return { sendMail: async () => {} }; };
    try {
      const email = { host: 'smtp.example.com', port: 587, secure: false, local: false, user: 'u', password: 'p', from: 'a@example.com', to: ['b@example.com'] };
      make({ config: { email, maxPerHour: 5 }, log: () => {} });
      make({ config: { email: { ...email, host: 'localhost', local: true, user: undefined }, maxPerHour: 5 }, log: () => {} });
    } finally {
      nodemailer.createTransport = orig;
    }
    expect(created[0]).toMatchObject({ requireTLS: true, secure: false, auth: { user: 'u', pass: 'p' }, socketTimeout: 5000 });
    expect(created[1]).toMatchObject({ requireTLS: false, auth: undefined });
  });
});
