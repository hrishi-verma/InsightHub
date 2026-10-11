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

## Tests

```bash
npm test
```

Runs against the `insighthub_test_processor` database (tables are wiped). No Kafka needed: tests call
the processing function directly.

## Code map

| File | Job |
| --- | --- |
| `src/index.js` | Startup, shutdown (SIGTERM/SIGINT) |
| `src/config.js` | Env config, validated (fail closed) |
| `src/kafka.js` | `error-events` consumer, manual offset commits after the DB commit |
| `src/schema.js` | Strict envelope + Event schema |
| `src/fingerprint.js` | Fingerprint, title, culprit |
| `src/processor.js` | One message → one transaction, retries transient DB errors |
| `src/store.js` | Issue upsert, idempotent event insert, counters |
| `src/rules.js` | `new_issue`, `regression`, `spike` (+ cooldown); `ignored` issues stay silent |
| `src/mlShadow.js` | Optional ML score (`ML_SHADOW=on`), 500 ms timeout, never used by rules |
| `src/legacyLogs.js` | Legacy `logs` pipeline |

## How a message is handled

1. Too big, not JSON, or not matching the schema → logged (reason only, never content) and skipped.
2. Fingerprint computed; ML score fetched if shadow mode is on (failures → nulls).
3. One transaction: upsert issue → insert event (`ON CONFLICT DO NOTHING`; duplicates stop here)
   → count it → apply alert rules → commit.
4. Kafka offset committed. Transient DB errors are retried with backoff (the partition waits, nothing
   is lost). Permanent errors (e.g. unknown project) are logged and skipped.
