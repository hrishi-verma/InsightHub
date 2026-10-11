const { z } = require('zod');

// Validates env at startup. Anything missing or unsafe throws, so the process refuses to start.

const nonEmpty = z.string().trim().min(1);

function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Exact origins only: no paths, queries, credentials or trailing slashes.
  if (url.origin !== value) return null;
  return url;
}

function parseTrustProxy(raw) {
  const value = (raw ?? 'false').trim();
  if (value === 'false' || value === '0') return false;
  // 'true' would trust any X-Forwarded-For and let clients pick their own IP for rate limiting.
  if (value === 'true') throw new Error('TRUST_PROXY=true is not allowed; use a hop count or proxy addresses');
  if (/^[1-9]$/.test(value)) return Number(value);
  const parts = value.split(',').map((p) => p.trim());
  const ok = parts.every((p) => /^(loopback|linklocal|uniquelocal|[0-9a-fA-F.:]+(\/\d{1,3})?)$/.test(p));
  if (!ok) throw new Error('TRUST_PROXY must be false, a hop count 1-9, or a list of proxy addresses');
  return parts;
}

function parseDashboardOrigins(raw, nodeEnv) {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new Error('DASHBOARD_ORIGINS is required');
  for (const origin of list) {
    if (origin.includes('*')) throw new Error('DASHBOARD_ORIGINS must not contain wildcards');
    const url = parseOrigin(origin);
    if (!url) throw new Error(`DASHBOARD_ORIGINS has an invalid origin: ${origin}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`DASHBOARD_ORIGINS has an invalid origin: ${origin}`);
    }
    if (nodeEnv === 'production' && url.protocol !== 'https:') {
      throw new Error('DASHBOARD_ORIGINS must use https in production');
    }
  }
  return list;
}

function parseDb(env) {
  const common = {
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    query_timeout: 6000,
    // Hour buckets and ::text cursors are computed in UTC regardless of server settings.
    options: '-c TimeZone=UTC',
  };
  if (env.DATABASE_URL) {
    const url = nonEmpty.parse(env.DATABASE_URL);
    if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('DATABASE_URL must be a postgres:// URL');
    return { connectionString: url, ...common };
  }
  const db = z
    .object({
      DB_HOST: nonEmpty,
      DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
      DB_NAME: nonEmpty,
      DB_USER: nonEmpty,
      DB_PASSWORD: nonEmpty,
    })
    .parse(env);
  return {
    host: db.DB_HOST,
    port: db.DB_PORT,
    database: db.DB_NAME,
    user: db.DB_USER,
    password: db.DB_PASSWORD,
    ...common,
  };
}

function loadDbConfig(env = process.env) {
  try {
    return parseDb(env);
  } catch (err) {
    throw configError(err);
  }
}

function configError(err) {
  // Zod messages name the field and the rule, never the value.
  const detail = err instanceof z.ZodError
    ? err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ')
    : err.message;
  return new Error(`Invalid configuration: ${detail}`);
}

function loadConfig(env = process.env) {
  try {
    const base = z
      .object({
        NODE_ENV: z.enum(['production', 'development', 'test']),
        PORT: z.coerce.number().int().min(1).max(65535).default(8000),
        KAFKA_BROKER: nonEmpty.regex(/^[A-Za-z0-9.-]+:\d{1,5}(,[A-Za-z0-9.-]+:\d{1,5})*$/, 'must be host:port[,host:port]'),
        SERVICE_TOKEN: z.string().min(32, 'must be at least 32 characters when set').optional(),
        KAFKA_LEGACY_TOPIC: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).default('logs'),
      })
      .parse({
        ...env,
        SERVICE_TOKEN: env.SERVICE_TOKEN === '' ? undefined : env.SERVICE_TOKEN,
        KAFKA_LEGACY_TOPIC: env.KAFKA_TOPIC || undefined,
      });

    return Object.freeze({
      nodeEnv: base.NODE_ENV,
      isProduction: base.NODE_ENV === 'production',
      port: base.PORT,
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
      dashboardOrigins: Object.freeze(parseDashboardOrigins(env.DASHBOARD_ORIGINS, base.NODE_ENV)),
      kafka: Object.freeze({
        brokers: base.KAFKA_BROKER.split(','),
        eventsTopic: 'error-events',
        legacyTopic: base.KAFKA_LEGACY_TOPIC,
      }),
      serviceToken: base.SERVICE_TOKEN ?? null,
      db: Object.freeze(parseDb(env)),
    });
  } catch (err) {
    throw configError(err);
  }
}

module.exports = { loadConfig, loadDbConfig, parseOrigin };
