// Z10: nurse earnings (N09) and withdrawals. Real test database; Stellar is faked.
import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { lagosMonthStart, questionTitle } from '../src/modules/nurses/earnings.js';
import {
  StellarRejectedError,
  type DestinationState,
  type WithdrawalChain,
} from '../src/modules/payments/withdrawal-chain.js';
import type { WalletChain } from '../src/modules/wallets/chain.js';
import { buildTestApp, fakeClock, memoryEmailSender } from './helpers/app.js';
import { testDatabaseUrl } from './helpers/env.js';
import { createNurse, ensureTopics } from './helpers/people.js';

const db = createDb(testDatabaseUrl());
beforeAll(() => ensureTopics(db));
afterAll(() => db.$disconnect());

const MINUTE = 60_000;
// Wednesday 18 Nov 2026, 13:00 Lagos. Lagos week = Mon 16 .. Sun 22; month from 1 Nov.
const NOW = new Date('2026-11-18T12:00:00.000Z');
const PAYOUT = { kobo: 40_000, stroops: 2_500_000n }; // ₦400 = 0.25 USDC at ₦1,600
const hash = () => randomBytes(32).toString('hex');

// ------------------------------------------------------------------ fakes

type SendMode = 'ok' | 'reject' | 'unknown';

function fakeWithdrawalChain() {
  const sent: { from: string; to: string; stroops: bigint; memo: string; txHash: string }[] = [];
  const onChain = new Map<string, string>(); // memo -> hash (landed even if the send "timed out")
  const chain: WithdrawalChain & {
    sent: typeof sent;
    onChain: typeof onChain;
    mode: SendMode;
    destination: DestinationState;
  } = {
    sent,
    onChain,
    mode: 'ok',
    destination: { exists: true, hasUsdcTrustline: true },
    async destinationState() {
      return chain.destination;
    },
    async send(from, to, stroops, memo) {
      if (chain.mode === 'reject')
        throw new StellarRejectedError('stellar: tx_failed [op_underfunded]');
      const txHash = hash();
      sent.push({ from: from.publicKey(), to, stroops, memo, txHash });
      if (chain.mode === 'unknown') {
        onChain.set(memo, txHash);
        throw new Error('stellar request failed: timeout of 30000ms exceeded');
      }
      return { txHash };
    },
    async findByMemo(_account, memo) {
      return onChain.get(memo) ?? null;
    },
  };
  return chain;
}

function fakeWalletChain(balance: () => bigint): WalletChain {
  return {
    async accountState() {
      return { exists: true, hasUsdcTrustline: true, usdcStroops: balance(), sponsor: null };
    },
    async activate() {
      return { txHash: hash() };
    },
  };
}

// ------------------------------------------------------------------ setup

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
let chain: ReturnType<typeof fakeWithdrawalChain>;
let balance: bigint;
let app: ReturnType<typeof buildTestApp>;

beforeEach(() => {
  clock = fakeClock(NOW);
  mail = memoryEmailSender();
  chain = fakeWithdrawalChain();
  balance = 10_000_000n; // 1 USDC = ₦1,600
  app = buildTestApp(db, {
    clock,
    emailSender: mail,
    withdrawalChain: chain,
    walletChain: fakeWalletChain(() => balance),
  });
});

/** A signed-in nurse with an active wallet. */
async function nurse() {
  const n = await createNurse(db);
  await db.wallet.update({ where: { userId: n.userId }, data: { activatedAt: clock() } });
  await request(app)
    .post('/auth/code/request')
    .send({ email: n.email, purpose: 'login', app: 'nurses' });
  const login = await request(app)
    .post('/auth/code/verify')
    .send({ email: n.email, code: mail.lastCode(n.email), purpose: 'login', app: 'nurses' });
  const token = login.body.accessToken as string;
  const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: n.userId } });
  const api = {
    get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
    post: (p: string, body: object = {}) =>
      request(app).post(p).set('Authorization', `Bearer ${token}`).send(body),
  };
  return {
    ...n,
    wallet,
    api,
    /** Verifies a fresh code on this session (5 minutes). */
    async stepUp() {
      await api.post('/auth/code/request', { email: n.email, purpose: 'step_up', app: 'nurses' });
      const res = await api.post('/auth/step-up', { code: mail.lastCode(n.email) });
      expect(res.status).toBe(200);
    },
  };
}

