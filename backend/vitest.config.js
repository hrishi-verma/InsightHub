const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    env: { LOG_LEVEL: 'silent' },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
