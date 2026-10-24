// Usage: npm run users -- list
//        npm run users -- disable|enable|reset-password|logout --email a@b.com
// Never prints password hashes. Passwords are read like create-user (hidden, never from arguments).
const { parseArgs } = require('node:util');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { runScript, fail, readHidden } = require('./lib');
const { BCRYPT_COST } = require('../src/routes/v1/auth');

const COMMANDS = ['list', 'disable', 'enable', 'reset-password', 'logout'];

async function findUser(pool, email) {
  const { rows } = await pool.query('SELECT id, email FROM users WHERE email = $1', [email]);
  if (!rows[0]) throw fail('No user with that email');
  return rows[0];
}

async function deleteSessions(pool, userId) {
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  return rowCount;
}

runScript(async (pool) => {
  const { values, positionals } = parseArgs({
    options: { email: { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });
  const [command, ...extra] = positionals;
  if (!COMMANDS.includes(command) || extra.length > 0) throw fail(`Usage: users <${COMMANDS.join('|')}> [--email x]`);

  if (command === 'list') {
    if (values.email !== undefined) throw fail('list takes no --email');
    const { rows } = await pool.query(
      'SELECT id, email, role, disabled_at, created_at FROM users ORDER BY id',
    );
    process.stdout.write('id\temail\trole\tdisabled\tcreated\n');
    for (const r of rows) {
      process.stdout.write(
        `${r.id}\t${r.email}\t${r.role}\t${r.disabled_at ? 'yes' : 'no'}\t${r.created_at.toISOString()}\n`,
      );
    }
    return;
  }

  const parsed = z.email().max(254).safeParse((values.email ?? '').trim().toLowerCase());
  if (!parsed.success) throw fail('--email must be a valid email address');
  const user = await findUser(pool, parsed.data);

  if (command === 'disable') {
    await pool.query('UPDATE users SET disabled_at = coalesce(disabled_at, now()) WHERE id = $1', [user.id]);
    const n = await deleteSessions(pool, user.id);
    process.stdout.write(`Disabled ${user.email}; ended ${n} session(s)\n`);
  } else if (command === 'enable') {
    await pool.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [user.id]);
    process.stdout.write(`Enabled ${user.email}\n`);
  } else if (command === 'logout') {
    const n = await deleteSessions(pool, user.id);
    process.stdout.write(`Ended ${n} session(s) for ${user.email}\n`);
  } else {
    const password = await readHidden('New password (12 characters to 72 bytes): ');
    // bcrypt only uses the first 72 bytes, so refuse longer ones instead of silently truncating.
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw fail('Password must be 12 characters to 72 bytes');
    if (process.stdin.isTTY) {
      const again = await readHidden('Repeat password: ');
      if (again !== password) throw fail('Passwords do not match');
    }
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
    // A changed password must end any session an attacker might still hold.
    const n = await deleteSessions(pool, user.id);
    process.stdout.write(`Password reset for ${user.email}; ended ${n} session(s)\n`);
  }
});
