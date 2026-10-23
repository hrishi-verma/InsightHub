# Decisions

Every decision that shapes how InsightHub is built, newest at the bottom. Entries are never edited
after the fact. If a decision changes, add a new entry and mark the old one
**Superseded by Dn**. The contract (`docs/CONTRACT.md`) holds the resulting rules. This file says
why.

Status values: **Active**, **Superseded by Dn**, **Planned** (decided, not yet built).

---

## D1 — InsightHub becomes an error tracker for Education Enlightened
*2026-10-11 · Active*

InsightHub's first real traffic is error reports from the Education Enlightened website and API.
It runs alongside Sentry, not instead of it. The old log-monitoring pipeline (`/api/logs`, the
`logs` topic and tables) stays running but isn't extended.
**Why:** it gives the project a real user with real data. Keeping Sentry means nothing is lost if
InsightHub misbehaves.

## D2 — Security rules apply from the first commit
*2026-10-11 · Active*

The rules in `CLAUDE.md`: treat all input as hostile, fail closed, keep personal data out,
store keys and session tokens hashed, give every endpoint auth plus a rate limit plus a body
limit, and put timeouts on outbound calls.
**Why:** it handles data from a live site with real users. Retrofitting security later is how
leaks happen.

## D3 — One written contract, built by parallel agents
*2026-10-11 · Active*

`docs/CONTRACT.md` defines the event format, the Kafka message, the schema and the HTTP APIs. A lead
plus four agents (api, processor, dashboard, integration) each work in their own worktree and
branch. Only the lead edits shared files and merges. See `docs/agents/README.md`.
**Why:** it lets the services be built at the same time without drifting apart.

## D4 — ML is shadow-only
*2026-10-11 · Active*

The ML engine's score may be stored and shown (labelled experimental) but never decides anomalies,
alerts or status. Alert rules are plain thresholds (contract §3).
**Why:** the model was trained on synthetic data. The owner is improving it separately.

## D5 — Separate Kafka topic and tables for errors
*2026-10-11 · Active*

New topic `error-events` and new tables (`issues`, `error_events`, `issue_alerts`, …) in
`database/migrations/001_error_tracking.sql`. The legacy `logs` topic and tables are untouched.
**Why:** this keeps the legacy pipeline working, and the new data gets a strict schema from day one.

## D6 — Token scrubbing: hex runs always, other runs only if letters and digits mix
*2026-10-11 · Active (contract §1)*

Runs of 24 or more `[A-Za-z0-9_-]` characters become `[token]` if they are all hex, or contain
both a letter and a digit.
**Why:** taken literally, the first rule turned class names like `PrismaClientKnownRequestError`
into `[token]`, which ruined grouping. The known gap: a 24+ char secret made only of letters isn't
caught (api report).

## D7 — `url_path` is scrubbed too, and `http` on browser events is rejected
*2026-10-11 · Active (contract §4 notes)*

**Why:** paths like `/reset/<token>` would otherwise leak a one-time token. `http` fields only make
sense on server events.

## D8 — Optional `?project=` on `:id` routes, `/alerts` capped at 200
*2026-10-11 · Active (contract §4 notes)*

A project mismatch returns 404. `/alerts` returns at most 200 rows, newest first, with no cursor yet.
**Why:** `:id` routes had nothing to scope by. 200 alerts is plenty at current volume. A cursor is a
Phase 7 item.

## D9 — Regression only for errors that occurred after the resolve
*2026-10-11 · Active (contract §3)*

A late-delivered event that happened before `resolved_at` is stored silently.
**Why:** otherwise a Kafka backlog would reopen issues that were really fixed.

## D10 — Kafka message key must equal `project_id` when present
*2026-10-11 · Superseded by D18*

## D11 — Group issues by in-app stack frames
*2026-10-11 · Active (contract §3, commit `5b7d731`)*

The fingerprint and culprit use the first three frames outside `node_modules`, `node:` and
`internal/`.
**Why:** grouping by library frames merged unrelated errors that passed through the same
framework code.

