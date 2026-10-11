// The one API object the pages use. Picks mocks or the real backend at build time.

import { API_URL, REQUEST_TIMEOUT_MS } from './config.js';
import { createEndpoints, createHttp } from './http.js';

let unauthorizedHandler = null;

// AuthProvider registers this so any 401 mid-session sends the user to /login.
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

const onUnauthorized = () => {
  if (unauthorizedHandler) unauthorizedHandler();
};

function makeRequest() {
  // The env check is written inline (not via USE_MOCKS) so the bundler can fold it and
  // drop the mock module from builds without mocks.
  if (process.env.NEXT_PUBLIC_USE_MOCKS === 'true') {
    let mock = null;
    return async (...args) => {
      if (!mock) mock = (await import('./mock.js')).createMockRequest({ onUnauthorized });
      return mock(...args);
    };
  }
  return createHttp({ baseUrl: API_URL, timeoutMs: REQUEST_TIMEOUT_MS, onUnauthorized });
}

const request = makeRequest();

export const api = createEndpoints(request);
export { ApiError, errorMessage } from './http.js';
