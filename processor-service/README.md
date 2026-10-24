# InsightHub Processor Service

Kafka consumer that turns error reports into issues, events and alerts (see `docs/CONTRACT.md` §2–§3).

It runs two consumers in one process:

| Topic | Group | What it does |
| --- | --- | --- |
| `error-events` | `error-processors` | Validates each message (strict), groups it into an issue by fingerprint, stores the event, raises alerts |
| `logs` (legacy) | `log-processors` | The old log pipeline, unchanged in behaviour. Turn off with `LEGACY_LOGS=off` |

## Run locally

```bash
cp .env.example .env   # fill in DB_PASSWORD; never commit .env
npm ci
npm start
```

Config is checked at startup. Missing or invalid values (e.g. no `DB_PASSWORD`) stop the service.
All settings and their defaults are in `.env.example`.

**Kafka client (native).** `@confluentinc/kafka-javascript` ships prebuilt binaries for Node 18–24 only
(Docker uses `node:24-alpine`, which is covered). On a newer Node it compiles librdkafka from source,
and that build **fails if the project path contains spaces**. Use Node 24 locally, or build it once in
a path without spaces and copy `build/Release/confluent-kafka-javascript.node` into
`node_modules/@confluentinc/kafka-javascript/build/Release/`.

## Tests

```bash
npm test
```

Runs against the `insighthub_test_processor` database (tables are wiped). No Kafka needed: tests call
the processing function directly.

## Health and metrics

A small internal HTTP endpoint (Node's built-in `http`, no extra dependencies):

- `GET /health` returns 200 `{"status":"ok","db":"up","kafka":"up","consumer":"up"}`, or 503 with
  `"degraded"` and the failing part marked `"down"`. Each check has a 2 s timeout and is cached for 5 s.
  `consumer` is up when the error consumer holds at least one partition (and always for the first 60 s
  after start, while it joins the group). This assumes no more processor instances than partitions: an
  idle extra instance would report down.
- `GET /metrics` returns counts since start: `stored`, `duplicate`, `invalid`, `failed`, `retries`,
  `alerts_raised`, `dlq_sent`, plus `started_at`, `last_event_at` and `uptime_s`. No message content, ids or errors.
- Anything else gets 404/405. Request bodies are never read.

It has **no auth**. It listens on `HEALTH_HOST=127.0.0.1`, port `HEALTH_PORT=9100`, so it is not reachable
from outside the container. Never publish it to the internet. The Dockerfile `HEALTHCHECK` uses it.

## Code map

| File | Job |
| --- | --- |
| `src/index.js` | Startup, shutdown (SIGTERM/SIGINT) |
| `src/health.js` | `/health` and `/metrics` server, counters |
| `src/config.js` | Env config, validated (fail closed) |
| `src/kafka.js` | `error-events` consumer, dead-letters skipped messages, manual offset commits after the DB commit |
| `src/schema.js` | Strict envelope + Event schema |
| `src/fingerprint.js` | Fingerprint, title, culprit |
| `src/processor.js` | One message → one transaction, retries transient DB errors |
| `src/store.js` | Issue upsert, idempotent event insert, counters |
| `src/rules.js` | `new_issue`, `regression`, `spike` (+ cooldown); `ignored` issues stay silent |
| `src/notify.js` | Webhook and email alert notifications, rate limited, fire-and-forget |
| `src/dlq.js` | Dead-letter topic producer (metadata only) |
| `src/pipeline.js` | Counts results and triggers notifications after a stored result |
| `src/mlShadow.js` | Optional ML score (`ML_SHADOW=on`), 500 ms timeout, never used by rules |
| `src/legacyLogs.js` | Legacy `logs` pipeline |

## How a message is handled

1. Too big, not JSON, or not matching the schema → logged (reason only, never content) and skipped.
2. Fingerprint computed; ML score fetched if shadow mode is on (failures → nulls).
3. One transaction: upsert issue → insert event (`ON CONFLICT DO NOTHING`; duplicates stop here)
   → count it → apply alert rules → commit.
4. Kafka offset committed. Transient DB errors are retried with backoff (the partition waits, nothing
   is lost). Permanent errors (e.g. unknown project) are logged and skipped.
5. Invalid or permanently failed messages first get a record in the dead-letter topic (below).
6. After step 3 committed, alerts are sent to the configured channels (below).

## Dead-letter topic

`error-events-dlq` (`DLQ_TOPIC`, switch off with `DLQ=off`). Invalid messages may not have passed the
backend's scrubber, so the record holds **metadata only**, never the original value or key:

```json
{ "schema": 1, "reason": "not JSON", "source_partition": 0, "source_offset": "41",
  "key_present": true, "value_bytes": 1234, "failed_at": "2026-10-24T09:30:00.000Z" }
```

Use the partition and offset to find the message in `error-events` while it is still retained. Sending is
best effort with a 5 s timeout: if it fails, `dlq_failed` is logged and the offset is committed anyway
(a broken DLQ never blocks a partition). `/metrics` counts `dlq_sent`. The topic must exist or the broker
must auto-create it.

## Alert notifications

Each channel is off unless configured. A half-configured channel (e.g. `SMTP_HOST` without
`NOTIFY_EMAIL_TO`) stops startup. See `.env.example` for all variables.

- **Webhook** (`NOTIFY_WEBHOOK_URL`): `POST {"text": "..."}`, works with Slack, Discord (Slack-compatible
  URL) and Teams incoming webhooks. https only (http for localhost). Redirects are refused. The URL is a
  secret and is never logged.
- **Email** (`SMTP_*`, `NOTIFY_EMAIL_FROM`, `NOTIFY_EMAIL_TO`) via nodemailer. STARTTLS is required unless
  `SMTP_SECURE=on` (TLS from the start) or the host is localhost.
- Message: alert kind (New issue / Spike / Regression), project id, issue title (cut to 200 chars,
  control characters removed), spike numbers, and `DASHBOARD_URL/issues/<id>` if `DASHBOARD_URL` is set.
  Nothing else from the event.
- Sent after the database commit, never awaited by the Kafka loop, 5 s timeout per send. A failure only
  logs `notify_failed` with the channel and a short code.
- At most `NOTIFY_MAX_PER_HOUR` (default 20) per channel per rolling hour. Extra alerts are dropped
  (`notify_suppressed`); the next message sent says how many were not sent.
