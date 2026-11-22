// Z8 testnet integration test: one full question flow with REAL transactions. Her custodial wallet
// pays the answer over x402 (OpenZeppelin facilitator), then the treasury pays the nurse 80%.
// Skipped in `npm test`. Run with:  npm run test:testnet -w @carelayer/api   (or RUN_TESTNET=1)
// Needs apps/api/.env filled by `npm run testnet:setup` and a migrated dev database (DATABASE_URL):
// it leaves demo rows there (prefixed e2e-).
import { afterAll, describe, expect, it } from 'vitest';
import { runAnswerE2E } from '../../scripts/answer-e2e.js';
import { loadConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db.js';
import '../helpers/env.js';

const enabled =
  process.env.RUN_TESTNET === '1' || process.env.npm_lifecycle_event === 'test:testnet';

describe.skipIf(!enabled)('pay on delivery on Stellar testnet (real payment + payout)', () => {
  let db: Db | undefined;
  afterAll(() => db?.$disconnect());

  it('collects a paid answer over x402 and pays the nurse 80%', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
    db = createDb(config.databaseUrl);
    const result = await runAnswerE2E(db, config, (line) => console.log(line));

    expect(result.paymentTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.payoutTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.paymentTxHash).not.toBe(result.payoutTxHash);
    expect(result.payoutStroops).toBe(2_500_000n); // 80% of ₦500 at ₦1,600 / USDC

    const payment = await db.payment.findUniqueOrThrow({
      where: { questionId: result.questionId },
      include: { payout: true },
    });
    expect(payment).toMatchObject({
      status: 'CONFIRMED',
      stellarTxHash: result.paymentTxHash,
      source: 'WOMAN_WALLET',
    });
    expect(payment.payout).toMatchObject({
      status: 'CONFIRMED',
      stellarTxHash: result.payoutTxHash,
    });
  }, 300_000);
});
