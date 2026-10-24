require('dotenv').config();

const readline = require('node:readline');

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

// Reads a secret: hidden on a terminal, or one line from stdin when piped.
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

module.exports = { runScript, fail, readHidden };
