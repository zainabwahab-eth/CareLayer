import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Real testnet tests run separately: npm run test:testnet (vitest.testnet.config.ts).
    exclude: ['test/testnet/**', '**/node_modules/**'],
    globalSetup: ['test/global-setup.ts'],
    // DB tests share one test database: run files one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
