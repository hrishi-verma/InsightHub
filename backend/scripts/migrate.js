// Usage: npm run migrate [-- --dry-run]
// Applies database/migrations/NNN_*.sql in name order, each in its own transaction, and records
// the file name in schema_migrations. Migration files must stay idempotent.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { runScript, fail } = require('./lib');

const FILE_PATTERN = /^\d{3}_[A-Za-z0-9_-]+\.sql$/;
// Fixed key so two runners (e.g. two deploys at once) take turns instead of colliding.
const LOCK_KEY = 727001;

runScript(async (pool) => {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' } }, strict: true });
  const dir = process.env.MIGRATIONS_DIR || path.resolve(__dirname, '..', '..', 'database', 'migrations');

  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => FILE_PATTERN.test(f)).sort();
  } catch {
    throw fail(`Cannot read migrations directory ${dir}`);
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      process.stdout.write('Nothing pending.\n');
      return;
    }
    if (values['dry-run']) {
      process.stdout.write(`Pending:\n${pending.map((f) => `  ${f}`).join('\n')}\n`);
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw fail(`Migration ${file} failed (${err.code ?? 'no code'}): ${err.message}`);
      }
      process.stdout.write(`Applied ${file}\n`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
});
