// Z8: pay on delivery (x402), free answers, nurse payouts, the API's own agent, feedback.
// Real test database; the facilitator, Stellar and the x402 signer are fakes.
import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import { FacilitatorTimeoutError, SettleError } from '@x402/core/types';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db.js';
import type { AnswerPaymentChain } from '../src/modules/payments/chain.js';
import type { AnswerPayer } from '../src/modules/payments/x402-client.js';
import type { TopupChain } from '../src/modules/topups/chain.js';
import type { WalletChain } from '../src/modules/wallets/chain.js';
import { buildTestApp, fakeClock, memoryEmailSender } from './helpers/app.js';
import { testConfig, testDatabaseUrl } from './helpers/env.js';
import { createNurse, ensureTopics, signUpWoman } from './helpers/people.js';

const db = createDb(testDatabaseUrl());
beforeAll(() => ensureTopics(db));
afterAll(() => db.$disconnect());

const MINUTE = 60_000;
const PAY_TO = Keypair.random().publicKey();
const PRICE_STROOPS = 3_125_000n; // ₦500 at ₦1,600 / USDC
const ANSWER_TEXT = 'Swelling of the feet at 30 weeks is common. Rest with your feet raised.';
/** A fresh 64-hex hash: stellarTxHash is unique across the whole test database. */
const txHash = () => randomBytes(32).toString('hex');

// ------------------------------------------------------------------ fakes

function fakeFacilitator() {
  const settled: string[] = [];
  return {
    settled,
    verify: vi.fn<FacilitatorClient['verify']>(async (payload) => ({
      isValid: true,
      payer: (payload.payload as { payer?: string }).payer,
    })),
    settle: vi.fn<FacilitatorClient['settle']>(async () => {
      const transaction = txHash();
      settled.push(transaction);
      return { success: true, transaction, network: 'stellar:testnet' };
    }),
    getSupported: vi.fn<FacilitatorClient['getSupported']>(async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
      extensions: [],
      signers: {},
    })),
  };
}

/** Signs nothing: builds a v2 payload that accepts the first requirement. */
function fakePayer(): AnswerPayer & { calls: number } {
  const payer = {
    calls: 0,
    async createPaymentHeader(secret: string, requiredHeader: string) {
      payer.calls++;
      const required = decodePaymentRequiredHeader(requiredHeader);
      return encodePaymentSignatureHeader({
        x402Version: 2,
        resource: required.resource,
        accepted: required.accepts[0]!,
        payload: { transaction: 'fake-signed-xdr', payer: Keypair.fromSecret(secret).publicKey() },
      });
    },
  };
  return payer;
}

function fakeTreasury(): TopupChain & {
  sent: { to: string; stroops: bigint; memo: string; txHash: string }[];
} {
  const sent: { to: string; stroops: bigint; memo: string; txHash: string }[] = [];
  return {
    sent,
    async sendUsdc(to, stroops, memo) {
      const hash = txHash();
      sent.push({ to, stroops, memo, txHash: hash });
      return { txHash: hash };
    },
    async findTreasuryPaymentByMemo(memo) {
      return sent.find((s) => s.memo === memo)?.txHash ?? null;
    },
  };
}

function fakeWalletChain(balance: () => bigint): WalletChain {
  return {
    async accountState() {
      return { exists: true, hasUsdcTrustline: true, usdcStroops: balance(), sponsor: null };
    },
    async activate() {
      return { txHash: txHash() };
    },
  };
}

// ------------------------------------------------------------------ setup

let clock: ReturnType<typeof fakeClock>;
let facilitator: ReturnType<typeof fakeFacilitator>;
let payer: ReturnType<typeof fakePayer>;
let treasury: ReturnType<typeof fakeTreasury>;
let chainHits: Map<string, string>;
let balance: bigint;
let app: ReturnType<typeof buildTestApp>;
let mail: ReturnType<typeof memoryEmailSender>;

const answerChain: AnswerPaymentChain = {
  findTransfer: async ({ payer: from }) => chainHits.get(from) ?? null,
};

