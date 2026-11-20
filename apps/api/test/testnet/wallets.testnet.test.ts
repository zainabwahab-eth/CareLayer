// Z4 testnet integration test: activate a brand-new custodial wallet through the REAL treasury.
// Skipped in `npm test`. Run with: npm run test:testnet -w @carelayer/api  (needs STELLAR_TREASURY_SECRET)
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { createHorizonWalletChain } from '../../src/modules/wallets/chain.js';
import '../helpers/env.js';

const enabled =
  process.env.RUN_TESTNET === '1' || process.env.npm_lifecycle_event === 'test:testnet';
const HORIZON = 'https://horizon-testnet.stellar.org';

describe.skipIf(!enabled)('custodial wallet activation on Stellar testnet (real)', () => {
  it('creates a 0-XLM account sponsored by the treasury, with the USDC trustline', async () => {
    const treasurySecret = process.env.STELLAR_TREASURY_SECRET;
    expect(treasurySecret, 'STELLAR_TREASURY_SECRET (run testnet:setup)').toBeTruthy();
    const treasury = Keypair.fromSecret(treasurySecret!).publicKey();
    const chain = createHorizonWalletChain({
      horizonUrl: HORIZON,
      treasurySecret: treasurySecret!,
    });

    const wallet = Keypair.random();
    expect((await chain.accountState(wallet.publicKey())).exists).toBe(false);

    const { txHash } = await chain.activate(wallet);
    expect(txHash).toMatch(/^[0-9a-f]{64}$/);

    const state = await chain.accountState(wallet.publicKey());
    expect(state).toMatchObject({
      exists: true,
      hasUsdcTrustline: true,
      usdcStroops: 0n,
      sponsor: treasury,
    });

    // Straight from Horizon: 0 XLM of her own; the treasury sponsors the account and the trustline.
    const account = await new Horizon.Server(HORIZON).loadAccount(wallet.publicKey());
    const native = account.balances.find((b) => b.asset_type === 'native');
    expect(native?.balance).toBe('0.0000000');
    const usdc = account.balances.find((b) => 'asset_code' in b && b.asset_code === 'USDC');
    expect((usdc as { sponsor?: string } | undefined)?.sponsor).toBe(treasury);
    expect((account as unknown as { num_sponsored: number }).num_sponsored).toBe(3); // 2 base + 1 trustline

    // Running it again is refused by Stellar (the service treats this as "already active").
    await expect(chain.activate(wallet)).rejects.toThrow('account already exists');

    console.log(
      `[testnet] wallet: https://stellar.expert/explorer/testnet/account/${wallet.publicKey()}\n` +
        `[testnet] activation tx: https://stellar.expert/explorer/testnet/tx/${txHash}`,
    );
  }, 120_000);
});
