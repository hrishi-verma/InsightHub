// Thin client for the dashboard API (contract §4). Kept free of React/Next imports so it
// can be unit-tested with node:test.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const KNOWN_CODES = new Set([
  'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE', 'RATE_LIMITED', 'UNAVAILABLE', 'INTERNAL',
]);

// User-facing text comes from this fixed table, never from the response body.
const MESSAGES = {
  VALIDATION_ERROR: 'The request was not valid.',
  UNAUTHORIZED: 'Your session has ended. Please sign in again.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'Not found.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  UNAVAILABLE: 'The service is temporarily unavailable.',
  NETWORK: 'Could not reach the InsightHub API.',
  TIMEOUT: 'The request timed out.',
  INTERNAL: 'Something went wrong on the server.',
};

export function errorMessage(err) {
  if (err instanceof ApiError) return MESSAGES[err.code] || MESSAGES.INTERNAL;
  return MESSAGES.INTERNAL;
}

const CODE_BY_STATUS = { 400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' };

function codeFrom(status, body) {
  const code = body && body.error && body.error.code;
  if (typeof code === 'string' && KNOWN_CODES.has(code)) return code;
  return CODE_BY_STATUS[status] || 'INTERNAL';
}

// Encodes one path segment so an id can never add path parts or a query string.
export function seg(value) {
  return encodeURIComponent(String(value));
}

export function buildQuery(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function createHttp({ baseUrl, fetchImpl = (...a) => fetch(...a), timeoutMs = 15000, onUnauthorized }) {
  async function request(method, path, { query, body, skipAuthRedirect = false } = {}) {
    const url = `${baseUrl}/api/v1${path}${buildQuery(query)}`;
    const headers = { Accept: 'application/json' };
    const init = {
      method,
      headers,
      // Session is an httpOnly cookie on the API origin; the JS never sees it.
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new ApiError(0, timedOut ? 'TIMEOUT' : 'NETWORK', timedOut ? 'timeout' : 'network error');
    }

    if (res.status === 204) return null;

    let data = null;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/json')) {
      try { data = await res.json(); } catch { data = null; }
    }

    if (!res.ok) {
      const code = codeFrom(res.status, data);
      if (res.status === 401 && !skipAuthRedirect && onUnauthorized) onUnauthorized();
      throw new ApiError(res.status, code, `HTTP ${res.status}`);
    }
    if (data === null || typeof data !== 'object') {
      throw new ApiError(res.status, 'INTERNAL', 'unexpected response');
    }
    return data;
  }
  return request;
}

// The §4 endpoints, on top of any `request(method, path, opts)` function.
export function createEndpoints(request) {
  return {
    login: (email, password) => request('POST', '/auth/login', { body: { email, password }, skipAuthRedirect: true }),
    logout: () => request('POST', '/auth/logout', { body: {}, skipAuthRedirect: true }),
    me: () => request('GET', '/auth/me', { skipAuthRedirect: true }),
    projects: () => request('GET', '/projects'),
    overview: (project, hours = 24) => request('GET', '/overview', { query: { project, hours } }),
    issues: ({ project, status, source, environment, q, sort, cursor, limit }) =>
      request('GET', '/issues', { query: { project, status, source, environment, q, sort, cursor, limit } }),
    issue: (id) => request('GET', `/issues/${seg(id)}`),
    issueEvents: (id, { cursor, limit } = {}) => request('GET', `/issues/${seg(id)}/events`, { query: { cursor, limit } }),
    setIssueStatus: (id, status) => request('PATCH', `/issues/${seg(id)}`, { body: { status } }),
    alerts: (project, acknowledged = false) => request('GET', '/alerts', { query: { project, acknowledged } }),
    ackAlert: (id) => request('POST', `/alerts/${seg(id)}/ack`, { body: {} }),
  };
}
