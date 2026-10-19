import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/env.ts'],
    // Every spec shares one throwaway database and empties it between tests
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