beforeEach(() => {
  clock = fakeClock(new Date());
  facilitator = fakeFacilitator();
  payer = fakePayer();
  treasury = fakeTreasury();
  chainHits = new Map();
  balance = 10_000_000n; // 1 USDC
  mail = memoryEmailSender();
  app = buildTestApp(db, {
    clock,
    emailSender: mail,
    facilitator,
    answerPayer: payer,
    answerChain,
    payoutChain: treasury,
    walletChain: fakeWalletChain(() => balance),
    config: {
      x402: { ...testConfig().x402, facilitatorApiKey: 'test', payToAddress: PAY_TO },
    },
  });
});

/** A signed-in woman with an active wallet. */
async function woman(opts: { freeAnswersUsed?: number } = {}) {
  const w = await signUpWoman(app, mail);
  await db.user.update({
    where: { id: w.userId },
    data: { freeAnswersUsed: opts.freeAnswersUsed ?? 3 },
  });
  const wallet = await db.wallet.update({
    where: { userId: w.userId },
    data: { activatedAt: clock() },
  });
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${w.token}`);
  return {
    ...w,
    wallet,
    get: (p: string, headers: Record<string, string> = {}) => {
      let r = auth(request(app).get(p));
      for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
      return r;
    },
    post: (p: string, body: object = {}) => auth(request(app).post(p)).send(body),
  };
}

/** A question in any state; answered ones have a nurse's answer. */
async function question(
  womanId: string,
  opts: { status?: 'OPEN' | 'ANSWERED' | 'EXPIRED'; isFree?: boolean } = {},
) {
  const status = opts.status ?? 'ANSWERED';
  const nurse = await createNurse(db);
  const now = clock();
  const q = await db.question.create({
    data: {
      womanId,
      source: 'WEB',
      status,
      originalText: 'my feet dey swell, im 30 weeks',
      cleanedText: 'My feet are swelling. I am 30 weeks pregnant.',
      topicSlug: 'pregnancy',
      expiresAt: new Date(now.getTime() + 30 * MINUTE),
      priceKobo: 50_000,
      priceStroops: PRICE_STROOPS,
      isFree: opts.isFree ?? false,
      answeredAt: status === 'ANSWERED' ? now : null,
      expiredAt: status === 'EXPIRED' ? now : null,
      consent: { create: { sharedFields: ['CLEANED_TEXT', 'CATEGORY'], consentVersion: 'v1' } },
    },
  });
  if (status === 'ANSWERED') {
    const claim = await db.claim.create({
      data: {
        questionId: q.id,
        nurseId: nurse.userId,
        status: 'ANSWERED',
        expiresAt: new Date(now.getTime() + 10 * MINUTE),
        endedAt: now,
      },
    });
    await db.answer.create({
      data: { questionId: q.id, claimId: claim.id, nurseId: nurse.userId, text: ANSWER_TEXT },
    });
  }
  return { ...q, nurseId: nurse.userId };
}

const paymentOf = (questionId: string) =>
  db.payment.findUnique({ where: { questionId }, include: { payout: true } });

/** 402 -> sign -> paid retry, like any x402 agent. */
async function payDirectly(w: Awaited<ReturnType<typeof woman>>, questionId: string) {
  const first = await w.get(`/questions/${questionId}/answer`);
  expect(first.status).toBe(402);
  const secret = Keypair.random().secret();
  const header = await payer.createPaymentHeader(
    secret,
    first.headers['payment-required'] as string,
  );
  return w.get(`/questions/${questionId}/answer`, { 'PAYMENT-SIGNATURE': header });
}

// ------------------------------------------------------------------ guard

describe('pay-on-delivery guard', () => {
  it('unanswered -> 409 QUESTION_NOT_ANSWERED, no 402, nothing charged', async () => {
    const w = await woman();
    const q = await question(w.userId, { status: 'OPEN' });
    const res = await w.get(`/questions/${q.id}/answer`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUESTION_NOT_ANSWERED');
    expect(res.headers['payment-required'] as string).toBeUndefined();
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
    expect(await paymentOf(q.id)).toBeNull();
  });

  it("expired -> 410 QUESTION_EXPIRED; someone else's question -> 404", async () => {
    const w = await woman();
    const expired = await question(w.userId, { status: 'EXPIRED' });
    const res = await w.get(`/questions/${expired.id}/answer`);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('QUESTION_EXPIRED');

    const other = await woman();
    const theirs = await question(other.userId);
    expect((await w.get(`/questions/${theirs.id}/answer`)).status).toBe(404);
  });

  it('nurses cannot fetch answers (woman-only)', async () => {
    const res = await request(app).get('/questions/x/answer');
    expect(res.status).toBe(401);
  });
});

// ------------------------------------------------------------------ x402 paid

describe('paid answer over x402', () => {
  it('402 with requirements: exact USDC stroops to the platform address', async () => {
    const w = await woman();
    const q = await question(w.userId);
    const res = await w.get(`/questions/${q.id}/answer`);
    expect(res.status).toBe(402);
    expect(res.body.answer).toBeUndefined();
    const required = decodePaymentRequiredHeader(res.headers['payment-required'] as string);
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'stellar:testnet',
      payTo: PAY_TO,
      amount: PRICE_STROOPS.toString(),
    });
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('paid answer: settles, records payment + 80% payout with both hashes, returns the answer', async () => {
    const w = await woman();
    const q = await question(w.userId);
    const res = await payDirectly(w, q.id);

    expect(res.status).toBe(200);
    expect(res.body.answer.text).toBe(ANSWER_TEXT);
    expect(res.body.payment).toEqual({
      amount: { kobo: 50_000, usdc: '0.3125000' },
      stellarTxHash: facilitator.settled[0],
      paidFromTreasury: false,
    });
    expect(decodePaymentResponseHeader(res.headers['payment-response'] as string).transaction).toBe(
      facilitator.settled[0],
    );

    const p = await paymentOf(q.id);
    expect(p).toMatchObject({
      source: 'WOMAN_WALLET',
      status: 'CONFIRMED',
      amountStroops: PRICE_STROOPS,
      platformFeeStroops: 625_000n,
      stellarTxHash: facilitator.settled[0],
    });
    expect(p!.payout).toMatchObject({
      nurseId: q.nurseId,
      amountKobo: 40_000,
      amountStroops: 2_500_000n,
      fromTreasury: false,
    });
    await vi.waitFor(async () => expect((await paymentOf(q.id))!.payout!.status).toBe('CONFIRMED'));
    expect((await paymentOf(q.id))!.payout!.stellarTxHash).toBe(treasury.sent[0]!.txHash);
    expect(treasury.sent).toEqual([
      {
        to: expect.any(String),
        stroops: 2_500_000n,
        memo: p!.payout!.id,
        txHash: expect.any(String),
      },
    ]);
    expect((await db.question.findUnique({ where: { id: q.id } }))!.collectedAt).not.toBeNull();
  });

  it('repeated fetch returns the same answer and never charges or pays twice', async () => {
    const w = await woman();
    const q = await question(w.userId);
    await payDirectly(w, q.id);
    const again = await w.get(`/questions/${q.id}/answer`);
    expect(again.status).toBe(200);
    expect(again.body.answer.text).toBe(ANSWER_TEXT);
    expect(again.body.payment.stellarTxHash).toBe(facilitator.settled[0]);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
    expect(await db.payout.count({ where: { payment: { questionId: q.id } } })).toBe(1);
  });

  it('SETTLEMENT FAILS: no answer text is returned and nothing is recorded as paid', async () => {
    facilitator.settle.mockResolvedValueOnce({
      success: false,
      errorReason: 'insufficient_funds',
      transaction: '',
      network: 'stellar:testnet',
    });
    const w = await woman();
    const q = await question(w.userId);
    const res = await payDirectly(w, q.id);

    expect(res.status).toBe(402);
    expect(JSON.stringify(res.body)).not.toContain(ANSWER_TEXT);
    expect(res.text).not.toContain(ANSWER_TEXT);
    const p = await paymentOf(q.id);
    expect(p!.status).toBe('FAILED');
    expect(p!.stellarTxHash).toBeNull();
    expect(p!.payout).toBeNull();
    expect((await db.question.findUnique({ where: { id: q.id } }))!.collectedAt).toBeNull();

    // She can pay again; the failed row is reused.
    const retry = await payDirectly(w, q.id);
    expect(retry.status).toBe(200);
    expect((await paymentOf(q.id))!.attempts).toBe(2);
  });

  it('facilitator 429 on settle -> 503 retryable, not charged, can pay again', async () => {
    facilitator.settle.mockRejectedValueOnce(
      new Error('Facilitator settle failed (429): slow down'),
    );
    const w = await woman();
    const q = await question(w.userId);
    const res = await payDirectly(w, q.id);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      details: { retryable: true },
    });
    expect(res.text).not.toContain(ANSWER_TEXT);
    expect((await paymentOf(q.id))!.status).toBe('FAILED');
    expect((await payDirectly(w, q.id)).status).toBe(200);
  });

  it('facilitator 5xx on verify -> 503 retryable, nothing recorded', async () => {
    facilitator.verify.mockRejectedValueOnce(
      new Error('Facilitator verify failed (502): bad gateway'),
    );
    const w = await woman();
    const q = await question(w.userId);
    const res = await payDirectly(w, q.id);
    expect(res.status).toBe(503);
    expect(res.body.error.details.retryable).toBe(true);
    expect(await paymentOf(q.id)).toBeNull();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it.each([
    ['timeout', () => new FacilitatorTimeoutError('settle', 30_000)],
    [
      '5xx',
      () => new SettleError(502, { success: false, transaction: '', network: 'stellar:testnet' }),
    ],
  ])(
    'settle %s is indeterminate: kept PENDING, reconciled on chain before any new payment',
    async (_name, makeError) => {
      facilitator.settle.mockRejectedValueOnce(makeError());
      const w = await woman();
      const q = await question(w.userId);
      const res = await payDirectly(w, q.id);
      expect(res.status).toBe(503);
      expect(res.body.error.details).toMatchObject({ retryable: true, paymentPending: true });
      expect(res.text).not.toContain(ANSWER_TEXT);
      const pending = await paymentOf(q.id);
      expect(pending!.status).toBe('PENDING');
      expect(pending!.payout).toBeNull();

      // Not on chain yet and still inside the deadline: wait, do not ask for a new payment.
      const waiting = await w.get(`/questions/${q.id}/answer`);
      expect(waiting.status).toBe(503);
      expect(waiting.headers['payment-required'] as string).toBeUndefined();

      // It did go through: found by tx hash, confirmed, no second settle.
      const onChain = txHash();
      chainHits.set(pending!.payerAddress!, onChain);
      const found = await w.get(`/questions/${q.id}/answer`);
      expect(found.status).toBe(200);
      expect(found.body.payment.stellarTxHash).toBe(onChain);
      expect(facilitator.settle).toHaveBeenCalledTimes(1);
      expect((await paymentOf(q.id))!.payout).not.toBeNull();
    },
  );

  it('an indeterminate attempt not on chain after its deadline is failed, and she can pay again', async () => {
    facilitator.settle.mockRejectedValueOnce(new FacilitatorTimeoutError('settle', 30_000));
    const w = await woman();
    const q = await question(w.userId);
    await payDirectly(w, q.id);
    clock.advance(4 * MINUTE);
    const res = await w.get(`/questions/${q.id}/answer`);
    expect(res.status).toBe(402);
    expect((await paymentOf(q.id))!.status).toBe('FAILED');
    expect((await payDirectly(w, q.id)).status).toBe(200);
  });

  it('a payment that does not match the requirements is refused with a new 402', async () => {
    const w = await woman();
    const q = await question(w.userId);
    const first = await w.get(`/questions/${q.id}/answer`);
    const required = decodePaymentRequiredHeader(first.headers['payment-required'] as string);
    const cheap = encodePaymentSignatureHeader({
      x402Version: 2,
      resource: required.resource,
      accepted: { ...required.accepts[0]!, amount: '1' },
      payload: { transaction: 'x' },
    });
    const res = await w.get(`/questions/${q.id}/answer`, { 'PAYMENT-SIGNATURE': cheap });
    expect(res.status).toBe(402);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ free

describe('free answers', () => {
  it('free answer: no payment asked, nothing charged, the treasury pays the nurse 80%', async () => {
    const w = await woman({ freeAnswersUsed: 0 });
    const q = await question(w.userId, { isFree: true });
    const res = await w.get(`/questions/${q.id}/answer`);
    expect(res.status).toBe(200);
    expect(res.body.answer.text).toBe(ANSWER_TEXT);
    expect(res.body.payment).toEqual({
      amount: { kobo: 0, usdc: '0.0000000' },
      stellarTxHash: null,
      paidFromTreasury: true,
    });
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
    expect((await db.user.findUnique({ where: { id: w.userId } }))!.freeAnswersUsed).toBe(1);
    const p = await paymentOf(q.id);
    expect(p).toMatchObject({ source: 'TREASURY_FREE', amountStroops: 0n, status: 'CONFIRMED' });
    expect(p!.payout).toMatchObject({ amountStroops: 2_500_000n, fromTreasury: true });
    await vi.waitFor(async () => expect((await paymentOf(q.id))!.payout!.status).toBe('CONFIRMED'));
  });

  it('quoted free but her 3 are used: she pays', async () => {
    const w = await woman({ freeAnswersUsed: 3 });
    const q = await question(w.userId, { isFree: true });
    expect((await w.get(`/questions/${q.id}/answer`)).status).toBe(402);
  });
});

// ------------------------------------------------------------------ collect (our agent)

describe("POST /me/questions/:id/collect (the API's own agent)", () => {
  it('pays over x402 from her custodial wallet and returns the answer', async () => {
    const w = await woman();
    const q = await question(w.userId);
    const res = await w.post(`/me/questions/${q.id}/collect`);
    expect(res.status).toBe(200);
    expect(res.body.answer.text).toBe(ANSWER_TEXT);
    expect(res.body.payment.paidFromTreasury).toBe(false);
    expect(payer.calls).toBe(1);
    // The payer is her own wallet.
    expect((await paymentOf(q.id))!.payerAddress).toBe(w.wallet.stellarPublicKey);

    // Collecting again does not pay again.
    expect((await w.post(`/me/questions/${q.id}/collect`)).status).toBe(200);
    expect(payer.calls).toBe(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it('free answer: no signing at all', async () => {
    const w = await woman({ freeAnswersUsed: 2 });
    const q = await question(w.userId, { isFree: true });
    const res = await w.post(`/me/questions/${q.id}/collect`);
    expect(res.status).toBe(200);
    expect(res.body.payment.paidFromTreasury).toBe(true);
    expect(payer.calls).toBe(0);
  });

  it('above her spending limit -> 409 unless approved', async () => {
    const w = await woman();
    await db.userSettings.upsert({
      where: { userId: w.userId },
      update: { spendingLimitPerAnswerKobo: 20_000 },
      create: { userId: w.userId, spendingLimitPerAnswerKobo: 20_000 },
    });
    const q = await question(w.userId);
    const res = await w.post(`/me/questions/${q.id}/collect`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'SPENDING_LIMIT_EXCEEDED',
      details: { priceKobo: 50_000, spendingLimitKobo: 20_000 },
    });
    expect(payer.calls).toBe(0);
    const approved = await w.post(`/me/questions/${q.id}/collect`, { approvedAboveLimit: true });
    expect(approved.status).toBe(200);
  });

  it('not enough in her wallet -> 409 INSUFFICIENT_BALANCE, nothing signed', async () => {
    balance = 1_000_000n;
    const w = await woman();
    const q = await question(w.userId);
    const res = await w.post(`/me/questions/${q.id}/collect`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(payer.calls).toBe(0);
  });

  it('unanswered -> 409 before any check or signing', async () => {
    const w = await woman();
    const q = await question(w.userId, { status: 'OPEN' });
    const res = await w.post(`/me/questions/${q.id}/collect`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUESTION_NOT_ANSWERED');
    expect(payer.calls).toBe(0);
  });

  it('settlement fails -> 503, not charged, no answer text', async () => {
    facilitator.settle.mockResolvedValueOnce({
      success: false,
      errorReason: 'invalid_signature',
      transaction: '',
      network: 'stellar:testnet',
    });
    const w = await woman();
    const q = await question(w.userId);
    const res = await w.post(`/me/questions/${q.id}/collect`);
    expect(res.status).toBe(503);
    expect(res.text).not.toContain(ANSWER_TEXT);
    expect((await paymentOf(q.id))!.status).toBe('FAILED');
  });

  it('the answer shows in her list only after collection', async () => {
    const w = await woman();
    const q = await question(w.userId);
    expect((await w.get(`/me/questions/${q.id}`)).body.answer).toBeNull();
    await w.post(`/me/questions/${q.id}/collect`);
    expect((await w.get(`/me/questions/${q.id}`)).body.answer.text).toBe(ANSWER_TEXT);
  });
});

// ------------------------------------------------------------------ feedback

describe('POST /questions/:id/feedback', () => {
  it('needs a collected answer; updates the nurse % helpful; can be changed', async () => {
    const w = await woman();
    const q = await question(w.userId);
    const early = await w.post(`/questions/${q.id}/feedback`, { helpful: true });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('QUESTION_NOT_ANSWERED');

    await w.post(`/me/questions/${q.id}/collect`);
    const res = await w.post(`/questions/${q.id}/feedback`, { helpful: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ questionId: q.id, helpful: true });
    let nurse = await db.nurseProfile.findUnique({ where: { userId: q.nurseId } });
    expect(nurse).toMatchObject({ helpfulCount: 1, feedbackCount: 1 });

    await w.post(`/questions/${q.id}/feedback`, { helpful: false });
    nurse = await db.nurseProfile.findUnique({ where: { userId: q.nurseId } });
    expect(nurse).toMatchObject({ helpfulCount: 0, feedbackCount: 1 });
    expect(await db.feedback.count({ where: { answer: { questionId: q.id } } })).toBe(1);
  });

  it('validates the body', async () => {
    const w = await woman();
    const q = await question(w.userId);
    const res = await w.post(`/questions/${q.id}/feedback`, { helpful: 'yes' });
    expect(res.status).toBe(400);
  });
});

// ------------------------------------------------------------------ payouts loop

describe('payout retries', () => {
  it('a failed payout is retried by the loop and sent once (memo = payout id)', async () => {
    const failing = fakeTreasury();
    let fail = true;
    const flaky: TopupChain = {
      findTreasuryPaymentByMemo: (m) => failing.findTreasuryPaymentByMemo(m),
      sendUsdc: async (...args) => {
        if (fail) throw new Error('stellar: tx_bad_seq');
        return failing.sendUsdc(...args);
      },
    };
    const { buildServices } = await import('../src/app.js');
    const { createLogger } = await import('../src/lib/logger.js');
    const deps = {
      config: testConfig({
        x402: { ...testConfig().x402, facilitatorApiKey: 'test', payToAddress: PAY_TO },
      }),
      db,
      logger: createLogger('silent'),
      clock,
      emailSender: mail,
      facilitator,
      answerPayer: payer,
      answerChain,
      payoutChain: flaky,
      walletChain: fakeWalletChain(() => balance),
    };
    const services = buildServices(deps);
    const { createApp } = await import('../src/app.js');
    const flakyApp = createApp(deps, services);
    const w = await signUpWoman(flakyApp, mail);
    const q = await question(w.userId, { isFree: true });
    const res = await request(flakyApp)
      .get(`/questions/${q.id}/answer`)
      .set('Authorization', `Bearer ${w.token}`);
    expect(res.status).toBe(200); // the answer is never held back by a payout

    await vi.waitFor(async () =>
      expect((await paymentOf(q.id))!.payout!.failureReason).toContain('tx_bad_seq'),
    );
    fail = false;
    clock.advance(2 * MINUTE);
    const result = await services.payouts.processPending();
    expect(result.confirmed).toBeGreaterThanOrEqual(1);
    const payout = (await paymentOf(q.id))!.payout!;
    expect(payout.status).toBe('CONFIRMED');
    expect(failing.sent.filter((s) => s.memo === payout.id)).toHaveLength(1);
  });
});
