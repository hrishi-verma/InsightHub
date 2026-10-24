// Usage: npm run create-user -- --email a@b.com --role admin
// The password is read from the terminal (hidden), never from arguments.
const { parseArgs } = require('node:util');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { runScript, fail, readHidden } = require('./lib');
const { BCRYPT_COST } = require('../src/routes/v1/auth');

runScript(async (pool) => {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, role: { type: 'string' } },
    strict: true,
  });
  const email = z.email().max(254).safeParse((values.email ?? '').trim().toLowerCase());
  if (!email.success) throw fail('--email must be a valid email address');
  if (!['admin', 'viewer'].includes(values.role)) throw fail('--role must be admin or viewer');

  const password = await readHidden('Password (12 characters to 72 bytes): ');
  // bcrypt only uses the first 72 bytes, so refuse longer ones instead of silently truncating.
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw fail('Password must be 12 characters to 72 bytes');
  if (process.stdin.isTTY) {
    const again = await readHidden('Repeat password: ');
    if (again !== password) throw fail('Passwords do not match');
  }

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const { rowCount } = await pool.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
    [email.data, hash, values.role],
  );
  if (rowCount === 0) throw fail('A user with that email already exists');
  process.stdout.write(`Created ${values.role} user ${email.data}\n`);
});
