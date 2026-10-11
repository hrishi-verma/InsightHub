// Usage: npm run revoke-key -- --prefix ih_pk_abc123
const { parseArgs } = require('node:util');
const { runScript, fail } = require('./lib');

runScript(async (pool) => {
  const { values } = parseArgs({ options: { prefix: { type: 'string' } }, strict: true });
  const prefix = values.prefix ?? '';
  if (!/^ih_(sk|pk)_[A-Za-z0-9_-]{6}$/.test(prefix)) throw fail('--prefix must be the 12-character key prefix, e.g. ih_pk_abc123');

  const { rows } = await pool.query(
    'SELECT id FROM api_keys WHERE key_prefix = $1 AND revoked_at IS NULL',
    [prefix],
  );
  if (rows.length === 0) throw fail('No active key with that prefix');
  // Prefixes are short, so two keys can share one. Refuse rather than guess.
  if (rows.length > 1) throw fail(`${rows.length} active keys share that prefix; revoke by id in the database instead`);

  await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [rows[0].id]);
  process.stdout.write(`Revoked key ${prefix}\n`);
});
