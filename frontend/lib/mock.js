// Fake §4 API for working before the backend is ready. Used only when
// NEXT_PUBLIC_USE_MOCKS=true, and next.config.js refuses production builds with it on.
// It speaks the same request(method, path, opts) interface as lib/http.js, so the
// real endpoint definitions run unchanged on top of it.

import { ApiError } from './http.js';

const HOUR = 3600 * 1000;
const PROJECTS = [{ id: 1, slug: 'education-enlightened', name: 'Education Enlightened' }];

// Small deterministic PRNG so the mock data is stable across reloads.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Some entries are deliberately hostile: they must render as inert text.
const TEMPLATES = [
  ['server', 'PrismaClientKnownRequestError', 'Unique constraint failed on the fields: (`email`)', 'register (backend/services/auth.service.js)', '/api/auth/register'],
  ['browser', 'TypeError', "Cannot read properties of undefined (reading 'map')", 'CourseList (src/pages/Courses.jsx)', '/courses'],
  ['browser', 'ChunkLoadError', 'Loading chunk <n> failed.', 'loadChunk (src/main.jsx)', '/lessons/<n>'],
  ['server', 'Error', 'Request timed out after <n>ms calling payments provider', 'createCheckout (backend/services/payments.js)', '/api/checkout'],
  ['browser', 'Error', '<img src=x onerror="alert(\'xss\')"> rendered as text', 'renderMarkdown (src/components/Markdown.jsx)', '/blog/<str>'],
  ['server', 'ValidationError', '"title" is required', 'validateBody (backend/middleware/validate.js)', '/api/courses'],
  ['browser', 'ReferenceError', 'gtag is not defined', 'trackPage (src/analytics.js)', '/'],
  ['server', 'JsonWebTokenError', 'jwt malformed', 'authenticate (backend/middleware/auth.js)', '/api/me'],
  ['browser', 'SecurityError', "<script>document.location='https://evil.example'</script>", 'Editor (src/components/Editor.jsx)', '/editor'],
  ['server', 'PrismaClientInitializationError', "Can't reach database server at `[ip]`:5432", 'connect (backend/db.js)', '/api/health'],
  ['browser', 'TypeError', 'Failed to fetch', 'apiClient (src/lib/api.js)', '/dashboard'],
  ['server', 'RangeError', 'Invalid time value', 'formatDate (backend/utils/date.js)', '/api/reports'],
];

function buildState() {
  const r = rng(42);
  const now = Date.now();
  const statuses = ['unresolved', 'unresolved', 'unresolved', 'resolved', 'ignored'];
  const issues = [];
  for (let i = 0; i < 36; i++) {
    const [source, errorType, message, culprit, path] = TEMPLATES[i % TEMPLATES.length];
    const variant = Math.floor(i / TEMPLATES.length);
    const firstSeen = now - Math.floor(r() * 6 * 24 * HOUR) - HOUR;
    const lastSeen = Math.min(now - Math.floor(r() * 3 * HOUR), now);
    const msg = variant ? `${message} (variant ${variant + 1})` : message;
    issues.push({
      id: i + 1,
      project: PROJECTS[0].slug,
      fingerprint: (i + 1).toString(16).padStart(8, '0').repeat(8),
      source,
      error_type: errorType,
      title: `${errorType}: ${msg}`.slice(0, 200),
      culprit: source === 'server' && i % 4 === 0 ? `POST ${path}` : culprit,
      status: statuses[i % statuses.length],
      first_seen: new Date(Math.min(firstSeen, lastSeen)).toISOString(),
      last_seen: new Date(lastSeen).toISOString(),
      event_count: 1 + Math.floor(r() ** 3 * 900),
      last_release: i % 6 === 5 ? null : ['07b4c36', 'a1f9e02', '3c5d7e8'][i % 3],
      _path: path,
      _message: msg,
      _hourlyWeight: 0.2 + r() * 2,
    });
  }
  const alerts = [
    { id: 1, kind: 'spike', issue_id: 2, details: { count_5m: 48, threshold: 12 }, created_at: new Date(now - 20 * 60 * 1000).toISOString(), acknowledged_at: null },
    { id: 2, kind: 'new_issue', issue_id: 5, details: {}, created_at: new Date(now - 2 * HOUR).toISOString(), acknowledged_at: null },
    { id: 3, kind: 'regression', issue_id: 4, details: { release: '3c5d7e8' }, created_at: new Date(now - 5 * HOUR).toISOString(), acknowledged_at: null },
    { id: 4, kind: 'new_issue', issue_id: 9, details: {}, created_at: new Date(now - 30 * HOUR).toISOString(), acknowledged_at: new Date(now - 29 * HOUR).toISOString() },
  ];
  return { issues, alerts };
}

let state = null;
function db() {
  if (!state) state = buildState();
  return state;
}

// Mock session lives in sessionStorage (or memory under node). It is never a real credential.
const SESSION_KEY = 'ih_mock_session';
let memorySession = null;
function getSession() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    }
  } catch { /* storage blocked: fall through */ }
  return memorySession;
}
function setSession(user) {
  memorySession = user;
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (user) sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else sessionStorage.removeItem(SESSION_KEY);
    }
  } catch { /* ignore */ }
}

