import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify('test'), __SW_ENABLED__: 'false' },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'middleware.test.ts'],
    environment: 'node',
    // Each API test file boots an in-memory Postgres (PGlite), which takes a moment.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
