// JSON-lines logger. Callers pass only safe fields: never bodies, keys, cookies or IPs.

function write(stream, level, msg, fields) {
  stream.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
}

const logger = {
  info: (msg, fields = {}) => write(process.stdout, 'info', msg, fields),
  warn: (msg, fields = {}) => write(process.stderr, 'warn', msg, fields),
  error: (msg, fields = {}) => write(process.stderr, 'error', msg, fields),
};

// Describes an error without its stack or any attached data (pg errors carry row values in `detail`).
function describeError(err) {
  return { err_name: err?.name, err_code: err?.code, err_message: String(err?.message ?? '').slice(0, 300) };
}

module.exports = { logger, describeError };
