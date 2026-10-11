// Usage: npm run create-user -- --email a@b.com --role admin
// The password is read from the terminal (hidden), never from arguments.
const { parseArgs } = require('node:util');
const readline = require('node:readline');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { runScript, fail } = require('./lib');
const { BCRYPT_COST } = require('../src/routes/v1/auth');

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) {
      // Non-interactive (e.g. piped from a secrets manager): read one line, echo nothing.
      const rl = readline.createInterface({ input, terminal: false });
      rl.once('line', (line) => { resolve(line); rl.close(); });
      rl.once('close', () => resolve(''));
      return;
    }
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.pause();
          input.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          input.setRawMode(false);
          process.stdout.write('\n');
          return reject(fail('Cancelled'));
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.on('data', onData);
  });
}

runScript(async (pool) => {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, role: { type: 'string' } },
    strict: true,
  });
  const email = z.email().max(254).safeParse((values.email ?? '').trim().toLowerCase());
  if (!email.success) throw fail('--email must be a valid email address');
  if (!['admin', 'viewer'].includes(values.role)) throw fail('--role must be admin or viewer');

  const password = await readHidden('Password (12-128 characters): ');
  if (password.length < 12 || password.length > 128) throw fail('Password must be 12-128 characters');
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
