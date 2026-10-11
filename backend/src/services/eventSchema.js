const { z } = require('zod');

// Contract §1 "The Event (v1)". Strict: unknown fields are rejected everywhere.

const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// Postgres text columns can't hold NUL, and it has no place in an error report.
const text = (min, max) =>
  z.string().min(min).max(max).refine((s) => !s.includes('\u0000'), 'must not contain NUL characters');

function eventSchema(now) {
  return z.strictObject({
    event_id: z.string().regex(UUID_V4, 'must be a UUID v4').transform((s) => s.toLowerCase()),
    occurred_at: z
      .string()
      .max(40)
      .regex(ISO_WITH_TZ, 'must be ISO 8601 with a timezone')
      .transform((s, ctx) => {
        const ms = Date.parse(s);
        if (Number.isNaN(ms)) {
          ctx.addIssue({ code: 'custom', message: 'is not a valid date' });
          return z.NEVER;
        }
        if (ms > now + MAX_FUTURE_MS) {
          ctx.addIssue({ code: 'custom', message: 'is more than 5 minutes in the future' });
          return z.NEVER;
        }
        if (ms < now - MAX_AGE_MS) {
          ctx.addIssue({ code: 'custom', message: 'is more than 7 days old' });
          return z.NEVER;
        }
        return new Date(ms).toISOString();
      }),
    source: z.enum(['browser', 'server']),
    environment: z.enum(['production', 'preview', 'development']),
    level: z.enum(['fatal', 'error', 'warning']),
    error_type: text(1, 128),
    message: text(1, 1000),
    stack: text(0, 16000).optional(),
    release: z.string().max(64).regex(/^[A-Za-z0-9._-]*$/, 'may only contain A-Z a-z 0-9 . _ -').optional(),
    url_path: text(1, 512)
      .refine((s) => s.startsWith('/'), 'must start with /')
      .refine((s) => !s.includes('?') && !s.includes('#'), 'must not contain ? or #')
      .optional(),
    http: z
      .strictObject({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']).optional(),
        status: z.number().int().min(100).max(599).optional(),
        route: text(0, 256).optional(),
      })
      .optional(),
    runtime: text(0, 64).optional(),
    tags: z
      .record(z.string().regex(/^[a-z0-9_.-]{1,32}$/, 'tag keys must match [a-z0-9_.-]{1,32}'), text(0, 128))
      .refine((t) => Object.keys(t).length <= 10, 'at most 10 tags')
      .optional(),
  }).refine((e) => !(e.http && e.source !== 'server'), { message: 'http is only allowed for server events', path: ['http'] });
}

function batchSchema(now) {
  return z.strictObject({
    events: z.array(eventSchema(now)).min(1, 'must contain 1-20 events').max(20, 'must contain 1-20 events'),
  });
}

// Short, safe message: the path and rule of the first problem, never the offending value.
function describeIssue(error) {
  const issue = error.issues[0];
  const path = issue.path.length ? issue.path.join('.') : 'body';
  if (issue.code === 'unrecognized_keys') return `${path}: unknown field(s) ${issue.keys.slice(0, 5).join(', ').slice(0, 200)}`;
  return `${path}: ${issue.message}`.slice(0, 300);
}

module.exports = { batchSchema, describeIssue };
