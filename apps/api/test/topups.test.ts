// Z5 top-ups against the real test database, with fake Paystack, fake treasury and fake wallet chain.
import { randomUUID } from 'node:crypto';
import type { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServices } from '../src/app.js';
import { createDb } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';
import { koboToStroops } from '../src/lib/money.js';
import type { TopupChain } from '../src/modules/topups/chain.js';
import {
  isValidPaystackSignature,
  signPaystackBody,
  type PaystackClient,
  type PaystackVerification,
} from '../src/modules/topups/paystack.js';
import type { WalletChain } from '../src/modules/wallets/chain.js';
import { buildTestApp, fakeClock, memoryEmailSender } from './helpers/app.js';
import { testConfig, testDatabaseUrl } from './helpers/env.js';

const db = createDb(testDatabaseUrl());
afterAll(() => db.$disconnect());

const SECRET = testConfig().paystack.secretKey!;
const MINUTE = 60_000;
const wait = { timeout: 10_000, interval: 50 };

function fakes() {
  const state = {
    initialized: [] as {
      email: string;
      amountKobo: number;
      reference: string;
      callbackUrl: string;
    }[],
    /** reference -> what verify() returns (default: still pending). */
    verify: new Map<string, PaystackVerification>(),
    initializeFails: false,
    /** memo -> { to, stroops, hash } of treasury payments. */
    sent: new Map<string, { to: string; stroops: bigint; hash: string }>(),
    sendCalls: 0,
    sendFails: null as Error | null,
    /** The payment lands on-chain but the call errors (timeout after submit). */
    sendLandsThenThrows: false,
    walletActivations: 0,
    walletChainDown: false,
  };
  const paystack: PaystackClient = {
    async initialize(input) {
      if (state.initializeFails) throw new Error('Paystack: 500');
      state.initialized.push(input);
      return {
        authorizationUrl: `https://checkout.paystack.com/${input.reference}`,
        reference: input.reference,
      };
    },
    async verify(reference) {
      return (
        state.verify.get(reference) ?? {
          status: 'abandoned',
          amountKobo: 0,
          currency: 'NGN',
          paidAt: null,
          gatewayResponse: null,
        }
      );
    },
  };
  const topupChain: TopupChain = {
    async sendUsdc(to, stroops, memo) {
      state.sendCalls++;
      if (state.sendFails) throw state.sendFails;
      const hash = randomUUID().replace(/-/g, '').padEnd(64, 'a');
      state.sent.set(memo, { to, stroops, hash });
      if (state.sendLandsThenThrows) throw new Error('stellar request failed: timeout');
      return { txHash: hash };
    },
    async findTreasuryPaymentByMemo(memo) {
      return state.sent.get(memo)?.hash ?? null;
    },
  };
  const accounts = new Set<string>();
  const walletChain: WalletChain = {
    async accountState(address) {
      if (state.walletChainDown) throw new Error('stellar request failed: timeout');
      return accounts.has(address)
        ? { exists: true, hasUsdcTrustline: true, usdcStroops: 0n, sponsor: 'GT' }
        : { exists: false, hasUsdcTrustline: false, usdcStroops: 0n, sponsor: null };
    },
    async activate(kp: Keypair) {
      if (state.walletChainDown) throw new Error('stellar request failed: timeout');
      state.walletActivations++;
      accounts.add(kp.publicKey());
      return { txHash: randomUUID().replace(/-/g, '').padEnd(64, 'b') };
    },
  };
  return { state, paystack, topupChain, walletChain };
}

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
let f: ReturnType<typeof fakes>;
let app: ReturnType<typeof buildTestApp>;

beforeEach(() => {
  clock = fakeClock();
  mail = memoryEmailSender();
  f = fakes();
  app = buildTestApp(db, {
    clock,
    emailSender: mail,
    paystack: f.paystack,
    topupChain: f.topupChain,
    walletChain: f.walletChain,
  });
});

async function signUp(appName: 'women' | 'nurses' = 'women') {
  const email = `t-${randomUUID().slice(0, 8)}@example.com`;
  await request(app)
    .post('/auth/code/request')
    .send({ email, purpose: 'signup', app: appName, name: 'Tolu' });
  const res = await request(app)
    .post('/auth/code/verify')
    .send({ email, code: mail.lastCode(email), purpose: 'signup', app: appName, name: 'Tolu' });
  return { email, userId: res.body.user.id as string, token: res.body.accessToken as string };
}