/** One collected answer and its payout for this nurse, at `at`. */
async function earning(
  nurseId: string,
  at: Date,
  opts: { text?: string; fromTreasury?: boolean; status?: 'CONFIRMED' | 'PENDING' } = {},
) {
  const q = await db.question.create({
    data: {
      source: 'WEB',
      status: 'ANSWERED',
      originalText: opts.text ?? 'swollen feet at 24 weeks',
      cleanedText: opts.text ?? 'Swollen feet at 24 weeks.',
      topicSlug: 'pregnancy',
      expiresAt: new Date(at.getTime() + 30 * MINUTE),
      priceKobo: 50_000,
      priceStroops: 3_125_000n,
      isFree: Boolean(opts.fromTreasury),
      createdAt: new Date(at.getTime() - 20 * MINUTE),
      answeredAt: at,
      collectedAt: at,
    },
  });
  const claim = await db.claim.create({
    data: { questionId: q.id, nurseId, status: 'ANSWERED', expiresAt: at, endedAt: at },
  });
  await db.answer.create({ data: { questionId: q.id, claimId: claim.id, nurseId, text: 'Rest.' } });
  const payment = await db.payment.create({
    data: {
      questionId: q.id,
      source: opts.fromTreasury ? 'TREASURY_FREE' : 'WOMAN_WALLET',
      amountKobo: opts.fromTreasury ? 0 : 50_000,
      amountStroops: opts.fromTreasury ? 0n : 3_125_000n,
      platformFeeStroops: opts.fromTreasury ? 0n : 625_000n,
      status: 'CONFIRMED',
      stellarTxHash: opts.fromTreasury ? null : hash(),
      createdAt: at,
    },
  });
  const status = opts.status ?? 'CONFIRMED';
  return db.payout.create({
    data: {
      paymentId: payment.id,
      nurseId,
      amountKobo: PAYOUT.kobo,
      amountStroops: PAYOUT.stroops,
      fromTreasury: Boolean(opts.fromTreasury),
      destinationAddress: Keypair.random().publicKey(),
      status,
      stellarTxHash: status === 'CONFIRMED' ? hash() : null,
      createdAt: at,
    },
  });
}

const dest = () => Keypair.random().publicKey();

// ------------------------------------------------------------------ earnings

