// Test environment. Tests only ever touch DATABASE_URL_TEST, and refuse any database whose name
// does not end in "_test", so `npm test` can never wipe the dev database.
import type { Config } from '../../src/config.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: rely on the real environment (CI).
}

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error('DATABASE_URL_TEST is not set. Add it to apps/api/.env (see .env.example).');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${dbName}": the test database name must end in _test.`,
    );
  }
  return url;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    corsOrigins: ['http://localhost:5173', 'http://localhost:5174'],
    logLevel: 'silent',
    databaseUrl: testDatabaseUrl(),
    answerPriceKobo: 50_000,
    ngnPerUsdc: '1600',
    x402: {
      network: 'stellar:testnet',
      facilitatorUrl: 'https://facilitator.invalid',
      facilitatorApiKey: undefined,
      payToAddress: undefined,
      testRouteEnabled: false,
    },
    ...overrides,
  };
}