const startTopup = (token: string, amountKobo = 200_000) =>
  request(app).post('/topups').set('Authorization', `Bearer ${token}`).send({ amountKobo });

function webhook(body: object, signature?: string) {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signature ?? signPaystackBody(raw, SECRET))
    .send(raw);
}

const chargeSuccess = (reference: string, amount: number, currency = 'NGN') => ({
  event: 'charge.success',
  data: { reference, amount, currency, status: 'success', paid_at: '2026-11-20T09:05:00.000Z' },
});

const topupRow = (id: string) => db.topup.findUniqueOrThrow({ where: { id } });

describe('Paystack signature', () => {
  it('accepts the HMAC-SHA512 of the raw body under the secret key, and nothing else', () => {
    const raw = Buffer.from('{"event":"charge.success"}');
    const sig = signPaystackBody(raw, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(isValidPaystackSignature(raw, sig, SECRET)).toBe(true);
    expect(isValidPaystackSignature(Buffer.from('{"event":"charge.success" }'), sig, SECRET)).toBe(
      false,
    ); // re-serialised
    expect(isValidPaystackSignature(raw, signPaystackBody(raw, 'sk_test_other'), SECRET)).toBe(
      false,
    );
    expect(isValidPaystackSignature(raw, undefined, SECRET)).toBe(false);
    expect(isValidPaystackSignature(raw, 'zz', SECRET)).toBe(false);
  });
});

describe('POST /topups', () => {
  it('creates a pending top-up and a Paystack checkout (amount in kobo, callback carries the top-up id)', async () => {
    const { email, token } = await signUp();
    const res = await startTopup(token, 200_000); // ₦2,000
    expect(res.status).toBe(201);
    expect(res.body.authorizationUrl).toBe(`https://checkout.paystack.com/${res.body.reference}`);
    expect(res.body.reference).toMatch(/^cltop_[0-9a-f]{24}$/);

    const sent = f.state.initialized[0]!;
    expect(sent).toMatchObject({ email, amountKobo: 200_000, reference: res.body.reference });
    expect(new URL(sent.callbackUrl).searchParams.get('topupId')).toBe(res.body.topupId);

    const row = await topupRow(res.body.topupId);
    expect(row).toMatchObject({
      status: 'PENDING',
      amountKobo: 200_000,
      amountStroops: koboToStroops(200_000, '1600'),
    });
  });

  it('validates the amount (whole kobo, ₦100 to ₦100,000)', async () => {
    const { token } = await signUp();
    for (const amountKobo of [9_999, 10_000_001, 150.5]) {
      const res = await startTopup(token, amountKobo);
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe('amountKobo');
    }
  });

  it('women only (403 for nurses), sign-in required (401)', async () => {
    const nurse = await signUp('nurses');
    expect((await startTopup(nurse.token)).status).toBe(403);
    expect((await request(app).post('/topups').send({ amountKobo: 100_000 })).status).toBe(401);
  });

  it('Paystack down: 503 and the top-up is closed as failed', async () => {
    const { token, userId } = await signUp();
    f.state.initializeFails = true;
    const res = await startTopup(token);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    const row = await db.topup.findFirstOrThrow({ where: { womanId: userId } });
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'paystack_initialize_failed' });
  });

  it('503 when Paystack is not configured', async () => {
    const noPaystack = buildTestApp(db, {
      clock,
      emailSender: mail,
      config: { paystack: { ...testConfig().paystack, secretKey: undefined } },
    });
    const { token } = await signUp();
    const res = await request(noPaystack)
      .post('/topups')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountKobo: 100_000 });
    expect(res.status).toBe(503);
  });
});

