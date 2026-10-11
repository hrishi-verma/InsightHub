import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';
import { BASELINE_CSP, apiOrigin } from './lib/security.js';

export default function config(phase) {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  const production = !dev;

  // Fail closed: a production build must point at a real API and must not ship mocks.
  if (production && process.env.NEXT_PUBLIC_USE_MOCKS === 'true') {
    throw new Error('NEXT_PUBLIC_USE_MOCKS=true is only allowed with `next dev`');
  }
  if (production && !process.env.NEXT_PUBLIC_API_URL) {
    throw new Error('NEXT_PUBLIC_API_URL is required for production builds');
  }
  // Throws on a malformed URL (or http to a non-local host in production).
  apiOrigin(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000', { production });

  const securityHeaders = [
    { key: 'Content-Security-Policy', value: BASELINE_CSP },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ];
  if (production) {
    securityHeaders.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
  }

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    productionBrowserSourceMaps: false,
    // Always defined, so the bundler inlines it and drops mock code from production builds.
    env: { NEXT_PUBLIC_USE_MOCKS: dev && process.env.NEXT_PUBLIC_USE_MOCKS === 'true' ? 'true' : 'false' },
    async headers() {
      return [{ source: '/:path*', headers: securityHeaders }];
    },
  };
}
