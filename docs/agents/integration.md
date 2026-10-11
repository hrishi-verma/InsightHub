# Brief: `integration` agent (works in Education Enlightened)

**Goal:** Education Enlightened reports unexpected errors to InsightHub **in addition to Sentry**,
from both its API and its website, without weakening security or privacy.

**Repo:** you run inside a worktree of Education Enlightened on branch
`feature/insighthub-reporter`. Its `CLAUDE.md` rules apply in full (read them, plus
`docs/PROJECT.md`, `docs/DECISIONS.md` (at least D25, D26, D43, D56), and `backend/README.md`).
**The event format is defined in InsightHub's contract:**
`/Users/rishi/Hrishikesh Docs/Archive_documents/Insights hub/InsightHub/docs/CONTRACT.md` §1. Read it. Don't edit it.

**You may change only:**
- `backend/utils/insighthub.ts` (new): the server reporter
- `backend/middleware/error.ts`: call the reporter next to Sentry. **Sentry code stays as it is**
- `backend/config/env.ts`: new optional vars
- `src/lib/insighthub.ts` (new): the browser reporter
- `src/main.tsx`: lazy-load it the same way Sentry is loaded
- `vite.config.ts`: add the InsightHub origin to `connect-src`, only when configured
- `.env.example`, `backend/.env.example`; tests next to the new files
- docs: a new decision **D71** in `docs/DECISIONS.md`, plus short additions to `docs/PROJECT.md`,
  `backend/README.md` (env table) and `docs/TODO.md`

## Build

**Server (`backend/utils/insighthub.ts`)**
- Env: `INSIGHTHUB_URL` (https required in production; http only for localhost in development)
  and `INSIGHTHUB_SECRET_KEY` (`ih_sk_…`). **Both or neither**: enforce in `env.ts`'s
  `superRefine`. Off when unset.
- Called only for unexpected 500 errors (where Sentry is called). Builds one contract Event:
  `source: "server"`, `error_type` = constructor name, scrubbed `message` and `stack`,
  `url_path` = `req.path` (never the query), `http.{method,status,route}`, `release` from
  `VERCEL_GIT_COMMIT_SHA` (first 12 chars) if set, `runtime` = `node <version>`, `environment`
  from `NODE_ENV`/`VERCEL_ENV`. **Never** include body, headers, cookies, user, IP or query.
- Send with `fetch` (built in, no new dependency), `AbortSignal.timeout(2000)`, via
  `afterResponse()` so it finishes on Vercel without delaying the response. Failures are swallowed
  (one `console.warn`, without the key). It must never throw into the request.

**Browser (`src/lib/insighthub.ts`)**
- Env: `VITE_INSIGHTHUB_URL` + `VITE_INSIGHTHUB_KEY` (public `ih_pk_…`). Off unless both are set.
  Loaded lazily from `main.tsx` like Sentry.
- Listens to `window` `error` and `unhandledrejection`. Sends the contract Event with
  `source: "browser"`, `url_path` = `location.pathname` (never search or hash, since links carry one-time
  tokens), scrubbed message and stack, `runtime` = browser name + major version only.
- Limits: max 10 events per page load, drop duplicates (same type + message) within 60 s,
  `fetch` with `keepalive: true`, no credentials, 2 s timeout. Ignore errors from browser
  extensions (`chrome-extension://`, `moz-extension://` in the stack).
- `vite.config.ts`: add `origin(process.env.VITE_INSIGHTHUB_URL)` to `connect-src`, the same way as Sentry.

**Scrubbing (both sides, shared logic is fine):** emails, bearer/basic credentials, JWTs, long
hex/base64 tokens, IPs, URL query strings and fragments. Same patterns as contract §1.

## Tests (required)
Vitest, with `fetch` mocked:
- off when env is unset (no fetch call); env validation rejects one-without-the-other and http in production
- the event matches the contract (strict field list); no query, body, cookies or headers ever appear
- each scrubbing pattern; payload limits respected (truncate to contract maximums)
- a failing or slow InsightHub never breaks the 500 response (timeout honoured); Sentry is still called
- browser: rate cap of 10, dedupe, extension errors ignored
- CSP includes the InsightHub origin only when configured

**Don't** start Education Enlightened's own Postgres (`backend/docker-compose.yml`). Its port
5432 is taken by InsightHub's shared database. Unit tests don't need it.

## Done when
All of the project's checks pass (`CLAUDE.md` → "Checks that must pass"; a11y not needed),
D71 is recorded, you've done a self-review of security and privacy, and a report is written
to `docs/insighthub-integration-report.md` **in this worktree** (same template as InsightHub's
`docs/agents/README.md`) and committed on the branch. Never push.
