import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import helpers from './helpers.js';
import scripts from './scripts.js';

const { resetDb, createUser, createKey, getPool, closePool } = helpers;
const { runCli } = scripts;

const PASSWORD = 'correct horse battery staple';
let projects;

async function addSession(userId, n = 1) {
  for (let i = 0; i < n; i++) {
    await getPool().query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [`${userId}${i}`.padStart(64, 'a'), userId],
    );
  }
}
const sessionCount = async (userId) =>
  Number((await getPool().query('SELECT count(*) FROM sessions WHERE user_id = $1', [userId])).rows[0].count);

beforeEach(async () => {
  projects = await resetDb();
});
afterAll(closePool);

describe('users script', () => {
  it('lists users without hashes', async () => {
    await createUser('admin@example.com', PASSWORD, 'admin');
    const res = await runCli('users.js', ['list']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('admin@example.com');
    expect(res.stdout).not.toMatch(/\$2[aby]\$/);
    expect(res.stdout).not.toContain('password');
  });

  it('disable sets disabled_at and ends sessions; enable reverses it', async () => {
    const id = await createUser('v@example.com', PASSWORD, 'viewer');
    const other = await createUser('o@example.com', PASSWORD, 'viewer');
    await addSession(id, 2);
    await addSession(other);

    const off = await runCli('users.js', ['disable', '--email', 'V@Example.com']);
    expect(off.code).toBe(0);
    expect(await sessionCount(id)).toBe(0);
    expect(await sessionCount(other)).toBe(1);
    let { rows } = await getPool().query('SELECT disabled_at FROM users WHERE id = $1', [id]);
    expect(rows[0].disabled_at).not.toBeNull();

    expect((await runCli('users.js', ['list'])).stdout).toMatch(/v@example\.com\tviewer\tyes/);
    expect((await runCli('users.js', ['enable', '--email', 'v@example.com'])).code).toBe(0);
    ({ rows } = await getPool().query('SELECT disabled_at FROM users WHERE id = $1', [id]));
    expect(rows[0].disabled_at).toBeNull();
  });

  it('logout ends only that user\'s sessions', async () => {
    const id = await createUser('v@example.com', PASSWORD, 'viewer');
    const other = await createUser('o@example.com', PASSWORD, 'viewer');
    await addSession(id, 2);
    await addSession(other);
    expect((await runCli('users.js', ['logout', '--email', 'v@example.com'])).code).toBe(0);
    expect(await sessionCount(id)).toBe(0);
    expect(await sessionCount(other)).toBe(1);
  });

  it('reset-password sets a new hash, ends sessions and prints no secret', async () => {
    const id = await createUser('v@example.com', PASSWORD, 'viewer');
    await addSession(id);
    const next = 'a brand new passphrase';
    const res = await runCli('users.js', ['reset-password', '--email', 'v@example.com'], { stdin: `${next}\n` });
    expect(res.code).toBe(0);
    expect(res.stdout + res.stderr).not.toContain(next);
    expect(res.stdout + res.stderr).not.toMatch(/\$2[aby]\$/);
    expect(await sessionCount(id)).toBe(0);
    const { rows } = await getPool().query('SELECT password_hash FROM users WHERE id = $1', [id]);
    expect(await bcrypt.compare(next, rows[0].password_hash)).toBe(true);
  });

  it('reset-password enforces the length limits', async () => {
    const id = await createUser('v@example.com', PASSWORD, 'viewer');
    const before = (await getPool().query('SELECT password_hash FROM users WHERE id = $1', [id])).rows[0].password_hash;
    for (const bad of ['short', 'x'.repeat(73), 'é'.repeat(37), '']) {
      const res = await runCli('users.js', ['reset-password', '--email', 'v@example.com'], { stdin: `${bad}\n` });
      expect(res.code).not.toBe(0);
    }
    const after = (await getPool().query('SELECT password_hash FROM users WHERE id = $1', [id])).rows[0].password_hash;
    expect(after).toBe(before);
    // Exactly 72 bytes is accepted.
    const ok = await runCli('users.js', ['reset-password', '--email', 'v@example.com'], { stdin: `${'y'.repeat(72)}\n` });
    expect(ok.code).toBe(0);
  });

  it('gives clear errors for unknown users, bad emails and bad arguments', async () => {
    const unknown = await runCli('users.js', ['disable', '--email', 'nobody@example.com']);
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('No user');
    expect((await runCli('users.js', ['disable', '--email', 'not-an-email'])).code).not.toBe(0);
    expect((await runCli('users.js', ['disable'])).code).not.toBe(0);
    expect((await runCli('users.js', ['explode', '--email', 'a@b.com'])).code).not.toBe(0);
    expect((await runCli('users.js', ['list', '--bogus'])).code).not.toBe(0);
  });
});

describe('project and key scripts', () => {
  it('create-project validates input and refuses duplicates', async () => {
    const ok = await runCli('create-project.js', ['--slug', 'my-site', '--name', 'My Site']);
    expect(ok.code).toBe(0);
    const { rows } = await getPool().query(`SELECT name FROM projects WHERE slug = 'my-site'`);
    expect(rows[0].name).toBe('My Site');

    const dup = await runCli('create-project.js', ['--slug', 'my-site', '--name', 'Again']);
    expect(dup.code).not.toBe(0);
    expect(dup.stderr).toContain('already exists');

    for (const args of [
      ['--slug', 'Bad_Slug', '--name', 'X'],
      ['--slug', 'x'.repeat(65), '--name', 'X'],
      ['--slug', 'ok', '--name', ''],
      ['--slug', 'ok', '--name', 'n'.repeat(101)],
      ['--slug', 'ok'],
      ['--slug', 'ok', '--name', 'X', '--extra', '1'],
    ]) {
      expect((await runCli('create-project.js', args)).code).not.toBe(0);
    }
  });

  it('list-keys shows metadata but never key material', async () => {
    const pk = await createKey({ projectId: projects['education-enlightened'], kind: 'public', origins: ['https://site.example'] });
    const sk = await createKey({ projectId: projects['other-project'], kind: 'secret' });
    await getPool().query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [sk.id]);
    const { rows } = await getPool().query('SELECT key_hash FROM api_keys');

    const all = await runCli('list-keys.js');
    expect(all.code).toBe(0);
    expect(all.stdout).toContain(pk.key.slice(0, 12));
    expect(all.stdout).toContain('https://site.example');
    expect(all.stdout).toContain('other-project');
    expect(all.stdout).not.toContain(pk.key);
    for (const r of rows) expect(all.stdout).not.toContain(r.key_hash);

    const one = await runCli('list-keys.js', ['--project', 'other-project']);
    expect(one.stdout).toContain(sk.key.slice(0, 12));
    expect(one.stdout).not.toContain(pk.key.slice(0, 12));
    expect((await runCli('list-keys.js', ['--project', 'BAD SLUG'])).code).not.toBe(0);
  });
});