describe('POST /webhooks/paystack', () => {
  it('rejects a missing or forged signature (401) and changes nothing', async () => {
    const { token } = await signUp();
    const { body } = await startTopup(token);
    const res = await webhook(chargeSuccess(body.reference, 200_000), 'f'.repeat(128));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('PAYSTACK_SIGNATURE_INVALID');
    expect((await topupRow(body.topupId)).status).toBe('PENDING');
  });

  it('charge.success: marks paid, then credits the exact USDC to her wallet once (memo = top-up id)', async () => {
    const { token, userId } = await signUp();
    const { body } = await startTopup(token, 200_000);
    const res = await webhook(chargeSuccess(body.reference, 200_000));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    await vi.waitFor(
      async () => expect((await topupRow(body.topupId)).status).toBe('CONFIRMED'),
      wait,
    );
    const row = await topupRow(body.topupId);
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
    const payment = f.state.sent.get(body.topupId)!;
    expect(payment).toMatchObject({ to: wallet.stellarPublicKey, stroops: 12_500_000n }); // ₦2,000 at ₦1,600 = 1.25 USDC
    expect(row.stellarTxHash).toBe(payment.hash);
    expect(row.paidAt?.toISOString()).toBe('2026-11-20T09:05:00.000Z');
    expect(row.creditedAt).not.toBeNull();
    expect(wallet.cachedBalanceStroops).toBe(12_500_000n);
  });

  it('duplicate webhooks (Paystack retries) credit only once', async () => {
    const { token } = await signUp();
    const { body } = await startTopup(token);
    await Promise.all([1, 2, 3].map(() => webhook(chargeSuccess(body.reference, 200_000))));
    await vi.waitFor(
      async () => expect((await topupRow(body.topupId)).status).toBe('CONFIRMED'),
      wait,
    );
    await webhook(chargeSuccess(body.reference, 200_000));
    expect(f.state.sendCalls).toBe(1);
  });

  it('a paid amount or currency that does not match fails the top-up and credits nothing', async () => {
    const { token } = await signUp();
    const a = (await startTopup(token, 200_000)).body;
    const b = (await startTopup(token, 200_000)).body;
    await webhook(chargeSuccess(a.reference, 100)); // ₦1 instead of ₦2,000
    await webhook(chargeSuccess(b.reference, 200_000, 'USD'));
    for (const t of [a, b])
      expect(await topupRow(t.topupId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'amount_mismatch',
      });
    expect(f.state.sendCalls).toBe(0);
  });

  it('acknowledges other events and unknown references (200) without changing anything', async () => {
    expect(
      (
        await webhook({
          event: 'transfer.success',
          data: { reference: 'x', amount: 1, currency: 'NGN' },
        })
      ).status,
    ).toBe(200);
    expect((await webhook(chargeSuccess('cltop_unknown', 100))).status).toBe(200);
    expect(f.state.sendCalls).toBe(0);
  });
});

