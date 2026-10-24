const { z } = require('zod');

const onOff = z.enum(['on', 'off']);
const int = (def, min, max) => z.coerce.number().int().min(min).max(max).default(def);
const num = (def, min, max) => z.coerce.number().min(min).max(max).default(def);

// Outbound URLs must be https; plain http only for a local receiver (tests/dev).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLocalHost = (host) => LOCAL_HOSTS.has(host);
const safeUrl = z.string().max(2048).refine((v) => {
  try {
    const u = new URL(v);
    if (u.username || u.password) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && isLocalHost(u.hostname));
  } catch {
    return false;
  }
}, 'must be an https URL (http only for localhost)');
// Deliberately simple: one address, no display name, no whitespace or control characters.
const emailAddress = z.string().max(254).regex(/^[^\s@<>(),;:"\\[\]\x00-\x1f\x7f]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$|^[^\s@<>(),;:"\\[\]\x00-\x1f\x7f]+@localhost$/, 'must be an email address');

// Every value is checked at startup. Anything missing or malformed stops the service (fail closed).
const ConfigFields = z.object({
  KAFKA_BROKER: z.string().min(1), // comma-separated host:port list
  KAFKA_CLIENT_ID: z.string().min(1).default('insighthub-processor'),
  ERROR_EVENTS_TOPIC: z.string().min(1).default('error-events'),
  ERROR_EVENTS_GROUP: z.string().min(1).default('error-processors'),
  LEGACY_LOGS: onOff.default('on'),

  DB_HOST: z.string().min(1),
  DB_PORT: int(5432, 1, 65535),
  DB_NAME: z.string().min(1).default('insighthub'),
  DB_USER: z.string().min(1).default('postgres'),
  // No default: the service refuses to start without a real password.
  DB_PASSWORD: z.string().min(1),
  DB_SSL: z.enum(['off', 'require']).default('off'),
  DB_POOL_MAX: int(10, 1, 100),

  PROCESSOR_CONCURRENCY: int(3, 1, 32), // partitions processed in parallel
  MAX_MESSAGE_BYTES: int(65536, 1024, 1048576),

  ALERT_SPIKE_MIN_COUNT: int(10, 1, 1000000),
  ALERT_SPIKE_MULTIPLIER: num(5, 1, 1000),
  ALERT_SPIKE_WINDOW_MINUTES: int(5, 1, 1440),
  ALERT_SPIKE_BASELINE_HOURS: int(24, 1, 720),
  ALERT_SPIKE_COOLDOWN_MINUTES: int(60, 1, 10080),

  // Internal health/metrics endpoint: no auth, so it binds to loopback unless an operator opts in.
  HEALTH_PORT: int(9100, 1, 65535),
  HEALTH_HOST: z.string().min(1).default('127.0.0.1'),

  ML_SHADOW: onOff.default('off'),
  ML_ENGINE_URL: z.string().url().refine((u) => /^https?:\/\//.test(u), 'must be http(s)').optional(),

  // Dead-letter topic: metadata about messages that were skipped, never their content.
  DLQ: onOff.default('on'),
  DLQ_TOPIC: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).default('error-events-dlq'),

  // Alert notifications. Every channel is off unless configured.
  NOTIFY_WEBHOOK_URL: safeUrl.optional(), // a secret: never logged
  NOTIFY_MAX_PER_HOUR: int(20, 1, 1000), // per channel
  DASHBOARD_URL: safeUrl.optional(),
  SMTP_HOST: z.string().min(1).max(255).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(), // default 587 applied below
  SMTP_USER: z.string().min(1).max(255).optional(),
  SMTP_PASSWORD: z.string().min(1).max(1024).optional(),
  SMTP_SECURE: onOff.optional(), // on = TLS from the start; off = STARTTLS required
  NOTIFY_EMAIL_FROM: emailAddress.optional(),
  NOTIFY_EMAIL_TO: z.string().max(2600).optional(), // comma-separated, max 10
});
const SMTP_KEYS = ['SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SECURE', 'NOTIFY_EMAIL_FROM', 'NOTIFY_EMAIL_TO'];
const ConfigSchema = ConfigFields.superRefine((c, ctx) => {
  const bad = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (c.ML_SHADOW === 'on' && !c.ML_ENGINE_URL) bad('ML_ENGINE_URL', 'ML_ENGINE_URL is required when ML_SHADOW=on');
  // Half-configured email would silently drop alerts, so it stops startup instead.
  if (!c.SMTP_HOST) {
    for (const k of SMTP_KEYS) if (c[k] !== undefined) bad(k, `${k} is set but SMTP_HOST is not`);
    return;
  }
  if (!c.NOTIFY_EMAIL_FROM) bad('NOTIFY_EMAIL_FROM', 'required when SMTP_HOST is set');
  if (!c.NOTIFY_EMAIL_TO) bad('NOTIFY_EMAIL_TO', 'required when SMTP_HOST is set');
  if ((c.SMTP_USER === undefined) !== (c.SMTP_PASSWORD === undefined)) {
    bad('SMTP_PASSWORD', 'SMTP_USER and SMTP_PASSWORD must be set together');
  }
});

