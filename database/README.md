# InsightHub database

Postgres 15 with TimescaleDB (`timescale/timescaledb:latest-pg15`). The full table reference
and the processing rules are in [`docs/CONTRACT.md`](../docs/CONTRACT.md) §3. This README
covers the files and how to operate the database.

This folder belongs to the lead. Agents don't change the schema (see `CLAUDE.md`).

## Files

| File | What it creates |
| --- | --- |
| `init.sql` | Legacy log tables: `logs` and `log_aggregates` (hypertables) |
| `migrations/001_error_tracking.sql` | Error tracking: `projects`, `api_keys`, `users`, `sessions`, `issues`, `error_events` (hypertable on `occurred_at`), `issue_alerts`. Seeds the `education-enlightened` project |

On a **fresh** database, docker compose runs both files once, in that order (they're mounted
into `/docker-entrypoint-initdb.d/`). They don't run again on an existing volume, so a new
migration on an existing database has to be applied by hand:

```bash
docker compose exec -T postgres psql -U postgres -d insighthub < database/migrations/00N_name.sql
```

Every migration uses `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`, so running one twice is safe.
New migrations get the next number and are added to the compose mounts.

## What's stored, and what isn't

- **Secrets are hashed.** `api_keys.key_hash` and `sessions.token_hash` are SHA-256.
  `users.password_hash` is bcrypt (cost 12 or more). Nobody can read a key or a session back
  out of the database.
- **No personal data in events.** The backend scrubs emails, credentials, tokens, IPs and
  query strings before events reach Kafka. Never add columns for request bodies, headers,
  cookies, IPs or user identifiers.
- `error_events.ml_score` is experimental and shadow-only. It never drives alerts (D4).

## Connecting

The password is `POSTGRES_PASSWORD` in the root `.env` (git-ignored). There's no default, and
compose refuses to start without it. Postgres listens on `127.0.0.1:5432` only.

```bash
psql -h localhost -U postgres -d insighthub      # prompts for the password
```

Local test databases (`insighthub_test_api`, `insighthub_test_processor`) exist alongside the main
one. Each service's test suite may wipe its own.

## Useful queries

```sql
-- Busiest open issues in the last 24 hours
SELECT i.id, i.title, count(*) AS events
FROM error_events e JOIN issues i ON i.id = e.issue_id
WHERE e.occurred_at > now() - interval '24 hours' AND i.status = 'unresolved'
GROUP BY i.id, i.title ORDER BY events DESC LIMIT 10;

-- Unacknowledged alerts
SELECT kind, issue_id, created_at FROM issue_alerts
WHERE acknowledged_at IS NULL ORDER BY created_at DESC;

-- Size of each hypertable
SELECT hypertable_name, pg_size_pretty(hypertable_size(format('%I', hypertable_name)::regclass))
FROM timescaledb_information.hypertables;
```

## Backups

Not set up yet. Nightly `pg_dump` arrives with the production deploy (roadmap Phase 6).
