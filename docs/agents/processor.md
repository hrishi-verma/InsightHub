# Brief: `processor` agent

**Goal:** consume `error-events` from Kafka and turn them into issues, events and alerts
(contract §2–§3), reliably and safely.

**You may change:** `processor-service/**`, `docs/agents/reports/processor.md`. Nothing else.
**Don't touch `ml-engine/`.** The owner is improving it themselves.

## Build

1. **Keep the legacy `logs` consumer working,** but run the new `error-events` consumer
   alongside it (a separate consumer group, e.g. `error-processors`). Split the code into modules
   (config, kafka, schema, fingerprint, store, rules, ml-shadow). Remove the `password` defaults.
   Config is validated at startup (fail closed) and documented in `processor-service/.env.example`.
2. **Validate every message** against the contract §2 envelope + Event schema (strict). Invalid
   → log a short reason (never the message content) and skip. A poison message must never stop
   or crash-loop the consumer.
3. **Fingerprint and store** exactly per contract §3 ("Fingerprint", "Storing an event"), all
   in one DB transaction per event, idempotent on `(event_id, occurred_at)`. Use parameterised SQL only.
4. **Alert rules** `new_issue`, `regression`, `spike` (with the cooldown), and `ignored` issues
   raise nothing. Thresholds come from env with the contract defaults. Make spike detection
   efficient (indexed queries, not full scans).
5. **ML shadow** (only if `ML_SHADOW=on`): 500 ms timeout via `AbortSignal.timeout`, store
   `ml_score` + `ml_model_version="synthetic-v0"`. On any failure, store nulls and carry on.
   Never use it in rules.
6. **Reliability:** commit Kafka offsets only after the DB transaction succeeds; retry transient
   DB errors with backoff; graceful shutdown on SIGTERM/SIGINT; bounded concurrency.
7. **Dockerfile:** non-root user, `npm ci --omit=dev`.

## Tests (required)

`vitest` against `insighthub_test_processor`, calling the processing function directly (no real Kafka needed):
- fingerprint: the same error with different numbers, IDs or line numbers groups together;
  different error types or frames don't; build-hashed file names are normalised
- duplicate `event_id` → stored once and counted once
- `new_issue` on first event; `regression` when resolved, and the status flips back; `spike`
  fires at the threshold and respects the 1 h cooldown; `ignored` → no alerts
- invalid / oversized / extra-field messages are skipped without throwing
- ML shadow: timeout or error → nulls stored, processing continues; alerts unaffected by the score

## Done when
`npm test` passes, the consumer runs against the shared Kafka + Postgres and processes a
hand-produced message end to end, and `docs/agents/reports/processor.md` is written and committed.
