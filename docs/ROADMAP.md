# Roadmap

What's left before InsightHub takes real traffic, in order. Do one phase at a time, and finish its
**Check** before starting the next. When a step finishes, tick it here, add an entry to
[`PROGRESS.md`](PROGRESS.md), and record any new decision in [`DECISIONS.md`](DECISIONS.md).

Status: ☐ todo · ◐ in progress · ☑ done

## ☑ Phase 1 — Docs and project structure
- ☑ `DECISIONS.md`, `ROADMAP.md`, `PROGRESS.md`; tracking rule in `CLAUDE.md`
- ☑ Archive legacy docs and SDKs (`docs/archive/`, `legacy/`)
- ☑ Rewrite the root `README.md` and `database/README.md`
- ☑ `frontend/.env.example`; `NEXT_PUBLIC_API_URL` as a compose build arg
- ☑ Remove the merged agent worktrees (branches kept)
- **Check:** `docker compose config -q` passes, no broken doc references, and `git status` shows only the intended changes

## ☑ Phase 2 — Contract updates (D16, D18)
- ☑ Secret key + `Origin` → 401; 72-byte password cap; `__Host-ih_session`; Kafka key required
- **Check:** read through the contract diff

## ☑ Phase 3 — Dashboard against the real API
- ☑ Run the backend and frontend without mocks; admin and viewer users
- ☑ Walk through: login, overview, issues, issue detail, alerts, admin actions, viewer, logout
- **Check:** no console, CSP or CORS errors; backend and frontend tests pass

## ☑ Phase 4 — Education Enlightened reporter
- ☑ Already built and merged there on 2026-10-11 (`6c69640`, Education Enlightened D71/D72)
- ☑ Brought up to today's contract on branch `feature/insighthub-hardening` (`a84219e`, Education Enlightened D75): home-directory scrubbing, ReDoS bounds, no `Origin` header
- ☐ **Owner:** merge `feature/insighthub-hardening` into Education Enlightened `v3`
- **Check:** Education Enlightened lint, format, build, website tests, API typecheck and tests all pass

## ☑ Phase 5 — Hardening and end-to-end run
- ☑ kafkajs → `@confluentinc/kafka-javascript` (D15, D26): built images verified for restart, offsets, Kafka/DB outages and duplicates
- ☑ Dependency audit clean: zod 4.6.7, body-parser 1.20.9 (D27)
- ☑ Contract hardening in code (D16, D18, D22), with rejection tests
- ☑ Processor health and metrics endpoint (internal only, D28)
- ☑ Local end-to-end run: the real server and browser reporters → dashboard data; personal-data scan clean; test data deleted
- ☑ `/code-review` + `/security-review`; findings fixed (D29, D30, processor liveness)
- ☑ Merge `production` → `main` locally (fast-forward; not pushed)
- **Check:** all suites pass, the end-to-end run is clean, the reviews are clean

## ◐ Phase 6 — Deploy to a VPS (D17, D25) — runbook: [`DEPLOY.md`](DEPLOY.md)
- ☑ `docker-compose.prod.yml` + `deploy/Caddyfile`: only 80/443 published, dashboard built with the production API URL, Postgres pinned, ML engine opt-in
- ☑ Production mode smoke-tested locally through Caddy (HTTPS, HSTS, `__Host-` cookie, CORS, CSRF, logout, log redaction)
- ☑ `deploy/backup.sh` (root-only dumps, 14 days) — backup **and restore** tested
- ☐ **Owner:** VPS account and a domain (`api.<domain>`, `app.<domain>` A records)
- ☐ Server hardening, `.env`, first start, port scan (DEPLOY.md §2–4)
- ☐ Admin user and keys (§5)
- ☐ **Owner:** merge Education Enlightened `feature/insighthub-hardening`; Vercel env + redeploy (server reporter); after 24 h GitHub variables + release (browser reporter) (§6)
- ☐ Backups cron and off-server copies (§7)
- **Check:** real 500s show on the dashboard, the processor health check stays clean, and only 22/80/443 are open

## ☐ Phase 7 — After launch (as needed)
- ☐ Dead-letter topic
- ☐ Redis rate-limit store (only with more than one API instance)
- ☐ User-management CLI (disable a user, reset a password)
- ☐ Playwright end-to-end tests
- ☐ Tailwind 4 migration (7 dev-only audit findings)
- ☐ `(issue_id, environment)` index; `/alerts` cursor
- ☐ Decide what to do with the legacy `/api/logs` pipeline
- ☐ ML retraining on real data (owner)
