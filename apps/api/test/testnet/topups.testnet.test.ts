// Z5 testnet integration test: the treasury credits real test USDC to a fresh custodial wallet, and the
// memo lookup that prevents double payment finds it. Run: npm run test:testnet -w @carelayer/api
import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { createHorizonTopupChain } from '../../src/modules/topups/chain.js';
import { createHorizonWalletChain } from '../../src/modules/wallets/chain.js';
import '../helpers/env.js';

const enabled =
  process.env.RUN_TESTNET === '1' || process.env.npm_lifecycle_event === 'test:testnet';
const HORIZON = 'https://horizon-testnet.stellar.org';

describe.skipIf(!enabled)('top-up credit on Stellar testnet (real)', () => {
  it('sends USDC with the top-up id as memo, and finds it again by memo', async () => {
    const treasurySecret = process.env.STELLAR_TREASURY_SECRET;
    expect(treasurySecret, 'STELLAR_TREASURY_SECRET (run testnet:setup)').toBeTruthy();
    const wallets = createHorizonWalletChain({
      horizonUrl: HORIZON,
      treasurySecret: treasurySecret!,
    });
    const topups = createHorizonTopupChain({
      horizonUrl: HORIZON,
      treasurySecret: treasurySecret!,
    });

    const wallet = Keypair.random();
    await wallets.activate(wallet);
    const memo = `t${randomUUID().replace(/-/g, '').slice(0, 24)}`; // 25 chars, like a cuid

    expect(await topups.findTreasuryPaymentByMemo(memo)).toBeNull();
    const { txHash } = await topups.sendUsdc(wallet.publicKey(), 100_000n, memo); // 0.01 USDC
    expect(txHash).toMatch(/^[0-9a-f]{64}$/);

    expect((await wallets.accountState(wallet.publicKey())).usdcStroops).toBe(100_000n);
    expect(await topups.findTreasuryPaymentByMemo(memo)).toBe(txHash);

    console.log(`[testnet] top-up credit: https://stellar.expert/explorer/testnet/tx/${txHash}`);
  }, 120_000);
});
