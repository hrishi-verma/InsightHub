# dashboard report

Branch `agent/dashboard`. Status: **done against mocks**. The api agent's backend isn't merged
yet, so no page has run against the real API. Switching over means one env change (see "Known gaps").

## What I built

All in `frontend/`:

| File | What |
| --- | --- |
| `lib/http.js` | API client for contract §4: `credentials: 'include'`, 15 s timeout, `redirect: 'error'`, JSON bodies on every state change, error codes limited to the contract list, fixed user-facing messages, ids encoded as one path segment |
| `lib/mock.js` | Fake §4 API (same `request()` interface, so the real endpoint code runs on top of it). Validates params like the API (ranges, enums, `q` ≤ 200, 404s), enforces 401/403 by role. Some data is deliberately hostile (`<script>`, `<img onerror>`) |
| `lib/api.js` | Picks mock or real at build time. The mock is lazy-imported behind an inlined flag, so production bundles contain **no** mock code (checked by grepping the build) |
| `lib/security.js` | CSP builder, `NEXT_PUBLIC_API_URL` check, `safeNextPath` (no open redirect) |
| `proxy.js` | Per-request nonce CSP (Next 16's name for middleware) |
| `next.config.js` | Security headers; fails the build if mocks are on, or the API URL is missing, invalid, or plain http to a non-local host |
| `components/AuthProvider.js`, `AppShell.js` | Session + project state. Nothing protected renders until `GET /auth/me` succeeds; any 401 goes to `/login?next=…` |
| `app/login` | Real `POST /auth/login`, same message for any 401, password cleared on failure, no demo credentials |
| `app/dashboard` | Totals, events per hour (browser vs server, stacked, with a table view), top 5 issues, open alerts. Range 24 h / 3 d / 7 d, auto-refresh 60 s while visible |
| `app/issues` | Status / source / environment filters, debounced title search, sort, cursor "load more". Filters live in the URL (only known values accepted) |
| `app/issues/[id]` | Title, culprit, status, first/last seen, count, release, 24 h chart, events with stack in `<pre>`, path, http, tags, ML score labelled **"Experimental: model trained on synthetic data"**. Admin-only Resolve / Ignore / Reopen |
| `app/alerts` | Open alerts (toggle: acknowledged). Admin-only Acknowledge. The fake alert-rules UI is gone |
| Navbar | Overview / Issues / Alerts, project selector, user + role, Sign out (calls the API; if that fails, it says so instead of pretending) |

Removed: `lib/auth.js` (localStorage tokens), the legacy Logs/Analytics pages (hardcoded
`dev-token-123`), and the unused `Dashboard.js` / `LogStream.js`. The owner approved the deletion.
Also updated the Dockerfile (node 24, `npm ci`, multi-stage, runs as `node`, API URL as build arg),
added `.dockerignore`, and rewrote `frontend/README.md`.

How to run (from `frontend/`):
```bash
NEXT_PUBLIC_USE_MOCKS=true npm run dev          # 127.0.0.1:3000, fake data
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev   # real API
npm test
NEXT_PUBLIC_API_URL=https://api.example.com npm run build
```

## How I tested it

- `npm test`: **24/24 pass** (node:test, no extra dependencies):
  - client: `credentials: 'include'` on every call, no `Authorization` header, JSON on PATCH/POST
    (including logout), ids can't add path parts (`../../auth/logout?x` gets encoded), 401
    triggers the login redirect (except on login/me/logout), unknown error codes and body
    messages never reach the UI, non-JSON responses rejected, network/timeout errors handled.
  - security: `safeNextPath` rejects `//evil`, `/\evil`, `https://…`, `javascript:`, control
    characters and `/login` loops. Production CSP has nonce + `strict-dynamic`, no `unsafe-eval`,
    no inline scripts, `frame-ancestors 'none'`. The API URL check rejects credentials,
    `javascript:` and remote http in production.
  - mock vs contract: exact key sets for user, project, overview, hourly, Issue, events and
    alerts; cursor paging; 400 for bad params; 404 for unknown project/issue; viewer gets 403 on
    PATCH/ack; logout ends the session.
  - source scan: no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `localStorage`,
    `dev-token-123`, demo credentials or `Authorization` headers in `app/`, `components/`, `lib/`.
    The mock is only importable from `lib/api.js`, behind the env check.
- `next build` (run in a scratch copy, so the owner's dev server wasn't touched): passes. All
  routes are dynamic, which the nonce needs. With `NEXT_PUBLIC_USE_MOCKS=true`, without
  `NEXT_PUBLIC_API_URL`, or with `http://api.example.com`, the build **fails**, as intended.
  The built bundle has 0 files containing mock code.
- Owner's dev server (mocks), checked in Chrome: login redirect with `?next=`, Overview, Issues
  (filters, sort), Issue detail, Alerts. Hostile titles and stacks render as text. No CSP
  violations in the console. Response headers confirmed with curl. Two bugs found this way and
  fixed: "Any status" still filtered unresolved, and mock events weren't newest first.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Security review

Checked:
- **XSS:** all API text goes through JSX text nodes. Stacks are in `<pre>`, alert `details` are
  shown as key/value text, and links are built as `/issues/${encodeURIComponent(id)}`, so a
  value can never become a `javascript:` URL. The only inline `style` uses fixed colours. A strict
  nonce CSP backs this up.
- **Auth:** no tokens in JS or storage. The session is the API's httpOnly cookie. Pages render
  nothing protected until `/auth/me` succeeds. Admin buttons show only for `role === 'admin'`;
  the API is the real check (the mock enforces it too, and that's tested).
- **CSRF:** every state change is a JSON POST/PATCH with credentials, and the browser sends
  `Origin`. The API's Origin check is what protects these.
- **Open redirect:** `?next=` is validated. **Clickjacking:** `frame-ancestors 'none'` + `X-Frame-Options: DENY`.
- **Data leaks:** no `console.log` of responses (the old pages logged the token). `Referrer-Policy:
  no-referrer`, `connect-src` limited to the API origin, no production source maps,
  `X-Powered-By` off, `robots: noindex`.
- **Limits / timeouts:** 15 s request timeout, inputs have `maxLength` (search 200, email 254,
  password 128), page sizes within contract ranges, auto-refresh only while the tab is visible.

Unsure about / accepted:
- `style-src 'unsafe-inline'`: needed because Recharts and Next set inline `style` attributes.
  Styles can't run script, but this is weaker than a nonce for styles.
- In dev only, the CSP adds `'unsafe-eval'` (React dev tooling) and `ws:` (hot reload). Production has neither.
- The page guard is client-side. That's fine because the API enforces auth on every call. An
  unauthenticated visitor only gets the empty app shell.
- Mock mode keeps a fake session in `sessionStorage`. It's dev-only and can't be built for production.
- `frontend/.env.local` is tracked in git (it predates me). It only holds the public API URL,
  but it would be cleaner to git-ignore it and ship a `.env.example`. I didn't change `.gitignore`
  because it's a root file.

## Deviations from the contract / brief

- **Next.js 14.0.4 → 16.3.8.** `npm audit` showed critical advisories on every 14.x release,
  including RCE, a middleware bypass, and an XSS when using CSP nonces. 16.3.8 is the newest
  patch older than about 10 days (16.4.0 is 5 days old). It requires Node ≥ 20.9, hence the Dockerfile change.
- **CSP lives in `proxy.js`**, not only `next.config.js`, because a nonce must be generated per
  request. `next.config.js` still sends a baseline CSP (`frame-ancestors`, `object-src`,
  `base-uri`) plus the other headers. The proxy's full policy replaces it on page responses.
- `frontend/package.json` is now `"type": "module"`, so the configs, `proxy.js` and the tests share `lib/`.
- Contract questions asked of the lead and answered (the lead will fold them into the contract):
  logout sends `{}` as JSON; `acknowledged=true|false|omitted`; `environment` = has an event in
  that environment; ids are integers; `top_issues` = top 5 by events in the window, any status;
  `new_issues` uses the same window; `open_alerts` is all unacknowledged. The mock follows these.

## New dependencies

None added. Changed: `next` 14.0.4 → **16.3.8** (pinned), `react`/`react-dom` → ^18.3.1,
`recharts` → ^2.15.4. Removed: `socket.io-client` (unused). Tests use Node's built-in `node:test`.

## Requests for the lead

1. Write the §4 answers above into `docs/CONTRACT.md`.
2. Root `.gitignore`: consider ignoring `frontend/.env.local` (and add `frontend/.env.example`).
3. docker-compose: the frontend image now needs `NEXT_PUBLIC_API_URL` as a **build arg** and as
   a runtime env var (`next.config.js` checks it again on start and refuses to start without it).
4. Production: the dashboard and API must be same-site over https (agreed), and
   `DASHBOARD_ORIGINS` must list the dashboard origin exactly.

## Known gaps / next steps

- **Not yet run against the real API.** Once `agent/api` is merged: run without
  `NEXT_PUBLIC_USE_MOCKS`, with `NEXT_PUBLIC_API_URL=http://localhost:8000` and
  `DASHBOARD_ORIGINS` including `http://127.0.0.1:3000` / `http://localhost:3000`. Then walk
  through login → every page → admin actions → viewer account → logout.
- No browser end-to-end tests (Playwright would be a new dependency, so I didn't add it).
  Component behaviour was checked by hand in Chrome.
- `npm audit` (all deps) reports 7 dev-only findings in Tailwind 3's build tooling (`braces`,
  `postcss-selector-parser`, DoS on build input we control). The fix is a Tailwind 4 migration,
  as a separate change.
- No live updates (the old socket.io client was unused). The Overview polls every 60 s.
