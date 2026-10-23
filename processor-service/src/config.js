const { z } = require('zod');

const onOff = z.enum(['on', 'off']);
const int = (def, min, max) => z.coerce.number().int().min(min).max(max).default(def);
const num = (def, min, max) => z.coerce.number().min(min).max(max).default(def);

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

  ML_SHADOW: onOff.default('off'),
  ML_ENGINE_URL: z.string().url().refine((u) => /^https?:\/\//.test(u), 'must be http(s)').optional(),
});
const ConfigSchema = ConfigFields.refine((c) => c.ML_SHADOW === 'off' || !!c.ML_ENGINE_URL, {
  message: 'ML_ENGINE_URL is required when ML_SHADOW=on',
  path: ['ML_ENGINE_URL'],
});

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
    ml: {
      enabled: c.ML_SHADOW === 'on',
      url: c.ML_ENGINE_URL,
      timeoutMs: 500,
      modelVersion: 'synthetic-v0',
    },
  };
}

module.exports = { loadConfig };