describe('GET /topups/:id', () => {
  it('without a webhook (local dev), verifies with Paystack, then credits', async () => {
    const { token } = await signUp();
    const { body } = await startTopup(token, 500_000);
    const pending = await request(app)
      .get(`/topups/${body.topupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(pending.body).toMatchObject({
      id: body.topupId,
      status: 'pending',
      amount: { kobo: 500_000, usdc: '3.1250000' },
    });

    f.state.verify.set(body.reference, {
      status: 'success',
      amountKobo: 500_000,
      currency: 'NGN',
      paidAt: clock(),
      gatewayResponse: 'Successful',
    });
    const credited = await request(app)
      .get(`/topups/${body.topupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(credited.body.status).toBe('credited');
    expect(credited.body.stellarTxHash).toBe(f.state.sent.get(body.topupId)!.hash);
  });

  it("a failed Paystack payment shows failed; another woman's top-up is 404", async () => {
    const { token } = await signUp();
    const { body } = await startTopup(token);
    f.state.verify.set(body.reference, {
      status: 'failed',
      amountKobo: 200_000,
      currency: 'NGN',
      paidAt: null,
      gatewayResponse: 'Declined',
    });
    expect(
      (await request(app).get(`/topups/${body.topupId}`).set('Authorization', `Bearer ${token}`))
        .body.status,
    ).toBe('failed');

    const other = await signUp();
    expect(
      (
        await request(app)
          .get(`/topups/${body.topupId}`)
          .set('Authorization', `Bearer ${other.token}`)
      ).status,
    ).toBe(404);
  });
});

describe('crediting never pays twice', () => {
  async function paidTopup() {
    const { token, userId } = await signUp();
    await vi.waitFor(
      async () =>
        expect(
          (await db.wallet.findUniqueOrThrow({ where: { userId } })).activatedAt,
        ).not.toBeNull(),
      wait,
    );
    const { body } = await startTopup(token);
    const services = buildServices({
      config: testConfig(),
      db,
      logger: createLogger('silent'),
      clock,
      paystack: f.paystack,
      topupChain: f.topupChain,
      walletChain: f.walletChain,
    });
    await services.topups.markPaid(
      body.reference,
      { amountKobo: 200_000, currency: 'NGN', paidAt: null },
      'verify',
    );
    return { services, topupId: body.topupId as string, userId, token };
  }

  it('a payment that landed but was never recorded is found by its memo, not sent again', async () => {
    const { services, topupId } = await paidTopup();
    f.state.sendLandsThenThrows = true;
    expect((await services.topups.credit(topupId)).status).toBe('SUBMITTED'); // error recorded
    f.state.sendLandsThenThrows = false;
    const done = await services.topups.credit(topupId);
    expect(done.status).toBe('CONFIRMED');
    expect(f.state.sendCalls).toBe(1);
    expect(done.stellarTxHash).toBe(f.state.sent.get(topupId)!.hash);
  });

  it('concurrent credits send one payment', async () => {
    const { services, topupId } = await paidTopup();
    await Promise.all([
      services.topups.credit(topupId),
      services.topups.credit(topupId),
      services.topups.credit(topupId),
    ]);
    expect((await topupRow(topupId)).status).toBe('CONFIRMED');
    expect(f.state.sendCalls).toBe(1);
  });

  it('Stellar down: stays paid with the reason, and the loop retries after the backoff', async () => {
    const { services, topupId } = await paidTopup();
    f.state.sendFails = new Error('stellar: tx_failed [op_underfunded]');
    expect(await services.topups.credit(topupId)).toMatchObject({
      status: 'SUBMITTED',
      failureReason: 'stellar: tx_failed [op_underfunded]',
    });

    f.state.sendFails = null;
    clock.advance(30_000);
    await services.topups.processPending(50);
    expect((await topupRow(topupId)).status).toBe('SUBMITTED'); // 1-minute backoff not over
    clock.advance(31_000);
    await services.topups.processPending(50);
    expect((await topupRow(topupId)).status).toBe('CONFIRMED');
  });

  it('a pending wallet is activated before the credit; if it cannot be, the credit waits', async () => {
    f.state.walletChainDown = true;
    const { token, userId } = await signUp();
    const { body } = await startTopup(token);
    const services = buildServices({
      config: testConfig(),
      db,
      logger: createLogger('silent'),
      clock,
      paystack: f.paystack,
      topupChain: f.topupChain,
      walletChain: f.walletChain,
    });
    await services.topups.markPaid(
      body.reference,
      { amountKobo: 200_000, currency: 'NGN', paidAt: null },
      'verify',
    );
    expect(await services.topups.credit(body.topupId)).toMatchObject({
      status: 'SUBMITTED',
      failureReason: 'wallet not active yet',
    });

    f.state.walletChainDown = false;
    clock.advance(2 * MINUTE);
    expect((await services.topups.credit(body.topupId)).status).toBe('CONFIRMED');
    expect((await db.wallet.findUniqueOrThrow({ where: { userId } })).activatedAt).not.toBeNull();
  });
});

describe('background loop: unpaid top-ups', () => {
  it('checks unpaid top-ups with Paystack and closes ones abandoned for 24 hours', async () => {
    const { token } = await signUp();
    const paidLater = (await startTopup(token)).body;
    const neverPaid = (await startTopup(token)).body;
    const services = buildServices({
      config: testConfig(),
      db,
      logger: createLogger('silent'),
      clock,
      paystack: f.paystack,
      topupChain: f.topupChain,
      walletChain: f.walletChain,
    });

    clock.advance(30_000);
    await services.topups.processPending(50);
    expect((await topupRow(paidLater.topupId)).status).toBe('PENDING'); // too new to check

    f.state.verify.set(paidLater.reference, {
      status: 'success',
      amountKobo: 200_000,
      currency: 'NGN',
      paidAt: clock(),
      gatewayResponse: 'Successful',
    });
    clock.advance(MINUTE);
    await services.topups.processPending(50);
    expect((await topupRow(paidLater.topupId)).status).toBe('CONFIRMED');
    expect((await topupRow(neverPaid.topupId)).status).toBe('PENDING');

    clock.advance(24 * 60 * MINUTE);
    await services.topups.processPending(50);
    expect(await topupRow(neverPaid.topupId)).toMatchObject({
      status: 'FAILED',
      failureReason: 'abandoned',
    });

    // She finally pays a day late: still honoured.
    await services.topups.markPaid(
      neverPaid.reference,
      { amountKobo: 200_000, currency: 'NGN', paidAt: null },
      'webhook',
    );
    expect((await services.topups.credit(neverPaid.topupId)).status).toBe('CONFIRMED');
  });
});