const publicIssue = ({ _path, _message, _hourlyWeight, ...rest }) => ({ ...rest });
const clone = (v) => JSON.parse(JSON.stringify(v));
const encodeCursor = (n) => btoa(`o:${n}`);
function decodeCursor(c) {
  if (c === undefined || c === null || c === '') return 0;
  try {
    const m = /^o:(\d+)$/.exec(atob(String(c)));
    if (m) return Number(m[1]);
  } catch { /* fall through */ }
  throw new ApiError(400, 'VALIDATION_ERROR', 'bad cursor');
}

function intParam(v, def, min, max) {
  if (v === undefined || v === null || v === '') return def;
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new ApiError(400, 'VALIDATION_ERROR', 'bad number');
  const n = Number(s);
  if (n < min || n > max) throw new ApiError(400, 'VALIDATION_ERROR', 'out of range');
  return n;
}

function oneOf(v, allowed) {
  if (v === undefined || v === null || v === '') return undefined;
  if (!allowed.includes(v)) throw new ApiError(400, 'VALIDATION_ERROR', 'bad enum');
  return v;
}

function requireProject(slug) {
  const p = PROJECTS.find((x) => x.slug === slug);
  if (!p) throw new ApiError(404, 'NOT_FOUND', 'not found');
  return p;
}

function findIssue(id) {
  const issue = db().issues.find((i) => String(i.id) === String(id));
  if (!issue) throw new ApiError(404, 'NOT_FOUND', 'not found');
  return issue;
}

function hourStart(t) {
  return Math.floor(t / HOUR) * HOUR;
}

function hourlyFor(issues, hours) {
  const r = rng(hours * 7 + issues.length);
  const end = hourStart(Date.now());
  const out = [];
  for (let h = hours - 1; h >= 0; h--) {
    const t = end - h * HOUR;
    let browser = 0;
    let server = 0;
    for (const i of issues) {
      const n = Math.floor(r() * 3 * i._hourlyWeight);
      if (i.source === 'browser') browser += n; else server += n;
    }
    out.push({ hour: new Date(t).toISOString(), browser, server });
  }
  return out;
}

