// Alert notifications (webhook and/or email). Called only after the DB transaction committed.
// Fire-and-forget: nothing here may throw into, or block, the Kafka loop.
// Only the alert kind, project id, the (already scrubbed) issue title, spike numbers and a link
// are sent. Never the stack, url_path, tags or any other event field.
// Logs carry channel/kind/code only, never URLs, addresses or titles (the webhook URL is a secret).

const HOUR_MS = 3600000;
const TITLE_MAX = 200;
const KIND_WORDS = { new_issue: 'New issue', spike: 'Spike', regression: 'Regression' };
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]+/gu; // control chars (incl. newlines) and line/paragraph separators

function cleanTitle(title) {
  return String(title ?? '').replace(CONTROL, ' ').trim().slice(0, TITLE_MAX);
}

// Slack-style webhooks treat < > & as markup (links, mentions), so neutralise them.
const escapeSlack = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Plain-text lines for one alert. `kind` is looked up, so an unknown value can't inject text. */
function describeAlert({ alert, issueId, projectId, title, dashboardUrl }) {
  const word = KIND_WORDS[alert.kind] || 'Alert';
  const lines = [`${word}${Number.isInteger(projectId) ? ` in project ${projectId}` : ''}: ${cleanTitle(title)}`];
  if (alert.kind === 'spike' && alert.details) {
    const d = alert.details;
    const parts = [];
    if (num(d.count) !== null && num(d.window_minutes) !== null) parts.push(`${d.count} events in ${d.window_minutes} min`);
    if (num(d.baseline_avg) !== null) parts.push(`usual ${d.baseline_avg} per window`);
    if (num(d.threshold) !== null) parts.push(`alert threshold ${d.threshold}`);
    if (parts.length) lines.push(parts.join(', '));
  }
  // pg returns bigint ids as strings, so accept digits in either form.
  if (dashboardUrl && /^[0-9]{1,18}$/.test(String(issueId))) lines.push(`${dashboardUrl}/issues/${issueId}`);
  return { word, lines };
}

function withTimeout(run, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error('timeout');
      err.code = 'timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve().then(() => run(controller.signal)), timeout]).finally(() => clearTimeout(timer));
}

const errorCode = (err) => String((err && (err.code || (err.cause && err.cause.code) || err.name)) || 'error').slice(0, 40);

function defaultTransport(email, timeoutMs) {
  // Loaded here so tests and webhook-only setups don't pay for it.
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    requireTLS: !email.secure && !email.local, // never send credentials or alerts in clear text
    auth: email.user ? { user: email.user, pass: email.password } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
}

/**
 * config: the `notify` block from loadConfig. `fetchImpl` and `transport` are injectable for tests.
 * notify(result) takes a stored processMessage result and schedules the sends.
 */
function createNotifier({ config, log, fetchImpl = globalThis.fetch, transport, now = () => Date.now() }) {
  const timeoutMs = config.timeoutMs ?? 5000;
  const channels = [];

  function limiter() {
    const sent = [];
    let suppressed = 0;
    // Returns { allowed, missed }: missed = alerts dropped since the last message that went out.
    return () => {
      const t = now();
      while (sent.length && t - sent[0] >= HOUR_MS) sent.shift();
      if (sent.length >= config.maxPerHour) {
        suppressed += 1;
        return { allowed: false, missed: 0 };
      }
      sent.push(t);
      const missed = suppressed;
      suppressed = 0;
      return { allowed: true, missed };
    };
  }

  if (config.webhookUrl) {
    channels.push({
      name: 'webhook',
      take: limiter(),
      async send({ lines }) {
        const res = await withTimeout(
          (signal) => fetchImpl(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: escapeSlack(lines.join('\n')) }),
            redirect: 'error',
            signal,
          }),
          timeoutMs,
        );
        // Free the connection; the body is never read.
        if (res && res.body && res.body.cancel) res.body.cancel().catch(() => {});
        if (!res || !res.ok) {
          const err = new Error('bad status');
          err.code = `http_${res && res.status}`;
          throw err;
        }
      },
    });
  }

  if (config.email) {
    const mail = transport || defaultTransport(config.email, timeoutMs);
    channels.push({
      name: 'email',
      take: limiter(),
      async send({ lines }) {
        await withTimeout(
          () => mail.sendMail({
            from: config.email.from,
            to: config.email.to,
            subject: `[InsightHub] ${lines[0]}`.replace(CONTROL, ' ').slice(0, 250),
            text: lines.join('\n'),
          }),
          timeoutMs,
        );
      },
    });
  }

  function dispatch(channel, kind, message) {
    const { allowed, missed } = channel.take();
    if (!allowed) {
      log('notify_suppressed', { channel: channel.name, kind });
      return;
    }
    const lines = missed > 0
      ? [...message.lines, `(${missed} alerts were not sent in the last hour; see the dashboard)`]
      : message.lines;
    // Scheduled, not awaited by the caller; a failure only becomes a log line.
    Promise.resolve()
      .then(() => channel.send({ ...message, lines }))
      .then(
        () => log('notify_sent', { channel: channel.name, kind }),
        (err) => log('notify_failed', { channel: channel.name, kind, code: errorCode(err) }),
      );
  }

  return {
    enabled: channels.length > 0,
    notify(result) {
      try {
        if (!channels.length || !result || result.status !== 'stored' || !Array.isArray(result.alerts)) return;
        for (const alert of result.alerts) {
          if (!alert || typeof alert.kind !== 'string') continue;
          const message = describeAlert({
            alert, issueId: result.issueId, projectId: result.projectId, title: result.title,
            dashboardUrl: config.dashboardUrl,
          });
          const kind = KIND_WORDS[alert.kind] ? alert.kind : 'other';
          for (const channel of channels) dispatch(channel, kind, message);
        }
      } catch {
        log('notify_failed', { channel: 'all', kind: 'other', code: 'internal' });
      }
    },
  };
}

module.exports = { createNotifier, describeAlert, cleanTitle };
