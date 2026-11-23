// Z10 testnet integration test: a nurse earns (Z8 flow) and withdraws ₦100 to a Stellar address.
// The payment is signed by her custodial key; the treasury pays the fee (fee bump).
// Skipped in `npm test`. Run with:  npm run test:testnet -w @carelayer/api   (or RUN_TESTNET=1)
// Needs apps/api/.env filled by `npm run testnet:setup` and a migrated dev database.
import { afterAll, describe, expect, it } from 'vitest';
import { runWithdrawalE2E } from '../../scripts/withdrawal-e2e.js';
import { loadConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db.js';
import '../helpers/env.js';

const enabled =
  process.env.RUN_TESTNET === '1' || process.env.npm_lifecycle_event === 'test:testnet';

describe.skipIf(!enabled)('nurse withdrawal on Stellar testnet (real fee-bumped payment)', () => {
  let db: Db | undefined;
  afterAll(() => db?.$disconnect());

  it('withdraws ₦100 from her custodial wallet and records the hash', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
    db = createDb(config.databaseUrl);
    const destinationSecret = process.env.X402_TEST_PAYER_SECRET ?? '';
    expect(destinationSecret, 'X402_TEST_PAYER_SECRET (run testnet:setup)').toBeTruthy();

    const result = await runWithdrawalE2E(db, config, destinationSecret, (l) => console.log(l));
    expect(result.withdrawal).toMatchObject({
      status: 'confirmed',
      amount: { kobo: 10_000, usdc: '0.0625000' },
    });
    expect(result.withdrawal.stellarTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.after.available.kobo).toBe(result.before.available.kobo - 10_000);
  }, 300_000);
});
