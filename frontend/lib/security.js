// Pure security helpers shared by the app, next.config.js/proxy.js and the tests.

// Only same-app relative paths are allowed after login, so ?next= can't be an open redirect.
export function safeNextPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  // Backslashes and control characters can be normalised into "//host" by browsers.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return fallback;
  return value;
}

// Validates the API URL and returns its origin (used for CSP connect-src).
export function apiOrigin(raw, { production }) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('NEXT_PUBLIC_API_URL must be http(s)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_API_URL must not contain credentials, a query or a fragment');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (production && url.protocol !== 'https:' && !local) {
    throw new Error('NEXT_PUBLIC_API_URL must use https in production');
  }
  return url.origin;
}

// Full per-request CSP (set by proxy.js with a fresh nonce).
export function buildCsp({ nonce, apiOrigin: api, dev }) {
  const script = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];
  // React dev mode needs eval for its debugging features; never in production.
  if (dev) script.push(`'unsafe-eval'`);
  const connect = [`'self'`];
  if (api) connect.push(api);
  if (dev) connect.push('ws:');
  return [
    `default-src 'self'`,
    `script-src ${script.join(' ')}`,
    // Recharts and Next set inline style attributes. Styles can't run script.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src ${connect.join(' ')}`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

// Static baseline CSP from next.config.js. It covers responses the proxy doesn't touch.
// Browsers enforce every CSP header, so this can only tighten the per-request one.
export const BASELINE_CSP = `object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
