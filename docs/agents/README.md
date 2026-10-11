# Agent team — how this works

One **lead** (the orchestrating Claude session) plus four agents, each in its own terminal and
its own git worktree (a separate copy of the repo on its own branch).

| Agent | Worktree | Branch | Owns | Driven by |
| --- | --- | --- | --- | --- |
| `api` | `InsightHub/.worktrees/api` | `agent/api` | `backend/**` | lead |
| `processor` | `InsightHub/.worktrees/processor` | `agent/processor` | `processor-service/**` | lead |
| `dashboard` | `InsightHub/.worktrees/dashboard` | `agent/dashboard` | `frontend/**` | **the owner (you)** |
| `integration` | `Education enlightened/.worktrees/insighthub-reporter` | `feature/insighthub-reporter` | the reporter in Education Enlightened | lead |

## Rules every agent follows

1. Read `CLAUDE.md`, `docs/CONTRACT.md`, then your brief. The contract is law.
2. Only touch the files your brief allows. Need a change elsewhere, or in the contract? Don't
   make it yourself. Put it under "Requests for the lead" in your report.
3. Use the shared infrastructure (see `CLAUDE.md`). Never `docker compose up` the whole stack.
4. Commit in small, meaningful steps on your branch. **Never push. Never merge.**
5. Done means: tests pass, your own security review is done, and the report is written to
   `docs/agents/reports/<name>.md` and committed.

## Report template (`docs/agents/reports/<name>.md`)

```markdown
# <name> report
## What I built        (files, endpoints, how to run)
## How I tested it      (commands + results, including security tests)
## Security review      (what I checked, anything I'm unsure about)
## Deviations from the contract / brief   (should be "none"; if not, why)
## New dependencies     (name, version, why)
## Requests for the lead
## Known gaps / next steps
```

## Shared local resources

| Resource | Where | Notes |
| --- | --- | --- |
| Postgres | `localhost:5432`, user `postgres` | Password: `POSTGRES_PASSWORD` in `InsightHub/.env` (main checkout). Copy it into your worktree's git-ignored `.env`. **Never print it** |
| Main database | `insighthub` | Shared. Used for the end-to-end run. Don't wipe it |
| Test databases | `insighthub_test_api`, `insighthub_test_processor` | One per agent, schema already loaded. Your tests may clear these tables freely |
| Kafka | `localhost:9093` | Topic `error-events` auto-creates |
| Ports | API `8000`, dashboard `3000`, ML `5000` | The Education Enlightened site is `5173`, its API `4000` |
