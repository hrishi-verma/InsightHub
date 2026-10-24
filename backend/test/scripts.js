// Test helper: runs an admin script against the test database in a child process.
const path = require('node:path');
const { spawn } = require('node:child_process');
const helpers = require('./helpers');

const BACKEND = path.join(__dirname, '..');

function runCli(script, args = [], { stdin, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join('scripts', script), ...args], {
      cwd: BACKEND,
      env: { PATH: process.env.PATH, ...helpers.testEnv(), ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

module.exports = { runCli };
