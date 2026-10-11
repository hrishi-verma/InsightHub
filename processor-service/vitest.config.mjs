import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // DB tests share insighthub_test_processor, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
