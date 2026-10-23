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