describe('GET /nurse/earnings (N09)', () => {
  it('balance, Mon-Sun chart, this week, this month, all time, recent payments', async () => {
    const n = await nurse();
    const monday = new Date('2026-11-16T09:00:00.000Z'); // Mon 10:00 Lagos
    await earning(n.userId, monday);
    await earning(n.userId, new Date('2026-11-18T07:00:00.000Z'), { fromTreasury: true }); // Wed
    await earning(n.userId, new Date('2026-11-18T11:30:00.000Z'), {
      text: 'I missed two pills this week and had unprotected sex. What should I do now?',
      status: 'PENDING',
    }); // Wed, payout still being sent
    await earning(n.userId, new Date('2026-11-15T22:30:00.000Z')); // Sun 23:30 Lagos: last week
    await earning(n.userId, new Date('2026-11-03T10:00:00.000Z')); // this month, earlier week
    await earning(n.userId, new Date('2026-10-20T10:00:00.000Z')); // last month

    const res = await n.api.get('/nurse/earnings');
    expect(res.status).toBe(200);
    const e = res.body;

    expect(e.balance).toEqual({ kobo: 160_000, usdc: '1.0000000' });
    expect(e.available).toEqual(e.balance);
    expect(e.stellarAddress).toBe(n.wallet.stellarPublicKey);
    expect(e.payoutAddress).toBeNull();
    expect(e.totalEarned).toEqual({ kobo: 240_000, usdc: '1.5000000' });
    expect(e.answersCount).toBe(6);

    expect(e.thisWeek.from).toBe('2026-11-16');
    expect(e.thisWeek.total.kobo).toBe(120_000);
    expect(e.thisWeek.answersCount).toBe(3);
    expect(e.thisWeek.days.map((d: { weekday: string }) => d.weekday)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
    expect(e.thisWeek.days.map((d: { total: { kobo: number } }) => d.total.kobo)).toEqual([
      40_000, 0, 80_000, 0, 0, 0, 0,
    ]);
    expect(e.thisWeek.days[2]).toMatchObject({
      date: '2026-11-18',
      isToday: true,
      answersCount: 2,
    });
    expect(e.thisWeek.days[0].isToday).toBe(false);

    expect(e.thisMonth).toEqual({
      from: '2026-11-01',
      total: { kobo: 200_000, usdc: '1.2500000' },
      answersCount: 5,
    });

    expect(e.recent).toHaveLength(6);
    expect(e.recent[0]).toMatchObject({
      kind: 'earning',
      category: 'pregnancy',
      title: 'I missed two pills this week and had…',
      amount: { kobo: 40_000, usdc: '0.2500000' },
      status: 'pending',
      stellarTxHash: null,
      paidFromTreasury: false,
    });
    expect(e.recent[1]).toMatchObject({ paidFromTreasury: true, status: 'confirmed' });
  });

  it('a new nurse sees zeros, 7 empty days and no activity', async () => {
    balance = 0n;
    const n = await nurse();
    const res = await n.api.get('/nurse/earnings');
    expect(res.status).toBe(200);
    expect(res.body.totalEarned).toEqual({ kobo: 0, usdc: '0.0000000' });
    expect(res.body.thisWeek.days).toHaveLength(7);
    expect(res.body.recent).toEqual([]);
  });

  it('women cannot see nurse earnings', async () => {
    const res = await request(app).get('/nurse/earnings');
    expect(res.status).toBe(401);
  });
});

describe('helpers', () => {
  it('question titles are short and cut on a word', () => {
    expect(questionTitle('Swollen feet at 24 weeks.')).toBe('Swollen feet at 24 weeks.');
    expect(
      questionTitle('Is it normal to have  spotting   after starting the pill, three weeks in?'),
    ).toBe('Is it normal to have spotting after…');
  });

  it('Lagos month starts at 00:00 Lagos on the 1st', () => {
    expect(lagosMonthStart(new Date('2026-11-30T23:30:00.000Z')).toISOString()).toBe(
      '2026-11-30T23:00:00.000Z', // already 1 Dec in Lagos
    );
    expect(lagosMonthStart(NOW).toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });
});

// ------------------------------------------------------------------ withdrawals

describe('POST /nurse/withdrawals', () => {
  it('without a fresh code -> 403 STEP_UP_REQUIRED, nothing created or sent', async () => {
    const n = await nurse();
    const res = await n.api.post('/nurse/withdrawals', {
      amountKobo: 50_000,
      destination: { kind: 'stellar', address: dest() },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
    expect(await db.withdrawal.count({ where: { nurseId: n.userId } })).toBe(0);
    expect(chain.sent).toHaveLength(0);
  });

  it('a fresh code expires after 5 minutes', async () => {
    const n = await nurse();
    await n.stepUp();
    clock.advance(6 * MINUTE);
    const res = await n.api.post('/nurse/withdrawals', {
      amountKobo: 50_000,
      destination: { kind: 'stellar', address: dest() },
    });
    expect(res.status).toBe(403);
  });

  it('more than she has -> 409 INSUFFICIENT_BALANCE, nothing sent', async () => {
    const n = await nurse();
    await n.stepUp();
    const res = await n.api.post('/nurse/withdrawals', {
      amountKobo: 200_000, // ₦2,000 > ₦1,600
      destination: { kind: 'stellar', address: dest() },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      details: { available: { kobo: 160_000, usdc: '1.0000000' } },
    });
    expect(chain.sent).toHaveLength(0);
  });

  it('success: a real payment from her wallet, the hash is recorded', async () => {
    const n = await nurse();
    await n.stepUp();
    const to = dest();
    const res = await n.api.post('/nurse/withdrawals', {
      amountKobo: 100_000,
      destination: { kind: 'stellar', address: to },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'confirmed',
      amount: { kobo: 100_000, usdc: '0.6250000' },
      destinationAddress: to,
      failureReason: null,
    });
    expect(chain.sent).toHaveLength(1);
    expect(chain.sent[0]).toMatchObject({
      from: n.wallet.stellarPublicKey,
      to,
      stroops: 6_250_000n,
      memo: res.body.id,
    });
    expect(res.body.stellarTxHash).toBe(chain.sent[0]!.txHash);
    const row = await db.withdrawal.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ status: 'CONFIRMED', stellarTxHash: chain.sent[0]!.txHash });

    const list = await n.api.get('/nurse/withdrawals');
    expect(list.body.items).toHaveLength(1);
    const earnings = await n.api.get('/nurse/earnings');
    expect(earnings.body.recent[0]).toMatchObject({
      kind: 'withdrawal',
      amount: { kobo: -100_000, usdc: '-0.6250000' },
      status: 'confirmed',
    });
    const tx = await n.api.get('/wallet/transactions');
    expect(tx.body.items[0]).toMatchObject({
      kind: 'withdrawal',
      stellarTxHash: res.body.stellarTxHash,
    });
  });

  it('validates the address, the amount and the destination', async () => {
    const n = await nurse();
    await n.stepUp();
    const post = (amountKobo: number, address: string, kind = 'stellar') =>
      n.api.post('/nurse/withdrawals', { amountKobo, destination: { kind, address } });

    const bad = await post(50_000, 'GNOTREAL');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({
      code: 'STELLAR_ADDRESS_INVALID',
      details: { field: 'destination.address' },
    });
    expect((await post(50_000, n.wallet.stellarPublicKey)).body.error.code).toBe(
      'STELLAR_ADDRESS_INVALID',
    );
    expect((await post(5_000, dest())).body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'amountKobo' },
    });
    expect((await post(50_000, dest(), 'bank')).status).toBe(400);

    chain.destination = { exists: false, hasUsdcTrustline: false };
    expect((await post(50_000, dest())).body.error.message).toMatch(/No Stellar account/);
    chain.destination = { exists: true, hasUsdcTrustline: false };
    expect((await post(50_000, dest())).body.error.message).toMatch(/trustline/);
    expect(chain.sent).toHaveLength(0);
    expect(await db.withdrawal.count({ where: { nurseId: n.userId } })).toBe(0);
  });

  it('Stellar refuses -> 502 STELLAR_SUBMIT_FAILED, recorded as failed, nothing in flight', async () => {
    chain.mode = 'reject';
    const n = await nurse();
    await n.stepUp();
    const res = await n.api.post('/nurse/withdrawals', {
      amountKobo: 50_000,
      destination: { kind: 'stellar', address: dest() },
    });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('STELLAR_SUBMIT_FAILED');
    const row = await db.withdrawal.findFirstOrThrow({ where: { nurseId: n.userId } });
    expect(row).toMatchObject({ status: 'FAILED', stellarTxHash: null });

    // Nothing is held: she can try again right away.
    chain.mode = 'ok';
    const again = await n.api.post('/nurse/withdrawals', {
      amountKobo: 50_000,
      destination: { kind: 'stellar', address: dest() },
    });
    expect(again.status).toBe(201);
  });

  it('unknown outcome: 201 submitted, holds the amount, one in flight, then found by memo', async () => {
    chain.mode = 'unknown';
    const n = await nurse();
    await n.stepUp();
    const res = await n.api.post('/nurse/withdrawals', {
      amountKobo: 100_000,
      destination: { kind: 'stellar', address: dest() },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'submitted', stellarTxHash: null });

    // Not visible on Stellar yet: the amount is held while it is unresolved.
    chain.onChain.clear();
    const e = await n.api.get('/nurse/earnings');
    expect(e.body.available.kobo).toBe(60_000);
    expect(e.body.recent[0]).toMatchObject({ kind: 'withdrawal', status: 'submitted' });

    // A second withdrawal waits for the first.
    chain.mode = 'ok';
    const second = await n.api.post('/nurse/withdrawals', {
      amountKobo: 10_000,
      destination: { kind: 'stellar', address: dest() },
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');

    // It did land: the next read finds it by memo and records the hash. Never sent twice.
    chain.onChain.set(res.body.id, 'f'.repeat(64));
    const list = await n.api.get('/nurse/withdrawals');
    expect(list.body.items[0]).toMatchObject({
      status: 'confirmed',
      stellarTxHash: 'f'.repeat(64),
    });
    expect(chain.sent).toHaveLength(1);
  });

  it('unknown outcome not on Stellar after the payment window -> failed, nothing held', async () => {
    chain.mode = 'unknown';
    const n = await nurse();
    await n.stepUp();
    const res = await n.api.post('/nurse/withdrawals', {
      amountKobo: 100_000,
      destination: { kind: 'stellar', address: dest() },
    });
    chain.onChain.clear(); // it never landed
    clock.advance(4 * MINUTE);
    const list = await n.api.get('/nurse/withdrawals');
    expect(list.body.items[0]).toMatchObject({ id: res.body.id, status: 'failed' });
    const e = await n.api.get('/nurse/earnings');
    expect(e.body.available.kobo).toBe(160_000);
  });

  it('the database allows only one withdrawal in flight per nurse', async () => {
    const n = await nurse();
    await db.withdrawal.create({
      data: {
        nurseId: n.userId,
        amountKobo: 10_000,
        amountStroops: 625_000n,
        destinationAddress: dest(),
        status: 'SUBMITTED',
      },
    });
    await expect(
      db.withdrawal.create({
        data: {
          nurseId: n.userId,
          amountKobo: 10_000,
          amountStroops: 625_000n,
          destinationAddress: dest(),
          status: 'PENDING',
        },
      }),
    ).rejects.toThrow();
    // Finished ones do not count.
    await db.withdrawal.create({
      data: {
        nurseId: n.userId,
        amountKobo: 10_000,
        amountStroops: 625_000n,
        destinationAddress: dest(),
        status: 'CONFIRMED',
      },
    });
  });

  it('the loop settles stale withdrawals', async () => {
    const n = await nurse();
    const stale = await db.withdrawal.create({
      data: {
        nurseId: n.userId,
        amountKobo: 10_000,
        amountStroops: 625_000n,
        destinationAddress: dest(),
        status: 'PENDING',
        createdAt: new Date(clock().getTime() - 10 * MINUTE),
      },
    });
    const { buildServices } = await import('../src/app.js');
    const { createLogger } = await import('../src/lib/logger.js');
    const { testConfig } = await import('./helpers/env.js');
    const services = buildServices({
      config: testConfig(),
      db,
      logger: createLogger('silent'),
      clock,
      emailSender: mail,
      withdrawalChain: chain,
      walletChain: fakeWalletChain(() => balance),
    });
    const result = await services.earnings.processPending();
    expect(result.settled).toBeGreaterThanOrEqual(1);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe(
      'FAILED',
    );
  });
});
