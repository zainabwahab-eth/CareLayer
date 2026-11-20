// Z2 testnet integration test: a REAL x402 payment on Stellar testnet through the real facilitator.
// Skipped in `npm test`. Run with:  npm run test:testnet -w @carelayer/api   (or RUN_TESTNET=1)
// Needs apps/api/.env filled by `npm run testnet:setup -w @carelayer/api`.
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../src/config.js';
import { createFacilitatorClient } from '../../src/modules/payments/x402.js';
import { createStellarTestnet } from '../../src/modules/payments/stellar-testnet.js';
import { createPayingFetch, readSettlement } from '../../src/modules/payments/x402-client.js';
import { buildTestApp, deadDb } from '../helpers/app.js';
import '../helpers/env.js';

const enabled =
  process.env.RUN_TESTNET === '1' || process.env.npm_lifecycle_event === 'test:testnet';

describe.skipIf(!enabled)('x402 on Stellar testnet (real payment)', () => {
  // describe bodies run even when skipped, so nothing that can throw lives here.
  let env: Config;
  let payerSecret = '';
  const stellar = createStellarTestnet();
  let baseUrl = '';
  let close = () => {};

  beforeAll(async () => {
    env = loadConfig({ ...process.env, X402_TEST_ROUTE: 'true', NODE_ENV: 'test' });
    payerSecret = process.env.X402_TEST_PAYER_SECRET ?? '';
    expect(payerSecret, 'X402_TEST_PAYER_SECRET (run testnet:setup)').toBeTruthy();
    const app = buildTestApp(deadDb(), {
      config: { x402: env.x402 },
      facilitator: createFacilitatorClient(env.x402),
    });
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it('the guard answers 409 and moves no money', async () => {
    const payer = Keypair.fromSecret(payerSecret).publicKey();
    const before = await stellar.usdcBalanceStroops(payer);
    const res = await createPayingFetch(
      payerSecret,
      'stellar:testnet',
    )(`${baseUrl}/x402-test?ready=false`);
    expect(res.status).toBe(409);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    expect(await stellar.usdcBalanceStroops(payer)).toBe(before);
  });

  it('pays 0.01 USDC, settles on-chain, and moves exactly 100000 stroops', async () => {
    const payer = Keypair.fromSecret(payerSecret).publicKey();
    const payTo = env.x402.payToAddress!;
    const [payerBefore, payToBefore] = await Promise.all([
      stellar.usdcBalanceStroops(payer),
      stellar.usdcBalanceStroops(payTo),
    ]);

    const res = await createPayingFetch(payerSecret, 'stellar:testnet')(`${baseUrl}/x402-test`);
    expect(res.status).toBe(200);
    const settlement = readSettlement(res);
    expect(settlement?.transaction).toMatch(/^[0-9a-f]{64}$/);

    const tx = await stellar.transaction(settlement!.transaction);
    expect(tx.successful).toBe(true);

    // Facilitator sponsors fees, so the payer loses exactly the price in USDC.
    const [payerAfter, payToAfter] = await Promise.all([
      stellar.usdcBalanceStroops(payer),
      stellar.usdcBalanceStroops(payTo),
    ]);
    expect(payerBefore - payerAfter).toBe(100_000n);
    expect(payToAfter - payToBefore).toBe(100_000n);
    console.log(
      `[testnet] paid: https://stellar.expert/explorer/testnet/tx/${settlement!.transaction}`,
    );
  }, 120_000);
});
