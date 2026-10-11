const { Pool } = require('pg');
const { logger, describeError } = require('../lib/logger');

function createPool(dbConfig) {
  const pool = new Pool(dbConfig);
  // An idle client error must not crash the process.
  pool.on('error', (err) => logger.error('postgres pool error', describeError(err)));
  return pool;
}

module.exports = { createPool };