function eventsFor(issue) {
  const r = rng(issue.id * 97);
  const count = Math.min(issue.event_count, 45);
  const last = Date.parse(issue.last_seen);
  const events = [];
  let occurred = last;
  for (let n = 0; n < count; n++) {
    if (n > 0) occurred -= Math.floor(5 + r() * 90) * 60 * 1000;
    const id = `${issue.id.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    const fn = issue.culprit.split(' ')[0];
    const file = (/\((.*)\)/.exec(issue.culprit) || [, 'src/index.js'])[1];
    const ev = {
      event_id: id,
      occurred_at: new Date(occurred).toISOString(),
      source: issue.source,
      environment: n % 7 === 6 ? 'preview' : 'production',
      level: n % 5 === 0 ? 'fatal' : 'error',
      error_type: issue.error_type,
      message: issue._message,
      stack: `${issue.error_type}: ${issue._message}\n    at ${fn} (${file}:${12 + n}:7)\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at <script>alert(1)</script> (evil.js:1:1)`,
      release: issue.last_release || undefined,
      url_path: issue._path.replace('<n>', String(n + 1)).replace('<str>', 'hello-world'),
      runtime: issue.source === 'server' ? 'node 24.1' : 'Chrome 140',
      received_at: new Date(occurred + 800).toISOString(),
      // About half the events have a shadow score, as with ML_SHADOW=on.
      ml_score: n % 2 === 0 ? Math.round(r() * 1000) / 1000 : null,
      ml_model_version: n % 2 === 0 ? 'synthetic-v0' : null,
    };
    if (issue.source === 'server') ev.http = { method: 'POST', status: 500, route: issue._path };
    if (n % 3 === 0) ev.tags = { feature: 'checkout', region: 'eu' };
    events.push(ev);
  }
  return events;
}

function requireUser() {
  const user = getSession();
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'unauthorized');
  return user;
}

function requireAdmin() {
  const user = requireUser();
  if (user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'forbidden');
  return user;
}

function route(method, path, query, body) {
  let m;
  if (method === 'POST' && path === '/auth/login') {
    const { email, password } = body || {};
    // Mock rule: any email, password 12–128 chars (same length rule as real users).
    // An email starting with "viewer" gets the viewer role, so both roles can be tried.
    if (typeof email !== 'string' || typeof password !== 'string' || !email.includes('@')
      || password.length < 12 || password.length > 128) {
      throw new ApiError(401, 'UNAUTHORIZED', 'invalid credentials');
    }
    const user = { id: 1, email: email.toLowerCase(), role: email.toLowerCase().startsWith('viewer') ? 'viewer' : 'admin' };
    setSession(user);
    return { user };
  }
  if (method === 'POST' && path === '/auth/logout') {
    requireUser();
    setSession(null);
    return null;
  }
  if (method === 'GET' && path === '/auth/me') return { user: requireUser() };

  requireUser();

  if (method === 'GET' && path === '/projects') return { projects: PROJECTS };

  if (method === 'GET' && path === '/overview') {
    requireProject(query.project);
    const hours = intParam(query.hours, 24, 1, 168);
    const { issues, alerts } = db();
    const hourly = hourlyFor(issues.filter((i) => i.status !== 'ignored'), hours);
    const since = Date.now() - hours * HOUR;
    return {
      events_total: hourly.reduce((s, h) => s + h.browser + h.server, 0),
      new_issues: issues.filter((i) => Date.parse(i.first_seen) >= since).length,
      unresolved_issues: issues.filter((i) => i.status === 'unresolved').length,
      open_alerts: alerts.filter((a) => !a.acknowledged_at).length,
      hourly,
      top_issues: [...issues].filter((i) => i.status === 'unresolved')
        .sort((a, b) => b.event_count - a.event_count).slice(0, 5).map(publicIssue),
    };
  }

  if (method === 'GET' && path === '/issues') {
    requireProject(query.project);
    const status = oneOf(query.status, ['unresolved', 'resolved', 'ignored']);
    const source = oneOf(query.source, ['browser', 'server']);
    const environment = oneOf(query.environment, ['production', 'preview', 'development']);
    const sort = oneOf(query.sort, ['last_seen', 'first_seen', 'event_count']) || 'last_seen';
    const limit = intParam(query.limit, 25, 1, 100);
    const q = query.q ? String(query.q) : '';
    if (q.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'q too long');
    const offset = decodeCursor(query.cursor);
    let list = db().issues.filter((i) => (!status || i.status === status) && (!source || i.source === source)
      && (!q || i.title.toLowerCase().includes(q.toLowerCase())));
    // Mock events are production except a few previews; only "development" filters everything out.
    if (environment === 'development') list = [];
    list.sort((a, b) => (sort === 'event_count'
      ? b.event_count - a.event_count
      : Date.parse(b[sort]) - Date.parse(a[sort])));
    const page = list.slice(offset, offset + limit);
    return {
      issues: page.map(publicIssue),
      next_cursor: offset + limit < list.length ? encodeCursor(offset + limit) : null,
    };
  }

  if ((m = /^\/issues\/([^/]+)$/.exec(path))) {
    const issue = findIssue(decodeURIComponent(m[1]));
    if (method === 'GET') {
      const hourly = hourlyFor([issue], 24).map((h) => ({ hour: h.hour, count: h.browser + h.server }));
      return { issue: publicIssue(issue), hourly };
    }
    if (method === 'PATCH') {
      requireAdmin();
      const keys = Object.keys(body || {});
      if (keys.length !== 1 || keys[0] !== 'status') throw new ApiError(400, 'VALIDATION_ERROR', 'unknown field');
      const status = oneOf(body.status, ['unresolved', 'resolved', 'ignored']);
      if (!status) throw new ApiError(400, 'VALIDATION_ERROR', 'status required');
      issue.status = status;
      return { issue: publicIssue(issue) };
    }
  }

  if (method === 'GET' && (m = /^\/issues\/([^/]+)\/events$/.exec(path))) {
    const issue = findIssue(decodeURIComponent(m[1]));
    const limit = intParam(query.limit, 20, 1, 50);
    const offset = decodeCursor(query.cursor);
    const all = eventsFor(issue);
    return {
      events: all.slice(offset, offset + limit),
      next_cursor: offset + limit < all.length ? encodeCursor(offset + limit) : null,
    };
  }

  if (method === 'GET' && path === '/alerts') {
    requireProject(query.project);
    const acknowledged = oneOf(query.acknowledged, ['true', 'false']);
    const { alerts, issues } = db();
    return {
      alerts: alerts
        .filter((a) => acknowledged === undefined || Boolean(a.acknowledged_at) === (acknowledged === 'true'))
        .map(({ issue_id, ...a }) => {
          const i = issues.find((x) => x.id === issue_id);
          return { ...a, issue: { id: i.id, title: i.title } };
        }),
    };
  }

  if (method === 'POST' && (m = /^\/alerts\/([^/]+)\/ack$/.exec(path))) {
    requireAdmin();
    const alert = db().alerts.find((a) => String(a.id) === decodeURIComponent(m[1]));
    if (!alert) throw new ApiError(404, 'NOT_FOUND', 'not found');
    if (!alert.acknowledged_at) alert.acknowledged_at = new Date().toISOString();
    const { issue_id, ...rest } = alert;
    const i = db().issues.find((x) => x.id === issue_id);
    return { alert: { ...rest, issue: { id: i.id, title: i.title } } };
  }

  throw new ApiError(404, 'NOT_FOUND', 'not found');
}

export function createMockRequest({ onUnauthorized, latencyMs = 250 } = {}) {
  return async function request(method, path, { query = {}, body, skipAuthRedirect = false } = {}) {
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs * (0.5 + Math.random())));
    const q = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
    try {
      const res = route(method, path, q, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
      return res === null ? null : clone(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && !skipAuthRedirect && onUnauthorized) onUnauthorized();
      throw e;
    }
  };
}

// Test helper: reset data and session.
export function resetMock() {
  state = null;
  setSession(null);
}
