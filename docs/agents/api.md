# Brief: `api` agent

**Goal:** make `backend/` a production-grade API for error ingestion (contract §1), the dashboard
(contract §4), and the admin scripts (contract §5).

**You may change:** `backend/**`, `docs/agents/reports/api.md`. Nothing else.

## Build

1. **Structure.** Keep Express. Organise `backend/src` into config / middleware / routes /
   services / db, similar in spirit to what's there. Mount new routes under `/api/v1`. Keep the
   legacy `/api/logs` routes working, but take `SERVICE_TOKEN` from env with **no default** (if
   unset, legacy routes return 503). Remove the hardcoded `dev-token-123` and `password` fallbacks.
2. **Config.** Validate all env vars at startup (e.g. with `zod`) and refuse to start if invalid:
   `DATABASE_URL` (or the existing `DB_*` vars), `KAFKA_BROKER`, `DASHBOARD_ORIGINS` (comma list,
   no `*`, `https` only in production), `NODE_ENV`, `TRUST_PROXY`, `PORT`. Document them in
   `backend/.env.example`.
3. **Ingestion `POST /api/v1/events`** exactly per contract §1: two key kinds (hash lookup,
   constant-time compare, `last_used_at` updated at most once a minute), origin check for public
   keys, CORS rules, strict per-event validation, 64 KB limit, 1–20 events, scrubbing on arrival,
   rate limits per contract (an in-memory store is fine for now, behind an interface so Redis can
   replace it), then publish to Kafka `error-events` (contract §2) with an idempotent producer.
   If Kafka is down, return 503. Don't hang.
4. **Dashboard API** per contract §4: login, logout, me (bcrypt cost 12, session cookie, 12 h
   expiry, delete expired sessions), CSRF and Origin checks, login throttling with uniform
   timing, role check on `PATCH /issues/:id` and `POST /alerts/:id/ack`, cursor pagination,
   project scoping (404 on cross-project), all queries parameterised.
5. **Admin scripts** per contract §5: `create-user` (interactive hidden password prompt),
   `create-key` (prints once, stores hash only, origin rules), `revoke-key`.
6. **Hardening:** `helmet`, `x-powered-by` off, `Cache-Control: no-store` on `/api/v1/*`, JSON
   error shape everywhere (no stack traces), request logging **without** bodies, keys, cookies or IPs,
   graceful shutdown (close HTTP, Kafka producer, DB pool), and `/health` that checks the DB.
7. **Dockerfile:** non-root user, `npm ci --omit=dev`, `NODE_ENV=production`.

## Tests (required)

Use `vitest` + `supertest` against `insighthub_test_api` (and a mocked Kafka producer). Cover at least:
- ingestion: valid batch → 202 and the right Kafka message; unknown field → 400; 21 events →
  400; >64 KB → 413; wrong/revoked key → 401; public key from a bad Origin → 403; source/key
  mismatch → 403; rate limit → 429 + `Retry-After`; scrubbing of each pattern; Kafka down → 503
- auth: login OK/bad (same message), cookie flags, logout kills the session, expired session →
  401, viewer can't PATCH (403), missing/foreign Origin on POST → 403, throttling
- read API: pagination, filters, 404 for another project's issue
- config: refuses to start with `DASHBOARD_ORIGINS=*`

Seed data for read-API tests by inserting rows directly into the test DB.

## Done when
`npm test` passes, the API runs on `:8000` against the shared stack, you've done a
self-review of the security behaviour, and `docs/agents/reports/api.md` is written and committed.
