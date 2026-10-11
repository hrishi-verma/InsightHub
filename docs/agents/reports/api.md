# api report

Branch `agent/api`. All changes are under `backend/` plus this report.

## What I built

**Endpoints** (formats per `docs/CONTRACT.md`):

- `POST /api/v1/events` (+ `OPTIONS` preflight): ingestion per §1, publishing to Kafka `error-events` per §2.
- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- `GET /api/v1/projects`, `/overview`, `/issues`, `/issues/:id`, `/issues/:id/events`, `/alerts`;
  `PATCH /api/v1/issues/:id` and `POST /api/v1/alerts/:id/ack` (admin only).
- `GET /health` (checks the DB, 503 if it's down).
- Legacy `/api/logs/*` still works. `SERVICE_TOKEN` comes from env with no default (unset → 503,
  under 32 chars → refuses to start). The `dev-token-123` and `password` fallbacks are gone.

**Files**

| Path | What |
| --- | --- |
| `src/index.js` | Startup, background Kafka connect, session cleanup every 10 min, graceful shutdown (HTTP → Kafka → DB pool, 10 s cap) |
| `src/app.js` | Express app with injected dependencies (pool, publishers, rate-limit store) so tests can fake Kafka |
| `src/config/index.js` | zod env validation; refuses to start on bad config |
| `src/db/pool.js` | pg pool: connect/statement/query timeouts, `TimeZone=UTC` |
| `src/lib/*` | Error shape, JSON logger (no PII), SHA-256/constant-time helpers, cookie/content-type helpers |
| `src/middleware/dashboard.js` | Dashboard CORS, CSRF/Origin check, session, admin role |
| `src/middleware/serviceToken.js` | Legacy token check (constant time, fail closed) |
| `src/routes/v1/{events,auth,dashboard}.js` | The v1 routes |
| `src/routes/logs.js` | Legacy routes, now with injected deps (logic unchanged except a bounded `limit`) |
| `src/services/eventSchema.js` | Strict Event v1 schema |
| `src/services/scrub.js` | Scrubbing on arrival |
| `src/services/kafka.js` | Idempotent producer (acks=all, 1 in-flight), connect/send timeouts, reconnect after failure |
| `src/services/rateLimitStore.js` | In-memory fixed-window store behind an async `consume()` interface (Redis-replaceable) |
| `src/services/{apiKeys,sessions,cursor,serialize}.js` | Key auth, sessions, opaque keyset cursors, response shapes |
| `scripts/{create-user,create-key,revoke-key}.js` | Admin scripts per §5 |
| `Dockerfile`, `.dockerignore` | node:24-alpine, `npm ci --omit=dev`, `NODE_ENV=production`, runs as `node` |
| `.env.example`, `README.md` | Every env var documented; README rewritten (the old one documented `dev-token-123`) |
| `test/*.test.js`, `vitest.config.js` | 104 tests |

**How to run**

```bash
cd backend && cp .env.example .env   # set DB_PASSWORD
npm install && npm start             # :8000
npm test
npm run create-user -- --email a@b.com --role admin
npm run create-key -- --project education-enlightened --kind public --origin http://localhost:5173
```

## How I tested it

`npm test`: **6 files, 104 tests, all passing** (about 6 s), against `insighthub_test_api` with a fake Kafka producer.

- **Ingestion:** valid batch → 202 and the exact Kafka message (`{schema, project_id, received_at, event}`, key = project id, acks=all).
  Rejections:
  - unknown field (event and top level) → 400
  - 0 and 21 events → 400
  - bad UUID / UUID v1 / no timezone / +10 min / −8 days → 400
  - `url_path` with `?`, NUL bytes, 11 tags, bad tag key, bad release, `http` on browser events → 400
  - malformed JSON → 400 (generic message)
  - over 64 KB → 413
  - `text/plain` → 415
  - missing, unknown, revoked or wrong-kind key → 401
  - public key from a bad Origin or with no Origin → 403
  - source/key mismatch (both ways) → 403
  - Kafka down → 503 with no details
  - unreachable real broker gives up in under 12 s

  Rate limits: secret key 600 events then 429 with `Retry-After`; public key + IP at 60.
  Scrubbing: every pattern, plus a check that normal stack frames and identifiers survive.
  Preflight: allowed vs refused origins, no credentials header.
- **Auth:**
  - Login sets a cookie with HttpOnly, SameSite=Strict, Path=/, Max-Age=43200, and Secure only in production. The DB holds only the hash, and expiry is 12 h.
  - Unknown email and wrong password give identical 401s, and disabled users get the same response.
  - Throttled at 10 per IP + email, and other emails are unaffected.
  - Logout deletes the session. Expired, forged, SQL-ish and disabled-user sessions → 401.
  - No Origin, a foreign Origin, or a form-encoded POST → 403. Dashboard CORS works only for `DASHBOARD_ORIGINS`.
- **Read API:**
  - Every endpoint returns 401 without a session.
  - Keyset pagination returns no gaps or repeats, for both `last_seen` and `event_count` sorts.
  - Filters work: status, source, environment, and `q`, where `%`/`_` match literally.
  - Another project's issue → 404 (list, detail, events, PATCH, ack).
  - Bad params → 400, including duplicate params, a cursor replayed across sorts, and a forged cursor containing SQL.
  - Viewer PATCH/ack → 403, and the status really stays unchanged. Admin resolve/reopen sets and clears `resolved_at`. Alerts filter by `acknowledged`.
- **Config:** refuses `DASHBOARD_ORIGINS=*`, wildcard subdomains, empty, origins with a path, http in production, missing NODE_ENV/KAFKA_BROKER/DB password, `TRUST_PROXY=true`, a short `SERVICE_TOKEN` and a bad PORT. Error messages never contain the secret value.
- **Legacy:** 503 without a token; `dev-token-123` → 401; still queues with the real token; no more `ACAO: *`.
- **Failure modes:** with the DB down, `/health` → 503 and the API returns `INTERNAL` with no internals.

**Manual checks**

- Ran the API on `:8000` against shared Kafka (`localhost:9093`), using the test DB for the key. `POST /api/v1/events` with a secret key → 202. I read the message back from `error-events` (partition 0, offset 4) and it was in the contract shape with key `"1"`. The email in the message arrived as `[email]`. Graceful shutdown on SIGTERM was clean, and no key appeared in the server log.
- The admin scripts work: stored hashes are `$2b$12$…`, and duplicate users, bad origins (http without development, paths), public keys without an origin, unknown projects, short passwords and a `--password` argument are all refused. `revoke-key` works and refuses a second time.
- `docker build` succeeds. The container runs as `node`, has no dev deps, the bcrypt musl prebuild loads, and with no env it logs "refusing to start" and exits.
- `npm audit`: 0 vulnerabilities.

## Security review

I checked my own diff for the following:

- **Injection:** all SQL is parameterised. Sort columns come from a fixed map. Cursors are base64url JSON, validated by regex before use as typed params (`::timestamptz`, `::bigint`, `::uuid`). `ILIKE` input escapes `\ % _`. Ids are regex-checked (non-matching → 404).
- **XSS:** the API only returns JSON with `nosniff`. Stored error text is attacker-controlled, so the dashboard must render it as text (React's default). I flagged this for the dashboard agent below.
- **CSRF:** non-GET dashboard requests need an exact `Origin` from `DASHBOARD_ORIGINS` plus `application/json`, and the cookie is SameSite=Strict. Login is covered too.
- **Auth bypass:**
  - Every v1 dashboard route sits behind `requireSession` (router-level), and PATCH/ack are behind `requireAdmin`.
  - Ingestion keys are format-checked, looked up by hash, compared in constant time, and kind-checked. Sending both headers → 401.
  - Disabled users lose their sessions immediately.
- **Data leaks:**
  - Logs contain only method, path, status and ms. Errors log name, code and a truncated message, never stacks or `detail`.
  - API errors never include stacks, and zod messages name fields, never values.
  - IPs are used only as in-memory rate-limit keys.
  - The key is printed once by `create-key` and never logged.
  - `.env` is git-ignored, and secrets aren't in code, tests or docs.
- **Limits:**
  - Body caps: 64 KB on ingestion, 16 KB on the dashboard, and the legacy 100 KB.
  - gzip bodies are refused (`inflate: false`) to avoid zip bombs.
  - Rate limits: per-IP request limit everywhere, event limits per key, login throttle.
  - Timeouts: pg (5 s statement, 6 s query, 5 s connect), Kafka (5 s connect + 5 s send), server headers/request timeouts.
  - Query parser is `simple`, so no nested objects.

**Things I'm unsure about**

1. **Login timing.** Both paths do one bcrypt compare at cost 12. The remaining difference is one indexed SELECT returning 0 or 1 rows, which I think is negligible, but I didn't measure it statistically.
2. **bcrypt's 72-byte limit.** Passwords may be up to 128 chars (contract), but bcrypt ignores bytes past 72. That's low risk at 12–128 chars, but the contract could cap at 72 bytes.
3. **kafkajs is effectively unmaintained** (last release 2023). It was already a dependency. On Node 24 it prints a harmless `TimeoutNegativeWarning`. Longer term, consider `@confluentinc/kafka-javascript`.
4. **The scrubber's "long run" rule is a heuristic** (see Deviations). It can miss a 24+ char secret made only of letters, and it can over-scrub snake_case identifiers that contain digits.
5. **A secret key used from a browser** is accepted (the contract says "never put in a browser" but doesn't say to reject it). We could reject secret-key requests that carry an `Origin` header.

## Deviations from the contract / brief

These are mostly interpretations where the contract is silent:

1. **Token scrubbing.** I read "runs of ≥ 24 hex or base64url characters" as: all-hex runs always, and base64url runs only when they mix letters and digits. Taken literally, the rule would turn names like `PrismaClientKnownRequestError` (29 letters) into `[token]` and ruin grouping. UUIDs become `[token]`.
2. **`url_path` is scrubbed too** (contract: message, stack, tags). Paths like `/reset/<token>` would otherwise leak. Values stay valid.
3. **`http` on a `browser` event → 400** ("Server only" in the table).
4. **`GET/PATCH /issues/:id`, `/issues/:id/events` and `POST /alerts/:id/ack` take an optional `?project=<slug>`.** When it's given, a mismatch → 404. The contract asks for "404 on cross-project" but these paths have no project parameter. Every logged-in user can already see every project, so without it there's nothing to scope by.
5. **`GET /alerts`:** with `acknowledged` omitted it returns all alerts. Results are capped at 200, newest first, with no cursor (the contract has none).
6. **Extra limits:** 50 login attempts per IP per 15 min across all emails (password spraying), and 1200 requests/min per IP on everything.
7. **DB errors during key lookup → 500 `INTERNAL`.** The contract only defines 503 for Kafka.
8. **`TRUST_PROXY=true` is refused.** Use a hop count or proxy addresses.
9. **Legacy:** CORS narrowed from `*` to `DASHBOARD_ORIGINS` (no credentials), and `GET /api/logs?limit=` bounded to 1–1000. Both are small security fixes.

## New dependencies

| Package | Version | Why |
| --- | --- | --- |
| `zod` | 4.6.5 | Strict schemas for env, events, bodies and queries (the brief suggested it) |
| `helmet` | 8.3.0 | Security headers |
| `bcrypt` | 6.0.0 | Password hashing, cost 12 (ships glibc and musl prebuilds) |
| `vitest` (dev) | 5.0.3 | Tests |
| `supertest` (dev) | 7.3.1 | HTTP tests |

**Removed:** `nodemon` (dev). It pulled in chokidar/braces with known advisories; `npm run dev` now uses `node --watch`.
`joi` and `express-rate-limit` stay for the legacy routes. `npm audit` reports 0.

## Requests for the lead

1. **`docker-compose.yml` (yours):**
   - The backend service sets `SERVICE_TOKEN: dev-token-123` and lacks `NODE_ENV`, `DASHBOARD_ORIGINS` and `TRUST_PROXY`, so the container will now refuse to start.
   - Suggested env: `NODE_ENV`, `DASHBOARD_ORIGINS: http://localhost:3000`, `TRUST_PROXY: "false"`, `SERVICE_TOKEN: ${SERVICE_TOKEN:-}` (or drop it), and the `DB_*` vars as now.
2. **Contract clarifications:**
   - Deviation 1 (token heuristic) and deviation 4 (optional `?project` on `:id` routes).
   - Whether `/alerts` needs pagination.
   - Whether to cap passwords at 72 bytes.
3. **Branch base:** `main` doesn't contain the foundation commit `6947ae5`. My branch is based on it, so `git diff main` shows the foundation files. Against `6947ae5`, only `backend/` changed.
4. **Dashboard agent:**
   - Use `credentials: 'include'`. Send `Content-Type: application/json` on every POST/PATCH, including logout (`{}` body is fine).
   - Render error text as plain text.
   - Cursors are opaque.
5. **Shared Kafka:** my smoke test put one message on `error-events` (offset 4: `error_type: "SmokeTest"`, `environment: "development"`, project 1). If the processor is running against the main DB, it will appear there as one issue.
6. **Future cookie hardening:** consider renaming the cookie to `__Host-ih_session` (forces Secure, Path=/ and no Domain). It's a contract change, so I didn't make it.

## Known gaps / next steps

- **Rate limits are in memory, per process.** Running more than one instance needs the Redis store (the interface is ready).
- **Overview and issue charts** use hour buckets in UTC (`date_trunc`). The `environment` filter on `/issues` uses an `EXISTS` over `error_events`. It's fine at current volume but may need an index on `(issue_id, environment)` later.
- **No user-management endpoints** (by design: CLI only), so there's no way yet to disable a user except SQL.
- **`last_used_at` is throttled per process** (in memory) and in SQL (only if older than 1 minute).
