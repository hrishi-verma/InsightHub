const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { createApp } = require('../src/app');
const { MemoryRateLimitStore } = require('../src/services/rateLimitStore');
const { sha256Hex, randomToken } = require('../src/lib/crypto');

const TEST_DB = 'insighthub_test_api';
const DASHBOARD = 'http://localhost:3000';
const SITE = 'https://site.example';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    PORT: '8000',
    TRUST_PROXY: 'false',
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: process.env.DB_PORT || '5432',
    DB_NAME: TEST_DB,
    DB_USER: process.env.DB_USER || 'postgres',
    DB_PASSWORD: process.env.DB_PASSWORD,
    KAFKA_BROKER: 'localhost:9093',
    DASHBOARD_ORIGINS: DASHBOARD,
    ...overrides,
  };
}

// Stand-in for the Kafka producer: records what would have been sent, or fails on demand.
function fakePublisher({ fail = false } = {}) {
  return {
    calls: [],
    async publish(projectId, events, receivedAt) {
      if (fail) throw new Error('kafka down');
      this.calls.push({ projectId, events, receivedAt });
    },
  };
}

let pool;
function getPool() {
  if (!pool) {
    const config = loadConfig(testEnv());
    // Never let tests touch anything but the throwaway test database.
    if (config.db.database !== TEST_DB) throw new Error('tests must run against insighthub_test_api');
    pool = createPool(config.db);
  }
  return pool;
}

function buildApp({ env = {}, publisher } = {}) {
  const config = loadConfig(testEnv(env));
  const eventPublisher = publisher ?? fakePublisher();
  const legacyPublisher = { logs: [], async publishLog(log) { this.logs.push(log); } };
  const rateLimitStore = new MemoryRateLimitStore();
  const { app } = createApp({ config, pool: getPool(), eventPublisher, legacyPublisher, rateLimitStore });
  return { app, eventPublisher, legacyPublisher, rateLimitStore, config };
}

async function resetDb() {
  const db = getPool();
  await db.query('TRUNCATE error_events, issue_alerts, issues, sessions, users, api_keys RESTART IDENTITY CASCADE');
  await db.query(`DELETE FROM projects WHERE slug <> 'education-enlightened'`);
  await db.query(`INSERT INTO projects (slug, name) VALUES ('other-project', 'Other') ON CONFLICT DO NOTHING`);
  const { rows } = await db.query('SELECT id, slug FROM projects ORDER BY id');
  return Object.fromEntries(rows.map((r) => [r.slug, r.id]));
}

async function createKey({ projectId, kind, origins = [] }) {
  const key = `${kind === 'secret' ? 'ih_sk_' : 'ih_pk_'}${randomToken()}`;
  const { rows } = await getPool().query(
    `INSERT INTO api_keys (project_id, kind, key_prefix, key_hash, allowed_origins) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [projectId, kind, key.slice(0, 12), sha256Hex(key), origins],
  );
  return { key, id: rows[0].id };
}

// Low bcrypt cost keeps tests fast; production hashes use cost 12 (see create-user).
async function createUser(email, password, role) {
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await getPool().query(
    'INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id',
    [email, hash, role],
  );
  return rows[0].id;
}

function makeEvent(overrides = {}) {
  return {
    event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    source: 'server',
    environment: 'production',
    level: 'error',
    error_type: 'TypeError',
    message: 'Cannot read properties of undefined',
    ...overrides,
  };
}

function sessionCookie(res) {
  const header = res.headers['set-cookie']?.[0] ?? '';
  return header.split(';')[0];
}

async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}

module.exports = {
  TEST_DB, DASHBOARD, SITE, testEnv, fakePublisher, getPool, buildApp, resetDb, createKey, createUser, makeEvent, sessionCookie, closePool,
};
