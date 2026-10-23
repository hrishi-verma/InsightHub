# Progress log

What has been done, newest at the bottom. One entry per finished step or phase: what changed,
the commits, the check that proved it, and anything left over. The plan is in
[`ROADMAP.md`](ROADMAP.md) and the reasons are in [`DECISIONS.md`](DECISIONS.md).

---

## 2025-12-02 → 2025-12-03 — Original log-monitoring system
Commits `72e934a` … `ccb811d`. Log SDKs, `/api/logs` ingestion, Kafka `logs` topic, processor,
Isolation-Forest ML engine and a Next.js dashboard. Design doc: `docs/archive/original-design.md`.

## 2026-10-11 — Foundation for error tracking
Commit `6947ae5`. `docs/CONTRACT.md`, `database/migrations/001_error_tracking.sql`, `CLAUDE.md`
and the agent briefs in `docs/agents/`. Decisions D1–D5.

## 2026-10-11 — Processor agent merged
Merge `8b00c3e` (branch `agent/processor`). `error-events` consumer, strict schema,
fingerprinting, idempotent storage, alert rules (new issue, spike, regression) and ML shadow
scoring. Report: `docs/agents/reports/processor.md`.
**Checked by:** the agent's vitest suite against `insighthub_test_processor`, plus an end-to-end
message through the shared Kafka.
**Follow-ups:** kafkajs (→ D15), no dead-letter topic, no health endpoint.

## 2026-10-11 — API agent merged
Merge `c8c986d` (branch `agent/api`). `POST /api/v1/events`, the dashboard API, sessions,
admin scripts (`create-user`, `create-key`, `revoke-key`) and scrubbing. Report:
`docs/agents/reports/api.md`.
**Checked by:** the vitest + supertest suite against `insighthub_test_api` (security behaviour
included), plus one smoke-test message on the shared Kafka.
**Follow-ups:** the four hardening items (→ D16), in-memory rate limits.

## 2026-10-11 — Lead follow-ups
Commits `28e9f51`, `b4c248f`, `d78b9ab`, `7d15848`. Compose env for the new backend and
processor, contract clarifications (D6–D10), legacy dashboard pages removed.

## 2026-10-11 — Dashboard agent merged
Merge `581ba6a` (branch `agent/dashboard`). Session login, the overview, issues, issue detail and
alerts pages, security headers and a nonce CSP. Next.js upgraded to 16.3.8 (D12, D13). Report:
`docs/agents/reports/dashboard.md`.
**Checked by:** the frontend tests against the mock API, and manual checks in Chrome.
**Follow-ups:** not yet run against the real API (→ roadmap Phase 3).

## 2026-10-11 — In-app frame grouping
Commit `5b7d731`. The fingerprint and culprit use in-app frames (D11), with new tests in
`processor-service/test/fingerprint.test.js`.

## 2026-10-23 — Roadmap agreed
Reviewed what's left. Owner decisions: D15–D19. Plan written to `docs/ROADMAP.md` (D20).

## 2026-10-23 — Phase 1: docs and project structure
- New `docs/DECISIONS.md` (D1–D21, backfilled from the contract, commits and agent reports),
  `docs/ROADMAP.md`, `docs/PROGRESS.md`; a "Tracking work" section in `CLAUDE.md`.
- Moved `insighthub_documentation.txt` → `docs/archive/original-design.md` (with an archive note) and
  `sdk-js/`, `sdk-python/` → `legacy/` (with `legacy/README.md`).