## D12 — Dashboard on Next.js 16.3.8 (not 14)
*2026-10-11 · Active*

**Why:** every 14.x release had critical advisories (RCE, middleware bypass, CSP-nonce XSS).
16.3.8 was the newest patch at least 10 days old. It needs Node 20.9 or later.

## D13 — Per-request nonce CSP and session cookie, no tokens in JS
*2026-10-11 · Active*

The dashboard keeps no tokens in JS or storage. The session is the API's httpOnly SameSite=Strict
cookie. The CSP with a per-request nonce lives in `frontend/proxy.js`.
`style-src 'unsafe-inline'` is accepted because Recharts and Next set inline styles.
**Why:** XSS can't steal a session it can't read.

## D14 — Backend refuses unsafe proxy and CORS settings
*2026-10-11 · Active*

`TRUST_PROXY=true` is refused (use a hop count or addresses instead). The legacy `/api/logs` CORS
is narrowed from `*` to `DASHBOARD_ORIGINS`.
**Why:** `true` lets any client spoof its IP and dodge rate limits. `*` was never needed.

## D15 — Replace kafkajs with `@confluentinc/kafka-javascript`
*2026-10-23 · Planned (roadmap Phase 5)*

**Why:** kafkajs has had no release since February 2023. CLAUDE.md requires maintained
dependencies. Confluent's client has a KafkaJS-compatible API. Because it's a different client
library, the switch is tested against the built images, including restarts, retries and offsets.

## D16 — Pre-launch auth hardening
*2026-10-23 · Planned (roadmap Phases 2 and 5)*

- Secret keys (`ih_sk_`) sent with an `Origin` header → 401. They must never be used from a browser.
- Dashboard passwords are 12 characters up to **72 bytes**, which is bcrypt's real limit.
- The session cookie is renamed to `__Host-ih_session`. The browser then enforces Secure, Path=/
  and no Domain.

**Why:** each one closes a gap the api agent flagged. The cookie rename is free now, while there are
no real sessions to break.

## D17 — Host InsightHub on one VPS with docker compose
*2026-10-23 · Planned (roadmap Phase 6)*

All of InsightHub runs on the VPS: the API, processor, Kafka, Postgres, the ML engine (shadow) and
the dashboard. Caddy sits in front for TLS, and only Caddy publishes ports. Education Enlightened
stays on Vercel. The dashboard and API share one registrable domain over https.
**Why:** it's the simplest setup that keeps Kafka and Postgres off the public internet. The
`SameSite=Strict` cookie needs the dashboard and API on the same site.

## D18 — Kafka message key is required
*2026-10-23 · Planned (roadmap Phases 2 and 5)*

A missing, non-numeric or mismatched key means the message is skipped and logged.
Supersedes D10 ("when present").
**Why:** the backend always sends a key, so a missing key means the message didn't come from it.
Messages already on the dev topic are test data. Production starts with a fresh Kafka.

## D19 — Legacy docs and SDKs are archived, not deleted
*2026-10-23 · Active*

`insighthub_documentation.txt` → `docs/archive/original-design.md`, and `sdk-js/` and `sdk-python/`
→ `legacy/`. The root README and `database/README.md` are rewritten for the error-tracking service.
**Why:** they describe the old log-monitoring system and were misleading as the front page. They're
kept because the legacy `/api/logs` pipeline still runs.

## D20 — Track work in ROADMAP, PROGRESS and DECISIONS
*2026-10-23 · Active*

`docs/ROADMAP.md` says what's next. `docs/PROGRESS.md` records what was done and how it was checked.
This file records why.
**Why:** the work runs over many sessions and agents, so a written record beats memory.

## D21 — Env files are never tracked, except `.env.example`
*2026-10-23 · Active*

`.gitignore` ignores `.env` and `.env.*`, except `!.env.example`. `frontend/.env.local` had been
committed (in `ccb811d` and `18c3752`). It was removed from the index, and `frontend/.env.example`
replaces it.
**Why:** env files are where secrets go. Checked: every committed version held only
`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`, both pointing at localhost, so nothing in history
needs rotating.
