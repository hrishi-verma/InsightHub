# InsightHub dashboard

Next.js 16 (App Router) + Tailwind dashboard for InsightHub error tracking. It reads the
dashboard API in `docs/CONTRACT.md` §4.

## Run

```bash
npm ci
# Against the real API (default http://localhost:8000):
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev      # http://127.0.0.1:3000
# Without a backend, with fake contract-shaped data:
NEXT_PUBLIC_USE_MOCKS=true npm run dev
npm test        # unit + security tests (node:test, no extra deps)
NEXT_PUBLIC_API_URL=https://api.example.com npm run build
```

Mock mode: any email with a 12+ character password signs in. Emails starting with `viewer`
get the viewer role. Mocks only work with `next dev`: a production build refuses to start with
`NEXT_PUBLIC_USE_MOCKS=true`, and mock code is not included in production bundles.

## Pages

- `/login`: email + password. The API sets an httpOnly `ih_session` cookie. The JS never sees it.
- `/dashboard`: totals, events per hour (browser vs server), top 5 issues, open alerts.
- `/issues`: status / source / environment filters, title search, sort, "load more".
- `/issues/[id]`: details, 24 h chart, recent events with stack traces. Admins can Resolve / Ignore / Reopen.
- `/alerts`: open (or acknowledged) alerts. Admins can Acknowledge.

Every page waits for `GET /auth/me` and goes to `/login` on 401. ML scores are shadow-only and
always labelled "Experimental: model trained on synthetic data".

## Security

- All error text (titles, messages, stacks, tags) is rendered as plain text. No `dangerouslySetInnerHTML`.
- Requests use `credentials: 'include'`, a 15 s timeout, and never follow redirects.
  State-changing requests are JSON (the API's CSRF rule).
- `proxy.js` sets a per-request nonce CSP (`script-src 'nonce-…' 'strict-dynamic'`,
  `frame-ancestors 'none'`, `connect-src` limited to the API origin). `next.config.js` adds
  `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options`, HSTS (production) and more.
- `next.config.js` fails the build if `NEXT_PUBLIC_API_URL` is missing or invalid, or is plain
  http to a non-local host.
- After login, `?next=` only accepts same-app relative paths (no open redirect).

## Layout

- `lib/http.js`: API client + §4 endpoints. `lib/mock.js`: fake API. `lib/api.js` picks one.
- `lib/security.js`: CSP builder, API URL check, safe redirect.
- `components/AuthProvider.js`: session + project state. `components/AppShell.js`: page guard.
- `tests/`: client behaviour, mock contract shapes, CSP / redirect rules, banned-pattern scan.
