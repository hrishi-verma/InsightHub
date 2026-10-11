# processor report

## What I built

`processor-service/` now runs two Kafka consumers in one process:

- **`error-events`** (group `error-processors`, new): validates each message strictly, fingerprints it,
  stores it in one transaction (issue upsert → idempotent event insert → counters → alert rules) and
  then commits the Kafka offset.
- **`logs`** (group `log-processors`, legacy): same behaviour as before. It can be turned off with
  `LEGACY_LOGS=off`.

| File | Job |
| --- | --- |
| `src/index.js` | Startup (DB check, consumers) and graceful SIGTERM/SIGINT shutdown (30 s cap) |
| `src/config.js` | zod-validated env config. Fails closed and has no secret defaults. Errors name keys, never values |
| `src/kafka.js` | Consumer with `autoCommit: false`. Commits per message after processing. `partitionsConsumedConcurrently` is bounded (default 3) |
| `src/schema.js` | Strict §2 envelope + Event schema. Size check before parsing. Never throws |
| `src/fingerprint.js` | §3 fingerprint, title and culprit (V8 + Firefox/Safari frames, build-hash removal) |
| `src/processor.js` | One message → one transaction. Retries transient DB errors with backoff; permanent errors are logged and skipped |
| `src/store.js` | The three §3 storage steps (parameterised SQL) |
| `src/rules.js` | `new_issue`, `regression` (flips status back), `spike` (+ cooldown). `ignored` issues are silent |
| `src/mlShadow.js` | `ML_SHADOW=on` only. `AbortSignal.timeout(500)`; stores `ml_score` + `synthetic-v0`, or nulls on any failure |
| `src/legacyLogs.js` | Legacy pipeline, moved out of `index.js` |
| `.env.example`, `README.md`, `Dockerfile`, `.dockerignore` | Config docs, service docs, image |

**Run:** `cd processor-service && cp .env.example .env` (fill in `DB_PASSWORD`), then `npm ci && npm start`.
**Test:** `npm test`.

## How I tested it

**`npm test`: 71 tests pass** (vitest, against `insighthub_test_processor`, run 5× in a row with no flakes).
- **Fingerprint:** different numbers, UUIDs, hex IDs, quoted text and line numbers group together. Hashed bundle
  names (`index-a1b2c3d4.js`, `index-BXk3a_9Z.js`, `main.3f2a1b9c.chunk.js`, Next.js chunks) are
  normalised; `user.controller.js` is left alone. Different error types, frames, sources and projects
  stay separate. Hostile 15 000-char stack lines parse in well under 500 ms.
- **Schema (31 rejection cases, none throw):** not JSON, null, oversized, extra event/envelope/http
  fields, wrong schema version, non-v4 UUID, timestamp without timezone, too old or in the future,
  bad enums, length limits, NUL bytes, `?`/`#` in `url_path`, `http` on a browser event, bad tags,
  a `__proto__` tag, `null` optional fields, string `project_id`, and a key that doesn't match
  `project_id`. Also checked: the log reason never contains message content.
- **Config:** contract defaults; refuses to start without `DB_PASSWORD`/`DB_HOST`/`KAFKA_BROKER`
  (unset or empty); rejects bad values and `file://` ML URLs; never echoes the password.
- **Storage:** every field is stored; similar events share an issue; a duplicate `event_id` is stored
  and counted once, including 3 concurrent copies plus 8 other events (count = 9, one `new_issue`);
  out-of-order events keep `last_seen`/`last_release` from the newest; an unknown project is skipped
  (FK `23503`) and the next message is still processed; a failure part-way through rolls back
  everything.
- **Rules:**
  - `new_issue` fires once.
  - `regression` fires and flips the issue back to `unresolved` with `resolved_at` NULL.
  - `ignored`: 12 events are stored and counted, with no alerts at all.
  - `spike`: nothing at 9 events, fires at 10. Silent for further events within the hour, fires again after the cooldown.
  - With a busy baseline (864 events in 24 h) the threshold rises to `max(3, 2 × 3) = 6`.
  - A replayed backlog of old events raises no spike.
  - Thresholds come from env.
- **ML shadow:** a success stores score + version; a timeout (fake fetch that only ends on abort)
  and a slow real HTTP server (3 s) both give nulls within 500 ms and processing continues.
  500s, non-JSON, a non-numeric score, an out-of-range score and connection refused also give nulls.
  Alerts are identical with score 0 and score 1.
- **Reliability:** transient errors (`ECONNREFUSED`) are retried, then the event is stored. A shutdown during
  retries throws `ShutdownError`, so the offset is not committed. Permanent errors aren't retried.

**End to end** (shared Kafka `localhost:9093` + Postgres `insighthub`): I started `npm start`, then
hand-produced 4 messages to `error-events`: one valid event, the same event again, `"not json at all"`,
and an event with an `email` field. Results:
- Issue 1 was created ("E2ETestError: Hand-produced e2e test 42", culprit `e2e (/app/e2e.js)`,
  event_count 1, one `new_issue` alert).
- The duplicate was detected.
- Both bad messages were skipped with content-free reasons.

I then restarted against the test DB:
- The earlier messages were **not** reprocessed (offsets committed).
- A legacy `logs` message was stored and a garbage one was skipped.
- `SIGTERM` gave exit code 0.

