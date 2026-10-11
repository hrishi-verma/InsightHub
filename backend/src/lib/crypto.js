const crypto = require('node:crypto');

const sha256Hex = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// 32 random bytes → 43 base64url chars.
const randomToken = () => crypto.randomBytes(32).toString('base64url');

module.exports = { sha256Hex, safeEqualHex, randomToken };
