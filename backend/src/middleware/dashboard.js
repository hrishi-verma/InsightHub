const { ApiError } = require('../lib/errors');
const { isJson, readCookie } = require('../lib/http');

const SESSION_COOKIE = 'ih_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Credentialed CORS only for DASHBOARD_ORIGINS. Other origins get no CORS headers.
function dashboardCors(dashboardOrigins) {
  const allowed = new Set(dashboardOrigins);
  return (req, res, next) => {
    const origin = req.get('Origin');
    res.vary('Origin');
    const ok = origin !== undefined && allowed.has(origin);
    if (ok) {
      res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
    }
    if (req.method === 'OPTIONS') {
      if (!ok) return next(new ApiError('FORBIDDEN', 'Origin not allowed'));
      res.set({
        'Access-Control-Allow-Methods': 'GET, POST, PATCH',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.status(204).end();
    }
    next();
  };
}

// CSRF defence: state-changing requests need a trusted Origin and a JSON content type
// (which a plain HTML form can't send). SameSite=Strict on the cookie is the second layer.
function requireTrustedOrigin(dashboardOrigins) {
  const allowed = new Set(dashboardOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('Origin');
    if (!origin || !allowed.has(origin)) return next(new ApiError('FORBIDDEN', 'Origin not allowed'));
    if (!isJson(req)) return next(new ApiError('FORBIDDEN', 'Content-Type must be application/json'));
    next();
  };
}

function requireSession(sessions) {
  return async (req, res, next) => {
    try {
      const user = await sessions.lookup(readCookie(req, SESSION_COOKIE));
      if (!user) throw new ApiError('UNAUTHORIZED', 'Not logged in');
      req.user = user;
      req.sessionToken = readCookie(req, SESSION_COOKIE);
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(new ApiError('FORBIDDEN', 'Admin role required'));
  next();
}

module.exports = { dashboardCors, requireTrustedOrigin, requireSession, requireAdmin, SESSION_COOKIE };