The Docker image builds, runs as `node`, contains no dev dependencies, and exits 1 with
`config_error` when config is missing.

## Security review

Checked in my own diff:
- **Injection:** all SQL is parameterised; there is no string-built SQL.
- **Untrusted input:** every Kafka message is size-checked before `JSON.parse`, then validated
  strictly. Unknown fields, NUL bytes and prototype-ish tag keys are rejected. The `occurred_at`
  window is checked against `received_at`, so a Kafka backlog after an outage is still accepted.
- **ReDoS:** stack lines are cut to 1024 chars before regex matching (tested with hostile input).
- **Bounded work:** spike queries are index-only range scans on `(issue_id, occurred_at)` (checked
  with EXPLAIN, including chunk exclusion), and every count has a `LIMIT`. Concurrency, the pool
  size and per-statement timeouts (10 s) are bounded.
- **Logs:** never message content. Logs carry event_id (validated UUID), project_id, pg SQLSTATE
  codes and error names only. pg `detail` and zod messages can echo values, so they are not logged.
  `DB_PASSWORD` never appears in errors.
- **Fail closed:** no defaults for secrets, and invalid config stops startup. ML failures can't affect
  storage: the call happens before the transaction, the score is range-checked so it can't overflow
  `REAL`, and redirects are refused.
- **Image:** non-root, production dependencies only, and `.env` is excluded via `.dockerignore`.
- **Dependency audit:** `npm audit` reports 0 vulnerabilities.

Things I'm unsure about or can't fix from my lane:
- **kafkajs is effectively unmaintained** (last release 2.2.4, February 2023). It was already a dependency.
  On Node 24 it prints a harmless `TimeoutNegativeWarning`. CLAUDE.md asks for maintained
  dependencies, so this deserves a decision (see requests).
- **The Kafka connection has no TLS or SASL.** Anyone who can produce to `error-events` can inject
  events (they're still validated). Kafka must stay on a private network until auth is added.
- **`DB_SSL=require`** verifies against system CAs only. There's no option for a custom CA yet.
- **Unescaped content in issue titles.** `title`/`culprit`/`message` are stored as sent (after
  backend scrubbing), so the dashboard must escape them.
- **The legacy `logs` pipeline still accepts unvalidated payloads** (parameterised, but any size or
  shape within Kafka's limit). I left it alone per rule 4. It only got a real fetch timeout and
  content-free error logging.
- **`xmax = 0` to detect a fresh insert.** This is a widely used Postgres idiom but relies on internals.

## Deviations from the contract / brief

None that change behaviour the contract defines. These are interpretations or small additions the
lead should confirm:
1. **Normalisation order** is UUIDs → quoted text → hex → numbers. Otherwise numbers would break
   up UUIDs and hex. A "hex run" must contain a digit, so plain words aren't replaced. A build
   hash must contain a digit or mixed case, so names like `user.controller.js` survive.
2. **`first_seen = LEAST(first_seen, occurred_at)`** is also applied in step 3, so an earlier event
   that arrives late corrects it. `last_release` only updates from an event at least as new as
   `last_seen`.
3. **The Kafka key must equal `project_id`** when present; otherwise the message is skipped.
4. **The spike window ends at `GREATEST(occurred_at, now())`.** This is "the last 5 minutes"
   while tolerating sender clocks running ahead. The baseline is the 24 h before that window.

## New dependencies

| Name | Version | Why |
| --- | --- | --- |
| `zod` | ^3.25.76 | Strict schema validation for config and messages |
| `vitest` (dev) | ^5.0.3 | Required test runner. v3 had audit findings (tinypool/@vitest/mocker), so I used the current major |

kafkajs, pg and dotenv were already there; I just updated pins within their majors.

## Requests for the lead

1. **docker-compose.yml:** the processor service gets `KAFKA_BROKER`, `DB_HOST`, `DB_PASSWORD` and
   `ML_ENGINE_URL`, which is enough to start. Optionally add `ML_SHADOW` and the `ALERT_*` vars, and
   drop `depends_on: ml-engine` (the new pipeline doesn't need it).
2. **kafkajs:** decide whether to replace it with a maintained client, e.g.
   `@confluentinc/kafka-javascript`, which has a KafkaJS-compatible API.
3. **Contract §3, regression:** an event that occurred *before* `resolved_at` but arrives late
   currently counts as a regression (built as written). Consider "only if `occurred_at > resolved_at`".
4. **Contract §2:** confirm that rejecting a message whose key ≠ `project_id` is wanted (deviation 3).
5. **Test data:** the shared `insighthub` DB now contains one test issue, `E2ETestError: Hand-produced
   e2e test 42` (environment `development`), from the end-to-end run. I left it as evidence; delete it if you like.

## Known gaps / next steps

- **No dead-letter topic.** Invalid and permanently failing messages are logged and dropped.
- **While the DB is down, a partition waits** (retrying with backoff up to 30 s) instead of
  skipping. That's intentional (no data loss), but there's no alerting on it beyond the logs.
- **The spike baseline is recounted per event** (capped by `LIMIT`). For very hot issues, a
  continuous aggregate or a short in-memory cache would be cheaper.
- **No metrics or health endpoint** (processed/invalid/retry counts) yet.
- **Kafka TLS/SASL and a custom DB CA** are not yet configurable.
