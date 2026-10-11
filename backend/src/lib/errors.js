// One error type and one JSON shape for every API response (contract §1 "Error shape").

const STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
};

class ApiError extends Error {
  constructor(code, message, { retryAfter } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.retryAfter = retryAfter;
  }
}

function sendError(res, code, message, retryAfter) {
  if (retryAfter !== undefined) res.set('Retry-After', String(retryAfter));
  res.status(STATUS[code]).json({ error: { code, message } });
}

module.exports = { ApiError, sendError, STATUS };
