# InsightHub backend

The API service. It does three jobs:

1. **Error ingestion:** `POST /api/v1/events` takes error reports from websites and servers,
   checks and scrubs them, and puts them on the Kafka topic `error-events`.
2. **Dashboard API:** login plus read and triage endpoints under `/api/v1` for the dashboard.
3. **Legacy logs:** the old `/api/logs` endpoints, kept working unchanged.

The exact request and response formats are in [`docs/CONTRACT.md`](../docs/CONTRACT.md) (sections 1, 2, 4 and 5).
This README covers how to run and operate the service.

## Run it

```bash
cp .env.example .env     # fill in DB_PASSWORD (and SERVICE_TOKEN if you need /api/logs)
npm install
npm run dev              # or: npm start
curl localhost:8000/health
```

The service checks every setting at startup and **refuses to start** if one is missing or unsafe:
`DASHBOARD_ORIGINS=*`, `http` origins in production, `TRUST_PROXY=true`, a short `SERVICE_TOKEN`
and so on. Every variable is explained in [`.env.example`](.env.example).

## Admin scripts

```bash
npm run create-user -- --email you@example.com --role admin      # asks for the password (hidden)
npm run create-key  -- --project education-enlightened --kind secret
npm run create-key  -- --project education-enlightened --kind public --origin https://example.com
npm run revoke-key  -- --prefix ih_pk_abc123
```

- Keys are printed **once**. Only their SHA-256 hash is stored. Put secret keys (`ih_sk_…`) only
  on servers. Public keys (`ih_pk_…`) go in browsers and work only from their `--origin`s.
- `http://localhost` origins are accepted only when `NODE_ENV=development`.
- There is no public sign-up. Users exist only if `create-user` made them.

## Security behaviour

| Area | What happens |
| --- | --- |
| Ingestion auth | Key looked up by SHA-256 hash, compared in constant time. Revoked or unknown → 401 |
| Browser keys | `Origin` must exactly match the key's allowed origins, else 403. CORS preflight answered only for those origins |
| Validation | Strict schema: unknown fields → 400, the whole batch is rejected. 1–20 events, 64 KB max |
| Scrubbing | Emails, credentials, JWTs, long tokens, IPs, URL query strings and home-directory names in paths are replaced before Kafka. Patterns are bounded and tested against ReDoS |
| Rate limits | Counted in events: 600/min per secret key; 60/min per public key + IP, 600/min per public key. Plus 1200 requests/min per IP overall. IPs are kept in memory only |
| Dashboard login | bcrypt (cost 12), same message and work for unknown email or wrong password, 10 tries per 15 min per IP + email |
| Sessions | `ih_session` cookie: 32 random bytes, HttpOnly, SameSite=Strict, Secure in production, 12 h. The DB stores only its hash |
| CSRF | State-changing requests need an `Origin` from `DASHBOARD_ORIGINS` and `Content-Type: application/json` |
| Roles | Only admins can change issue status or acknowledge alerts |
| Responses | `helmet` headers, `Cache-Control: no-store` on `/api/v1`, JSON errors without stack traces |
| Logs | Method, path, status and duration only. No bodies, query strings, keys, cookies or IPs |
| Failures | Kafka down → 503 within ~10 s (never hangs). DB down → `/health` returns 503 |

Rate-limit counters are in memory (one process). The store sits behind a small interface
(`src/services/rateLimitStore.js`) so a Redis store can replace it when running more than one instance.

Behind a reverse proxy, set `TRUST_PROXY` (hop count or proxy addresses). Otherwise every client
looks like the proxy's IP and shares one per-IP limit.

## Tests

```bash
npm test
```

The tests run against the `insighthub_test_api` database, which they clear freely, and use a fake
Kafka producer. They need `DB_PASSWORD` in `.env`. They cover the security behaviour (rejections,
limits, scrubbing, auth, CSRF, roles, project scoping) as well as the happy paths.

## Layout

```
src/
  index.js           startup, graceful shutdown
  app.js             Express app (dependencies injected)
  config/            env validation
  db/                Postgres pool (timeouts, UTC)
  lib/               errors, logging, crypto, HTTP helpers
  middleware/        dashboard CORS/CSRF/session/role checks, legacy token
  routes/v1/         events (ingestion), auth, dashboard read API
  routes/logs.js     legacy /api/logs
  services/          API keys, sessions, Kafka, rate limiting, event schema, scrubbing
scripts/             create-user, create-key, revoke-key
test/                vitest + supertest
```

## Docker

`docker build -t insighthub-backend .` builds an image that runs as the unprivileged `node` user,
with production dependencies only and `NODE_ENV=production`. All config comes from env vars.
