const { sha256Hex, safeEqualHex } = require('../lib/crypto');
const { logger, describeError } = require('../lib/logger');

const KEY_FORMAT = /^ih_(sk|pk)_[A-Za-z0-9_-]{43}$/;
const KIND_BY_TAG = { sk: 'secret', pk: 'public' };
const LAST_USED_EVERY_MS = 60_000;
const ORIGIN_CACHE_MS = 60_000;

function createApiKeyService(pool, { now = () => Date.now() } = {}) {
  const lastUsedWrites = new Map(); // key id -> ms of last write
  let originCache = { origins: null, expiresAt: 0 };

  // Returns { id, projectId, kind, allowedOrigins } or null for unknown/revoked/malformed keys.
  async function authenticate(rawKey, expectedKind) {
    const match = typeof rawKey === 'string' ? KEY_FORMAT.exec(rawKey) : null;
    if (!match || KIND_BY_TAG[match[1]] !== expectedKind) return null;
    const hash = sha256Hex(rawKey);
    const { rows } = await pool.query(
      `SELECT id, project_id, kind, key_hash, allowed_origins
         FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hash],
    );
    const row = rows[0];
    if (!row || !safeEqualHex(row.key_hash, hash) || row.kind !== expectedKind) return null;
    touch(row.id);
    return { id: row.id, projectId: row.project_id, kind: row.kind, allowedOrigins: row.allowed_origins };
  }

  // last_used_at at most once a minute per key, without blocking the request.
  function touch(id) {
    const t = now();
    if ((lastUsedWrites.get(id) ?? 0) > t - LAST_USED_EVERY_MS) return;
    lastUsedWrites.set(id, t);
    pool
      .query(
        `UPDATE api_keys SET last_used_at = now()
          WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
        [id],
      )
      .catch((err) => logger.warn('could not update api key last_used_at', describeError(err)));
  }

  // Origins of all active public keys, for answering CORS preflights. Cached briefly.
  async function isAllowedPublicOrigin(origin) {
    if (!originCache.origins || originCache.expiresAt <= now()) {
      const { rows } = await pool.query(
        `SELECT DISTINCT unnest(allowed_origins) AS origin
           FROM api_keys WHERE kind = 'public' AND revoked_at IS NULL`,
      );
      originCache = { origins: new Set(rows.map((r) => r.origin)), expiresAt: now() + ORIGIN_CACHE_MS };
    }
    return originCache.origins.has(origin);
  }

  return { authenticate, isAllowedPublicOrigin };
}

module.exports = { createApiKeyService, KEY_FORMAT };
