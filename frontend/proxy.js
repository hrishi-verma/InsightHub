// Per-request CSP with a fresh nonce, so scripts need no 'unsafe-inline'.
// (Next 16 calls this file "proxy"; it used to be "middleware".)
// This is not an auth check: the session cookie belongs to the API, which enforces auth.

import { NextResponse } from 'next/server';
import { API_URL } from './lib/config.js';
import { apiOrigin, buildCsp } from './lib/security.js';

const dev = process.env.NODE_ENV === 'development';
const API_ORIGIN = apiOrigin(API_URL, { production: !dev });

export function proxy(request) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({ nonce, apiOrigin: API_ORIGIN, dev });

  // Next reads the nonce from the request's CSP header and adds it to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
