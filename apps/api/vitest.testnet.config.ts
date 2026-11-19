// Real Stellar testnet tests (npm run test:testnet). No database: no global setup.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/testnet/**/*.test.ts'],
    fileParallelism: false,
    // Public testnet endpoints (Horizon, Soroban RPC, facilitator) blip; retry transient failures.
    // Safe: a failed attempt never moves money (the balance assertions run per attempt).
    retry: 2,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