- Rewrote the root `README.md` (error tracking, doc map, run, tests) and `database/README.md` (files,
  manual migrations, what's stored; removed a default `Password: password` from the old text).
- `docker-compose.yml`: the frontend gets `NEXT_PUBLIC_API_URL` as a build arg + a matching runtime env
  var; noted in `.env.example` and the README that changing it needs a rebuild.
- `frontend/.env.local` was **tracked** (an earlier note said otherwise; that was wrong). It's now
  untracked, `.env.*` is ignored, and `frontend/.env.example` is added. History held only localhost URLs (D21).
- Removed the merged worktrees `.worktrees/{api,processor,dashboard}`. The branches are kept.

**Checked by:**
- `docker compose config -q` → OK (the frontend build arg resolves).
- A grep for stale `sdk-*` / `insighthub_documentation` / `can-be-deleted` references → none, apart from D19 describing the move.
- Relative links in all the changed docs resolve.
- `git check-ignore` → `.env.local` ignored, all `.env.example` files not.

**Follow-ups:** none.

## 2026-10-23 — Phase 2: contract updates
`docs/CONTRACT.md` amended (each change is marked "amended 2026-10-23"):
- §1: a secret key on a request with an `Origin` header → 401; the 401 row lists every case.
- §2: the Kafka key is required and must be the decimal `project_id`; anything else is skipped and logged (D18).
- §4: the cookie is `__Host-ih_session` (Secure) in production and `ih_session` in development (D16, D22).
- §5: passwords are 12 chars to 72 bytes UTF-8; login rejects anything longer with 400.
- `docs/agents/integration.md`: the server reporter must never send an `Origin` header.

**Security check:** two gaps found and fixed in the same phase:
- A `__Host-` cookie can't work over dev http in Safari → split the name by environment (D22).
- A server sender that sets `Origin` would be locked out → the reporter brief forbids it.
- The 400 for long passwords doesn't depend on the account, so it can't be used to enumerate users.

**Checked by:** read through the contract diff. **Follow-ups:** code changes in Phase 5
(`backend/src/middleware/dashboard.js` cookie name, `backend/test/auth.test.js`, processor key check,
and the `backend/README.md` / `frontend/README.md` cookie mentions).

## 2026-10-23 — Phase 3: dashboard against the real API
Ran the shared Postgres + Kafka, the backend (`DASHBOARD_ORIGINS=http://127.0.0.1:3000,http://localhost:3000`),
the processor, and the dashboard (`NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`; with a SameSite=Strict
cookie, `localhost` and `127.0.0.1` are different sites, so both must use the same host).
Throwaway users `e2e-admin@insighthub.test` / `e2e-viewer@insighthub.test` (random passwords kept
outside the repo; removed in Phase 5).

**Walkthrough (Chrome):** login → overview → issues → issue detail (chart, events) → alerts →
resolve and reopen (admin) → sign out → viewer sees no admin buttons → sign out. No app console errors.
**API (curl):**
- Admin and viewer logins 200; wrong password and unknown user are both 401 with the same message; login from a foreign Origin 403.
- All reads 200, unauthenticated 401.
- Viewer PATCH/ack 403. Admin PATCH without Origin, or with a form content type, 403.
- No CORS headers for a foreign origin. Logout 204, then `/auth/me` 401, and the session row is deleted.
**Headers:** dashboard nonce CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`,
`no-referrer`. API `Cache-Control: no-store` and helmet headers.

**Security check — found and fixed:**
1. **Personal data in stack paths (D23).** A stored culprit contained the developer's username and folders.
   Added a home-directory rule to `backend/src/services/scrub.js`, plus tests.
2. **ReDoS in the email scrub pattern (D24).** Quadratic: 126 ms per 16 KB stack, ~2 s per 64 KB, reachable
   with a public browser key. Bounded the pattern. Worst case across 17 hostile inputs went from 126 ms to 3.2 ms.
   Added a 64 KB timing test. Processor fingerprint regexes fuzzed the same way: worst 0.5 ms, no change needed.

**Checked by:** `backend: npm test` → 114 passed; `processor-service: npm test` → 76 passed;
`frontend: npm test` → 24 passed.
**Notes:** the browser automation can't type `+` reliably. That's a test-tool quirk, not an app bug: the same
password logged in fine via curl. Existing rows aren't re-scrubbed, so the old test rows (including the path one)
get deleted in Phase 5.

## 2026-10-23 — Phase 4: Education Enlightened reporter
The reporter already existed: built and merged in `Sahaj Yoga/Education enlightened` on 2026-10-11
(`6c69640`, Education Enlightened D71/D72; report `docs/insighthub-integration-report.md` there). My earlier
"not started" was wrong: I had looked in an unrelated repo.

**Brought it up to today's contract**, in worktree `.worktrees/insighthub-hardening`, branch
`feature/insighthub-hardening`, commit `a84219e` (not merged):
- Home-directory scrubbing in both reporters (D23 here, Education Enlightened D75).
- **ReDoS:** the email, URL-with-query and bare-path patterns were quadratic, up to 235 ms per 16 KB. On the API
  that blocks the event loop. Bounded; worst case 15 ms. Timing tests added.
- The server reporter's header test already pins exactly `Content-Type` + `Authorization`, so it never sends `Origin`.

**Security check — found and fixed in InsightHub:** the same URL-rule problem in
`backend/src/services/scrub.js` (332 ms per 64 KB of repeated `wss://`) → bounded to 2048 chars, now 43 ms.
Timing tests extended.

**Checked by:**
- Education Enlightened: `npm run lint` ✓, `format:check` ✓, `build` ✓, `npx vitest run` → 67 passed;
  `backend: npm run typecheck` ✓, `npm test` → 63 passed, 51 skipped (DB tests; its Postgres isn't started, as the brief says).
- InsightHub `backend: npm test` → 117 passed.
- A throwaway fuzz of 33 hostile inputs on both reporters → worst 15 ms per 16 KB.

**Follow-ups:**
- Owner merges the Education Enlightened branch.
- Low-risk scrub gaps: %-encoded text inside messages isn't decoded; the IPv4 rule matches 4-part versions.
- Education Enlightened hosting corrected (D25).

## 2026-10-23 — Phase 5 step: contract hardening in code (D16, D18, D22)
Done by the executor (Sonnet) from a GOAL/SCOPE/DONE WHEN brief; I reviewed the diff and re-ran the checks.
- `backend/src/routes/v1/events.js`: a secret key with any `Origin` header (including `null`) → 401 before any key lookup.
- `backend/src/routes/v1/auth.js`, `scripts/create-user.js`: passwords over 72 bytes UTF-8 are refused
  (login → generic 400, before the rate limiter, so it's independent of the account).
- `backend/src/middleware/dashboard.js`, `app.js`: the cookie is `__Host-ih_session` (Secure, Path=/, no Domain)
  in production and `ih_session` in development. Each app accepts only its own name.
- `processor-service/src/schema.js`: the Kafka key is required and must match `^[1-9][0-9]{0,9}$` and `project_id`.
- New tests for every rejection; READMEs updated.

**Security check:** diff reviewed. No input is echoed in errors; the checks run before expensive work; the
logout clear carries `Secure; Path=/` (needed to clear a `__Host-` cookie).
**Checked by:** `backend: npm test` → 121 passed; `processor-service: npm test` → 81 passed.

## 2026-10-23 — Phase 5 step: kafkajs → @confluentinc/kafka-javascript 1.11.0 (D15, D26)
The executor (Sonnet) did the migration (backend producer, processor consumers, lockfiles, a new
`backend/test/kafkaPublisher.test.js`). Docker needed no change: on Node 24 alpine, `npm ci` fetches the
prebuilt musl binary. I reviewed the diff, then tested the **built images** on the compose network
against the shared Kafka and Postgres:
- (a) event → API → Kafka → processor → Postgres: stored in 1 s; email and home directory scrubbed. ✓
- (b) processor stopped, event sent, processor restarted: offset 8 → 9, event stored, nothing redone. ✓
- (c) Kafka stopped: 503 in 5.0 s, API healthy. **First run: the API never recovered after Kafka came back**
  ("Connect has already been called elsewhere"). Fixed: a failed producer is replaced (D26), and tests use a
  fake that refuses a second connect, like the real client. Re-run: 503s while down, first request after → 202 and stored. ✓
- (d) DB stopped while the processor held a message: 7 retries, stored 6 s after the DB returned, lag 0. ✓
- (e) same `event_id` sent twice: 1 row, `event_count` = 1. ✓
- After the old kafkajs processor stopped, the new consumer logged "Inconsistent group protocol" until the
  old members expired (D26).

**Security check:**
- `npm audit --omit=dev` found two pre-existing high findings: zod (memory exhaustion) and body-parser
  (compressed-body DoS) → upgraded (D27). The processor moved zod 3 → 4. Both services now have 0 vulnerabilities.
- The supply-chain note on the native binary download is recorded in D26.

**Local dev:** the native build fails on Node 26 in a path with spaces. The binary built in a scratch
folder was copied into `node_modules` (git-ignored); both READMEs explain this.

**Checked by:** `backend: npm test` → 128 passed; `processor-service: npm test` → 81 passed;
both images rebuilt, with a final round trip ✓.

## 2026-10-23 — Phase 5 step: processor health and metrics (D28)
Executor (Sonnet) built `processor-service/src/health.js`, plus the config (`HEALTH_HOST`/`HEALTH_PORT`), the
wiring in `index.js`, a Kafka admin check that replaces a failed client, the Dockerfile `HEALTHCHECK`, 11 tests
and the README. No new dependencies. I reviewed the diff and checked the built image:
- Container reaches `healthy` 3 s after start. `/health` → 200 `{ok, db up, kafka up}`; `/metrics` → counters;
  POST → 405; unknown path → 404.
- From another container on the compose network → ECONNREFUSED (loopback only).
- Postgres stopped → 503 `{"status":"degraded","db":"down"}` in 62 ms; back up → 200.
**Checked by:** `processor-service: npm test` → 91 passed.

## 2026-10-23 — Phase 5 step: local end-to-end run with the real reporters
- **Server reporter** (Education Enlightened `buildServerEvent` + `sendToInsightHub`, driven by a temporary script
  with a fake request carrying a cookie, auth header, body, query and IP). Stored row: email/token/IP scrubbed, home
  directory → `~`, route/method/status kept. **No cookie, header, body, query or client IP stored.**
- **Browser reporter** (Education Enlightened website on `localhost:5173` with a throwaway public key, page opened as
  `/?token=…#frag`, then an uncaught `TypeError` and an unhandled rejection). Both stored with email, credential
  and IP scrubbed, `url_path` = `/` (query and fragment dropped), runtime = `Chrome 155` only. The CORS preflight was answered.
- **Personal-data scan** over every stored event and issue (emails, IPv4, query strings, credentials, JWTs, home
  directories): the only hits were the old 2026-10-11 test row, stored before D23.
- **Cleanup:** after listing them, deleted all 13 test issues, their events and alerts (all `development`), revoked
  the two throwaway keys, and removed the two test users. Left: the project and the owner's admin account.

## 2026-10-23 — Phase 5 step: security review and code review
**`/security-review`** (main...production, inline: auth, sessions, SQL building, CSRF/CORS, redirects, XSS sinks,
secret logging): **no high-confidence vulnerabilities.** Outside this review's scope, noted for later: the
legacy `ml-engine` `/train` endpoint has no auth (internal network only; shadow model, D4).

**`/code-review medium`** (5b7d731..production): 10 findings, 8 fixed:
1. The consumer would be kicked from the group during DB outages over 5 min → `rebalanceTimeout` 15 min (executor).
2. `/home/...` site routes in `url_path` were rewritten → no home rule on `url_path` (D30).
3. `/health` couldn't see a dead consumer → a `consumer` field from `assignment()`, with a 60 s startup grace (executor).
4. The login 72-byte cap would lock out older accounts → cap only at creation (D29).
5–6. Length caps let long URLs keep their query and long emails leak a prefix → linear rules with no caps (D30),
   applied to the backend **and** both Education Enlightened reporters (`c166350` there).
7. Publisher race: a concurrent retire could null the producer mid-send → `connect()` returns its producer; test added.
8. HEALTHCHECK ignored `HEALTH_HOST` → uses it, with wildcard → loopback (executor).
Not fixed: the retry metric is tied to a log event name (low impact); a redundant no-op heartbeat argument (removed anyway in fix 1).

**Checked by:** `backend: npm test` → 134 passed; `processor-service: npm test` → 95 passed; Education Enlightened lint,
format, build, website tests 74 passed, API typecheck + tests 72 passed (51 DB tests skipped); scrub fuzz worst 1.5 ms per 64 KB
(backend) and 3 ms (reporters). Live: rebuilt images, `/health` → `{"consumer":"up"}` after the grace period, container
`healthy`; one event round trip stored; the throwaway key was revoked and test rows removed.
