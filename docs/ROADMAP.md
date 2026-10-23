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

## ◐ Phase 4 — Education Enlightened reporter (integration agent)
- ☐ Worktree `feature/insighthub-reporter`; brief = `docs/agents/integration.md`
- ☐ Review the diff and run Education Enlightened's checks myself
- **Check:** Education Enlightened's checks pass, D71 is recorded there, and the report is committed

## ☐ Phase 5 — Hardening and end-to-end run
- ☐ kafkajs → `@confluentinc/kafka-javascript` (D15): test the built images for restart, retry, offsets, Kafka/DB outages and duplicates
- ☐ Contract hardening in code (D16, D18), with rejection tests
- ☐ Processor health and metrics endpoint (internal only)
- ☐ Local end-to-end run: one server error and one browser error, then a check for personal data in stored rows; delete old test rows
- ☐ `/code-review` + `/security-review`; merge `production` → `main` locally
- **Check:** all suites pass, the end-to-end run is clean, the reviews are clean

## ☐ Phase 6 — Deploy to a VPS (D17)
- ☐ Needed from the owner: VPS account and a domain (`app.<domain>`, `api.<domain>`)
- ☐ `docker-compose.prod.yml` with Caddy; only 80/443 published; dashboard built on the VPS with the production API URL
- ☐ Server hardening: firewall, SSH keys only, unattended upgrades, root-only `.env`, nightly `pg_dump`
- ☐ Migrations, project, keys, admin user
- ☐ Vercel env vars + **redeploy**; server reporter first, browser reporter after 24 h
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
