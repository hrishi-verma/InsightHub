// Usage: npm run create-key -- --project education-enlightened --kind public --origin https://example.com
// Prints the key once. Only its SHA-256 hash is stored.
const { parseArgs } = require('node:util');
const { runScript, fail } = require('./lib');
const { parseOrigin } = require('../src/config');
const { sha256Hex, randomToken } = require('../src/lib/crypto');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function checkOrigin(origin, nodeEnv) {
  const url = parseOrigin(origin);
  if (!url) throw fail(`--origin must be an exact origin like https://example.com (got an invalid value)`);
  if (url.protocol === 'https:') return origin;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) && nodeEnv === 'development') return origin;
  throw fail('--origin must use https (http://localhost is allowed only when NODE_ENV=development)');
}

runScript(async (pool) => {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      kind: { type: 'string' },
      origin: { type: 'string', multiple: true },
    },
    strict: true,
  });
  if (!['secret', 'public'].includes(values.kind)) throw fail('--kind must be secret or public');
  const origins = [...new Set((values.origin ?? []).map((o) => checkOrigin(o, process.env.NODE_ENV)))];
  if (values.kind === 'public' && origins.length === 0) throw fail('public keys need at least one --origin');
  if (values.kind === 'secret' && origins.length > 0) throw fail('secret keys do not take --origin');

  const { rows } = await pool.query('SELECT id FROM projects WHERE slug = $1', [values.project ?? '']);
  if (!rows[0]) throw fail('Unknown --project');

  const key = `${values.kind === 'secret' ? 'ih_sk_' : 'ih_pk_'}${randomToken()}`;
  await pool.query(
    `INSERT INTO api_keys (project_id, kind, key_prefix, key_hash, allowed_origins) VALUES ($1, $2, $3, $4, $5)`,
    [rows[0].id, values.kind, key.slice(0, 12), sha256Hex(key), origins],
  );
  process.stdout.write(
    `Created ${values.kind} key for ${values.project}${origins.length ? ` (origins: ${origins.join(', ')})` : ''}.\n` +
      `This is the only time it is shown:\n\n${key}\n\n`,
  );
});
