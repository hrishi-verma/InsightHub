# Brief: `dashboard` agent (driven by the owner)

**Goal:** turn `frontend/` into a secure error-tracking dashboard on the contract §4 API.

**You may change:** `frontend/**`, `docs/agents/reports/dashboard.md`. Nothing else.

## Build

1. **Real login.** `/login` calls `POST /api/v1/auth/login`. All requests use
   `credentials: 'include'`. No tokens in `localStorage`: the session is an httpOnly cookie the
   JS can't see. Remove the mock token and the "Demo credentials" text. Protect every page: if
   `GET /auth/me` returns 401, go to `/login`. Logout calls the API.
2. **Remove the hardcoded `dev-token-123`** from every page. The old Logs and Analytics pages
   use the legacy API with that token. Hide them from the nav and delete the token (or delete the pages).
3. **Pages:**
   - **Overview** `/dashboard`: totals, events per hour (browser vs server), top 5 issues, open alerts count.
   - **Issues** `/issues`: list with status / source / environment filters, search, sort, and "load more" (cursor).
   - **Issue detail** `/issues/[id]`: title, culprit, first/last seen, count, 24 h chart, recent
     events with the stack trace (in a `<pre>`), release, path. Admins can Resolve / Ignore / Reopen.
   - **Alerts** `/alerts`: open alerts with an Acknowledge button (admins). Replace the fake alert-rules UI.
   - A project selector (only `education-enlightened` today).
   - Where an event has `ml_score`, show it labelled **"Experimental: model trained on synthetic data"**.
4. **Security:** never use `dangerouslySetInnerHTML`. Render all error text as plain text (it's
   attacker-controllable). Add security headers in `next.config.js` (CSP, `frame-ancestors 'none'`,
   `X-Content-Type-Options`, `Referrer-Policy`). The API URL comes from `NEXT_PUBLIC_API_URL`.
   Only admins see admin buttons, and the API enforces it too.
5. **States:** loading, empty ("No errors yet 🎉") and error states on every page. Accessible
   (labels, focus, contrast). Keep the existing dark Tailwind style.

## Working before the API is ready
The `api` agent builds the backend in parallel. Until it's ready, use a small mock layer built
from the contract's response shapes (`frontend/lib/mock.js`, on only when
`NEXT_PUBLIC_USE_MOCKS=true`), then switch to the real API on `:8000`.

## Done when
`npm run build` passes, every page works against the real API (or mocks if the API isn't
merged yet; say which), and `docs/agents/reports/dashboard.md` is written and committed.
