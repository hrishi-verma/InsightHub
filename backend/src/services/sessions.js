const { sha256Hex, randomToken } = require('../lib/crypto');
const { logger, describeError } = require('../lib/logger');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

function createSessionService(pool) {
  async function create(userId) {
    const token = randomToken();
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 millisecond')`,
      [sha256Hex(token), userId, SESSION_TTL_MS],
    );
    return token;
  }

  // Returns { id, email, role } for a live session of an enabled user, else null.
  async function lookup(token) {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return null;
    const hash = sha256Hex(token);
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.role, s.last_seen_at < now() - interval '1 minute' AS stale
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
      [hash],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.stale) {
      pool
        .query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [hash])
        .catch((err) => logger.warn('could not update session last_seen_at', describeError(err)));
    }
    return { id: row.id, email: row.email, role: row.role };
  }

  async function destroy(token) {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return;
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256Hex(token)]);
  }

  async function deleteExpired() {
    const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
    return rowCount;
  }

  return { create, lookup, destroy, deleteExpired };
}

module.exports = { createSessionService, SESSION_TTL_MS };
