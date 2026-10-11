const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');
const { loadConfig } = require('../src/config');

// Tests wipe tables, so they only ever run against the processor's own test database.
function testConfig(overrides = {}) {
  const dbName = process.env.TEST_DB_NAME || 'insighthub_test_processor';
  if (!/_test_processor$/.test(dbName)) throw new Error('TEST_DB_NAME must end with _test_processor');
  const config = loadConfig({ ...process.env, DB_NAME: dbName, ML_SHADOW: 'off', ...overrides });
  return config;
}

function createPool(config) {
  return new Pool({ ...config.db, max: 4 });
}

async function resetDb(pool) {
  await pool.query('TRUNCATE issue_alerts, error_events, issues RESTART IDENTITY CASCADE');
  const { rows } = await pool.query(
    `INSERT INTO projects (slug, name) VALUES ('education-enlightened', 'Education Enlightened')
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
  );
  return rows[0].id;
}

const STACK = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  '    at getUser (/app/src/services/users.js:42:11)',
  '    at async handler (/app/src/routes/users.js:17:5)',
  '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)',
].join('\n');

function makeEvent(overrides = {}) {
  return {
    event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    source: 'server',
    environment: 'production',
    level: 'error',
    error_type: 'TypeError',
    message: "Cannot read properties of undefined (reading 'id')",
    stack: STACK,
    release: 'abc1234',
    url_path: '/api/users/42',
    http: { method: 'GET', status: 500, route: '/api/users/:id' },
    runtime: 'node 24.1',
    ...overrides,
  };
}

function kafkaMessage(projectId, event, envelopeOverrides = {}) {
  const value = { schema: 1, project_id: projectId, received_at: new Date().toISOString(), event, ...envelopeOverrides };
  return { key: Buffer.from(String(projectId)), value: Buffer.from(JSON.stringify(value)) };
}

module.exports = { testConfig, createPool, resetDb, makeEvent, kafkaMessage, STACK };
