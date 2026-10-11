require('dotenv').config();

const { loadDbConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');

// Runs an admin script with a DB pool, printing only safe error text and exiting non-zero on failure.
async function runScript(fn) {
  let pool;
  try {
    pool = createPool(loadDbConfig());
    await fn(pool);
    process.exitCode = 0;
  } catch (err) {
    process.stderr.write(`Error: ${err.userMessage ?? err.message}\n`);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

function fail(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

module.exports = { runScript, fail };
