// Build-time config. NEXT_PUBLIC_* values are inlined by Next, so they must be read
// with literal `process.env.NAME` expressions.

// next.config.js refuses to build without a valid URL, so the fallback is only a dev aid.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

export const REQUEST_TIMEOUT_MS = 15000;
