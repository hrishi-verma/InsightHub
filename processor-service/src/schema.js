const { z } = require('zod');

// Kafka message + Event v1, contract §1 and §2. Strict: unknown fields are rejected.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAG_KEY = /^[a-z0-9_.-]{1,32}$/;
// Keys that would touch an object's prototype if copied naively.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Postgres text columns can't hold NUL, so reject it here instead of failing in the DB.
const str = (min, max) => z.string().min(min).max(max).refine((s) => !s.includes('\u0000'), 'contains NUL');
const isoWithTz = () => z.string().datetime({ offset: true });

const tags = z.unknown().superRefine((value, ctx) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be an object' });
    return;
  }
  const entries = Object.entries(value);
  if (entries.length > 10) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'too many tags' });
  for (const [k, v] of entries) {
    if (!TAG_KEY.test(k) || FORBIDDEN_KEYS.has(k)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bad tag key' });
    } else if (typeof v !== 'string' || v.length > 128 || v.includes('\u0000')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bad tag value' });
    }
  }
}).transform((value) => Object.fromEntries(Object.entries(value)));

const Event = z.object({
  event_id: z.string().regex(UUID_V4),
  occurred_at: isoWithTz(),
  source: z.enum(['browser', 'server']),
  environment: z.enum(['production', 'preview', 'development']),
  level: z.enum(['fatal', 'error', 'warning']),
  error_type: str(1, 128),
  message: str(1, 1000),
  stack: str(0, 16000).optional(),
  release: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
  url_path: z.string().max(512).regex(/^\/[^?#\u0000]*$/).optional(),
  http: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']).optional(),
    status: z.number().int().min(100).max(599).optional(),
    route: str(0, 256).optional(),
  }).strict().optional(),
  runtime: str(0, 64).optional(),
  tags: tags.optional(),
}).strict();

const Envelope = z.object({
  schema: z.literal(1),
  project_id: z.number().int().min(1).max(2147483647),
  received_at: isoWithTz(),
  event: Event,
}).strict().superRefine((msg, ctx) => {
  const received = Date.parse(msg.received_at);
  const occurred = Date.parse(msg.event.occurred_at);
  // The time window is checked against received_at (not "now") so a backlog that waited in
  // Kafka during an outage is still accepted.
  if (received > Date.now() + 5 * MINUTE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['received_at'], message: 'in the future' });
  }
  if (occurred > received + 5 * MINUTE || occurred < received - 7 * DAY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['event', 'occurred_at'], message: 'out of range' });
  }
  if (msg.event.http && msg.event.source !== 'server') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['event', 'http'], message: 'server only' });
  }
});

/**
 * Parses a raw Kafka message. Never throws.
 * Returns { ok: true, message } or { ok: false, reason } where reason never contains message content.
 */
function parseMessage({ key, value }, { maxBytes }) {
  if (value == null) return { ok: false, reason: 'empty value' };
  const size = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
  if (size > maxBytes) return { ok: false, reason: `too large (${size} bytes)` };

  let json;
  try {
    json = JSON.parse(value.toString('utf8'));
  } catch {
    return { ok: false, reason: 'not JSON' };
  }

  const parsed = Envelope.safeParse(json);
  if (!parsed.success) {
    // Paths and issue codes only. Zod messages can echo received values, so they're not logged.
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}:${i.code}`);
    return { ok: false, reason: `schema: ${issues.join(', ')}` };
  }

  // The key routes a project's events to one partition; a mismatch means a broken or forged producer.
  if (key != null && key.toString() !== String(parsed.data.project_id)) {
    return { ok: false, reason: 'key does not match project_id' };
  }
  return { ok: true, message: parsed.data };
}

module.exports = { parseMessage, Envelope };
