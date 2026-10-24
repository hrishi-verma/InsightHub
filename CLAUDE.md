# CLAUDE.md — rules for working on InsightHub

InsightHub is an error-tracking and log-monitoring service. It is becoming a **production
service**: its first real traffic is error reports from the Education Enlightened website
(browser + API). Services: `backend/` (API, Node/Express), `processor-service/` (Kafka consumer),
`ml-engine/` (Flask), `frontend/` (Next.js dashboard), `database/` (TimescaleDB), `sdk-*`.

## Production app: security is a must

It receives data from a live website with real users. Every change must be production-grade and
secure **from the first commit**. "Quick fix now, secure later" is not acceptable.

- **Security beats convenience and speed.** If a task can't be done securely, stop and say so.
- **Treat all input as hostile:** every field of every request, every Kafka message, every DB row
  written by someone else. Validate at the boundary with strict schemas (reject unknown fields).
- **Fail closed.** Missing config, bad keys or unreachable dependencies mean deny or refuse to
  start, never "allow". No default passwords, tokens or keys in production paths.
- **No personal data.** Error reports must not carry emails, cookies, auth headers, IPs, tokens or
  query strings. Scrub on arrival as a second line of defense, even though senders scrub too.
- **Secrets** live only in env vars (`.env`, git-ignored). Never in code, logs, tests, docs or chat.
  API keys and session tokens are stored **hashed** (SHA-256) and shown once on creation.
- **Every endpoint has auth, a rate limit and a body-size limit.** SQL is parameterised only.
- **Outbound calls** have timeouts and never crash the caller.
- **Write tests for security behavior** (rejections, limits, scrubbing, auth), not only happy paths.
- **Before finishing,** review your own diff for injection, XSS, CSRF, auth bypass, data leaks,
  secrets, and missing limits. Report anything you're unsure about. Don't hide it.

## Working rules

1. **The contract is law:** `docs/CONTRACT.md` defines the event format, Kafka message, database
   schema and HTTP APIs. Build exactly to it. If it's wrong or missing something, **don't change
   it yourself**: say so in your report and ask the user/lead.
2. **Stay in your lane.** Only change files your brief (`docs/agents/<name>.md`) allows. Shared
   files (`docker-compose.yml`, `database/**`, `docs/CONTRACT.md`, root `README.md`) belong to the lead.
3. **Never push.** Commit only on your own branch. The lead merges.
4. **No drive-by refactors.** Leave the legacy `/api/logs` pipeline and `ml-engine/` alone unless
   your brief says otherwise. Nobody else is working on the ML model; changes to it go through the
   roadmap like any other work (D32).
5. **ML is shadow-only.** The model was trained on synthetic data. Its score may be stored and
   shown (labelled experimental) but must never decide anomalies or alerts.
6. **New dependencies** must be well-known and maintained, and must be listed in your report.
7. Match the surrounding code's style. Keep comments short, explaining *why*. Docs are plain language.

## Tracking work

- `docs/ROADMAP.md` is the plan: phases in order, one at a time, each ending with a **Check**.
- When a step or phase finishes, the lead ticks it in the ROADMAP and appends an entry to
  `docs/PROGRESS.md` (what changed, commits, the check command and its result, follow-ups).
- Every new decision gets a numbered entry in `docs/DECISIONS.md`. Never rewrite an old entry;
  supersede it.
- Agents don't edit these three files. They put the same information in their report.

## Shared local infrastructure

Several agents work at once, so **don't run `docker compose up` for the whole stack** from a
worktree. That would fight over ports. The lead keeps one shared stack running from the main
checkout: Postgres on `localhost:5432` and Kafka on `localhost:9093` (host listener).
Run your own service with `npm`/`node` against it. Don't change the shared database schema.
