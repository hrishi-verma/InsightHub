# Legacy

Code from the original log-monitoring system. It's kept because the legacy `/api/logs` pipeline
still runs, but nothing new is built on it (see `docs/DECISIONS.md` D1, D19).

| Folder | What it is |
| --- | --- |
| `sdk-js/` | Node/browser client that batches logs to `POST /api/logs` |
| `sdk-python/` | Python client for the same endpoint |

These SDKs **do not** speak the error-tracking contract (`/api/v1/events`). Education
Enlightened uses its own reporter, built to `docs/CONTRACT.md` §1. The legacy endpoints need
`SERVICE_TOKEN` set on the backend; without it they answer 503.

The original design document is in [`docs/archive/original-design.md`](../docs/archive/original-design.md).