// Splits and validates the recipient list. Names the problem, never echoes an address.
function parseRecipients(text) {
  const list = text.split(',').map((a) => a.trim()).filter(Boolean);
  if (list.length === 0 || list.length > 10) throw new Error('Invalid configuration: NOTIFY_EMAIL_TO: needs 1 to 10 addresses');
  for (const a of list) {
    if (!emailAddress.safeParse(a).success) throw new Error('Invalid configuration: NOTIFY_EMAIL_TO: contains an invalid address');
  }
  return list;
}

function loadConfig(env = process.env) {
  // Treat empty strings as "not set" so `FOO=` in a .env file doesn't count as a value.
  const cleaned = {};
  for (const key of Object.keys(ConfigFields.shape)) {
    if (env[key] !== undefined && env[key] !== '') cleaned[key] = env[key];
  }
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Names only, never values (DB_PASSWORD lives here).
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  const c = parsed.data;
  const recipients = c.SMTP_HOST ? parseRecipients(c.NOTIFY_EMAIL_TO) : [];
  return {
    kafka: {
      brokers: c.KAFKA_BROKER.split(',').map((b) => b.trim()).filter(Boolean),
      clientId: c.KAFKA_CLIENT_ID,
      errorTopic: c.ERROR_EVENTS_TOPIC,
      errorGroup: c.ERROR_EVENTS_GROUP,
      legacyLogs: c.LEGACY_LOGS === 'on',
      concurrency: c.PROCESSOR_CONCURRENCY,
      maxMessageBytes: c.MAX_MESSAGE_BYTES,
    },
    db: {
      host: c.DB_HOST,
      port: c.DB_PORT,
      database: c.DB_NAME,
      user: c.DB_USER,
      password: c.DB_PASSWORD,
      ssl: c.DB_SSL === 'require' ? { rejectUnauthorized: true } : false,
      max: c.DB_POOL_MAX,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    },
    rules: {
      spikeMinCount: c.ALERT_SPIKE_MIN_COUNT,
      spikeMultiplier: c.ALERT_SPIKE_MULTIPLIER,
      spikeWindowMinutes: c.ALERT_SPIKE_WINDOW_MINUTES,
      spikeBaselineHours: c.ALERT_SPIKE_BASELINE_HOURS,
      spikeCooldownMinutes: c.ALERT_SPIKE_COOLDOWN_MINUTES,
    },
    health: { host: c.HEALTH_HOST, port: c.HEALTH_PORT },
    ml: {
      enabled: c.ML_SHADOW === 'on',
      url: c.ML_ENGINE_URL,
      timeoutMs: 500,
      modelVersion: 'synthetic-v0',
    },
    dlq: { enabled: c.DLQ === 'on', topic: c.DLQ_TOPIC, timeoutMs: 5000 },
    notify: {
      webhookUrl: c.NOTIFY_WEBHOOK_URL || null,
      email: c.SMTP_HOST
        ? {
          host: c.SMTP_HOST,
          port: c.SMTP_PORT ?? 587,
          secure: c.SMTP_SECURE === 'on',
          local: isLocalHost(c.SMTP_HOST),
          user: c.SMTP_USER,
          password: c.SMTP_PASSWORD,
          from: c.NOTIFY_EMAIL_FROM,
          to: recipients,
        }
        : null,
      dashboardUrl: c.DASHBOARD_URL ? c.DASHBOARD_URL.replace(/\/+$/, '') : null,
      maxPerHour: c.NOTIFY_MAX_PER_HOUR,
      timeoutMs: 5000,
    },
  };
}

module.exports = { loadConfig };
