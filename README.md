# InsightHub

Error tracking for the Education Enlightened website. The site's browser code and API send a
report whenever something unexpected breaks. InsightHub scrubs personal data out of each report,
groups the reports into issues, raises alerts for new issues, spikes and regressions, and shows
everything on a dashboard. It runs alongside Sentry rather than replacing it.

It is becoming a production service. Read [`CLAUDE.md`](CLAUDE.md) before changing anything:
security rules apply from the first commit.

## How it fits together

```
Education Enlightened (browser + API)
        │  POST /api/v1/events  (API key, scrubbed, rate-limited)
        ▼
   backend ──▶ Kafka "error-events" ──▶ processor ──▶ Postgres / TimescaleDB
      ▲                                     │ (optional, shadow only)
      │  login + read API                   ▼
   dashboard                            ml-engine
```

| Folder | What it is | Docs |
| --- | --- | --- |
| `backend/` | API: event ingestion, dashboard API, admin scripts (Node/Express) | [README](backend/README.md) |
| `processor-service/` | Kafka consumer: grouping, storage, alert rules (Node) | [README](processor-service/README.md) |
| `frontend/` | Dashboard (Next.js 16) | [README](frontend/README.md) |
| `database/` | Schema and migrations (Postgres + TimescaleDB) | [README](database/README.md) |
| `ml-engine/` | Anomaly model (Flask). Experimental, shadow-only | [README](ml-engine/README.md) |
| `legacy/` | Old log SDKs for the legacy `/api/logs` pipeline | [README](legacy/README.md) |
| `docs/` | Contract, decisions, roadmap, progress, agent briefs | see below |

## Docs

| File | Read it for |
| --- | --- |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | The exact event format, Kafka message, schema and HTTP APIs. **The contract is law** |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What's left to do, phase by phase |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | What has been done and how it was checked |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why things are the way they are |
| [`docs/agents/`](docs/agents/README.md) | How the agent team works, their briefs and reports |
| [`docs/archive/`](docs/archive/original-design.md) | The original log-monitoring design (historical) |

## Run it locally

```bash
cp .env.example .env          # set POSTGRES_PASSWORD (openssl rand -base64 24)
docker compose up -d          # Postgres, Kafka, backend, processor, ML engine, dashboard
```

Then create a dashboard user and an ingestion key (each key is printed once):

```bash
cd backend
npm run create-user -- --email you@example.com --role admin
npm run create-key  -- --project education-enlightened --kind secret
```

The dashboard is at http://localhost:3000 and the API at http://localhost:8000. All ports bind to
`127.0.0.1` only.

The dashboard's API URL (`NEXT_PUBLIC_API_URL`) is **baked into the browser code at build time**.
To change it, rebuild the image (`docker compose build frontend`). Restarting isn't enough.

Working from an agent worktree? Don't start the whole stack. Run your one service with `npm`
against the lead's shared Postgres and Kafka (see `CLAUDE.md`).

## Tests

Each service has its own suite: `npm test` in `backend/`, `processor-service/` and `frontend/`.
The backend and processor suites need the test databases described in
[`docs/agents/README.md`](docs/agents/README.md).

## Legacy log pipeline

The original log-monitoring endpoints (`/api/logs`, Kafka topic `logs`, tables `logs` and
`log_aggregates`) still run, unchanged. They're off unless `SERVICE_TOKEN` is set. Nothing new
is built on them. See [`legacy/README.md`](legacy/README.md).

## License

[MIT](LICENSE)
