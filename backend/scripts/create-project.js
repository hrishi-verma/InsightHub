// Usage: npm run create-project -- --slug my-site --name "My Site"
const { parseArgs } = require('node:util');
const { runScript, fail } = require('./lib');

runScript(async (pool) => {
  const { values } = parseArgs({
    options: { slug: { type: 'string' }, name: { type: 'string' } },
    strict: true,
  });
  const slug = values.slug ?? '';
  const name = (values.name ?? '').trim();
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw fail('--slug must be 1-64 characters: a-z, 0-9 and -');
  if (name.length < 1 || name.length > 100) throw fail('--name must be 1-100 characters');

  const { rowCount } = await pool.query(
    'INSERT INTO projects (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING',
    [slug, name],
  );
  if (rowCount === 0) throw fail('A project with that slug already exists');
  process.stdout.write(`Created project ${slug}\n`);
});
