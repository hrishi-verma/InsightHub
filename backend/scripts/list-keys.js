// Usage: npm run list-keys [-- --project my-site]
// Shows key prefixes only, never the key or its hash.
const { parseArgs } = require('node:util');
const { runScript, fail } = require('./lib');

const time = (d) => (d ? d.toISOString() : '-');

runScript(async (pool) => {
  const { values } = parseArgs({ options: { project: { type: 'string' } }, strict: true });
  if (values.project !== undefined && !/^[a-z0-9-]{1,64}$/.test(values.project)) throw fail('--project must be a project slug');

  const { rows } = await pool.query(
    `SELECT k.key_prefix, k.kind, p.slug, k.allowed_origins, k.created_at, k.last_used_at, k.revoked_at
       FROM api_keys k JOIN projects p ON p.id = k.project_id
      WHERE ($1::text IS NULL OR p.slug = $1)
      ORDER BY p.slug, k.id`,
    [values.project ?? null],
  );
  process.stdout.write('prefix\tkind\tproject\torigins\tcreated\tlast_used\trevoked\n');
  for (const r of rows) {
    process.stdout.write(
      [r.key_prefix, r.kind, r.slug, r.allowed_origins.join(',') || '-', time(r.created_at), time(r.last_used_at), time(r.revoked_at)].join('\t') + '\n',
    );
  }
});
