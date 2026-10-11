const { sha256Hex, safeEqualHex } = require('../lib/crypto');

// Legacy /api/logs auth. No token configured means the legacy routes are switched off (fail closed).
function createServiceTokenAuth(serviceToken) {
  const expected = serviceToken ? sha256Hex(`Bearer ${serviceToken}`) : null;
  return (req, res, next) => {
    if (!expected) return res.status(503).json({ error: 'Legacy log API is not configured' });
    const header = req.headers['authorization'];
    // Comparing hashes keeps the check constant-time regardless of header length.
    if (typeof header !== 'string' || !safeEqualHex(sha256Hex(header), expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

module.exports = { createServiceTokenAuth };
