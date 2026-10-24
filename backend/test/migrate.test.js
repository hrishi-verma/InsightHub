import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import helpers from './helpers.js';
import scripts from './scripts.js';

const { getPool, closePool } = helpers;
const { runCli } = scripts;

// Fixture versions start with 9 so they never clash with real migrations; cleaned up after each test.
let dir;

function write(name, sql) {
  fs.writeFileSync(path.join(dir, name), sql);
}

const exists = async (table) =>
  (await getPool().query('SELECT to_regclass($1) AS t', [table])).rows[0].t !== null;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-mig-'));
  await cleanup();
});

async function cleanup() {
  await getPool().query(`DELETE FROM schema_migrations WHERE version LIKE '9%'`).catch(() => {});
  await getPool().query('DROP TABLE IF EXISTS zz_mig_a, zz_mig_b');
}

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('migration runner', () => {
  it('applies pending files in order, then skips them', async () => {
    write('901_a.sql', 'CREATE TABLE zz_mig_a (id int);');
    write('902_b.sql', 'CREATE TABLE zz_mig_b (id int); INSERT INTO zz_mig_a VALUES (1);');
    write('notes.txt', 'ignored');

    const dry = await runCli('migrate.js', ['--dry-run'], { env: { MIGRATIONS_DIR: dir } });
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('901_a.sql');
    expect(await exists('zz_mig_a')).toBe(false);

    const first = await runCli('migrate.js', [], { env: { MIGRATIONS_DIR: dir } });
    expect(first.code).toBe(0);
    expect(first.stdout.indexOf('901_a.sql')).toBeLessThan(first.stdout.indexOf('902_b.sql'));
    expect(await exists('zz_mig_b')).toBe(true);

    const second = await runCli('migrate.js', [], { env: { MIGRATIONS_DIR: dir } });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('Nothing pending');
    expect(second.stdout).not.toContain('Applied');
  });

  it('rolls back a failing file, exits non-zero and names the file', async () => {
    write('901_a.sql', 'CREATE TABLE zz_mig_a (id int);');
    write('902_b.sql', 'CREATE TABLE zz_mig_b (id int); SELECT 1/0;');

    const res = await runCli('migrate.js', [], { env: { MIGRATIONS_DIR: dir } });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('902_b.sql');
    expect(res.stderr).toContain('22012');
    expect(res.stderr).not.toContain(process.env.DB_PASSWORD);
    expect(await exists('zz_mig_a')).toBe(true); // earlier file stays applied
    expect(await exists('zz_mig_b')).toBe(false); // failed file rolled back
    const { rows } = await getPool().query(`SELECT version FROM schema_migrations WHERE version LIKE '9%'`);
    expect(rows.map((r) => r.version)).toEqual(['901_a.sql']);
  });

  it('rejects unknown arguments and a missing directory', async () => {
    expect((await runCli('migrate.js', ['--force'], { env: { MIGRATIONS_DIR: dir } })).code).not.toBe(0);
    expect((await runCli('migrate.js', [], { env: { MIGRATIONS_DIR: path.join(dir, 'nope') } })).code).not.toBe(0);
  });

  it('the real migrations are recorded on the test database', async () => {
    const { rows } = await getPool().query(`SELECT version FROM schema_migrations WHERE version LIKE '00%' ORDER BY 1`);
    expect(rows.map((r) => r.version)).toEqual(['001_error_tracking.sql', '002_retention_audit.sql']);
  });
});
