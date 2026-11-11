import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    // All suites share one test database, so files must not truncate it in parallel.
    fileParallelism: false,
  },
});
