// Z4 custodial wallets, against the real test database with a fake Stellar chain.
import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWalletService } from '../src/app.js';
import { createDb } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';
import { koboToStroops } from '../src/lib/money.js';
import {
  AccountAlreadyExistsError,
  type AccountState,
  type WalletChain,
} from '../src/modules/wallets/chain.js';
import {
  decryptWalletSecret,
  encryptWalletSecret,
  newCustodialWallet,
} from '../src/modules/wallets/crypto.js';
import { seed, SEED_EMAILS } from '../src/seed/seed.js';
import { buildTestApp, fakeClock, memoryEmailSender } from './helpers/app.js';
import { testConfig, testDatabaseUrl } from './helpers/env.js';

const db = createDb(testDatabaseUrl());
afterAll(() => db.$disconnect());

const KEY = testConfig().wallet.encryptionKey;
const MINUTE = 60_000;

// `null` = no chain (no treasury). Not `undefined`: a default parameter would replace it.
/** In-memory Stellar: accounts by address. Records every activate call. */
function fakeChain() {
  const accounts = new Map<string, { usdcStroops: bigint; trust: boolean }>();
  const state = {
    accounts,
    activateCalls: [] as string[],
    failActivate: null as Error | null,
    failBalance: false,
    /** Simulates "submitted, then crashed before we recorded it". */
    createWithoutReturning: false,
    delayMs: 0,
  };
  const chain: WalletChain = {
    async accountState(address): Promise<AccountState> {
      if (state.failBalance) throw new Error('stellar request failed: timeout');
      const a = accounts.get(address);
      return a
        ? {
            exists: true,
            hasUsdcTrustline: a.trust,
            usdcStroops: a.usdcStroops,
            sponsor: 'GTREASURY',
          }
        : { exists: false, hasUsdcTrustline: false, usdcStroops: 0n, sponsor: null };
    },
    async activate(kp: Keypair) {
      state.activateCalls.push(kp.publicKey());
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.failActivate) throw state.failActivate;
      if (accounts.has(kp.publicKey())) throw new AccountAlreadyExistsError();
      accounts.set(kp.publicKey(), { usdcStroops: 0n, trust: true });
      if (state.createWithoutReturning) throw new Error('stellar request failed: socket hang up');
      return { txHash: randomUUID().replace(/-/g, '').padEnd(64, '0') };
    },
  };
  return { chain, state };
}

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
let fake: ReturnType<typeof fakeChain>;

beforeEach(() => {
  clock = fakeClock();
  mail = memoryEmailSender();
  fake = fakeChain();
});

const deps = (chain: WalletChain | null = fake.chain) => ({
  config: testConfig(),
  db,
  logger: createLogger('silent'),
  clock,
  emailSender: mail,
  walletChain: chain ?? undefined,
});
const appWith = (chain: WalletChain | null = fake.chain) =>
  buildTestApp(db, { clock, emailSender: mail, walletChain: chain ?? undefined });

async function signUp(app: ReturnType<typeof buildTestApp>, appName: 'women' | 'nurses' = 'women') {
  const email = `w-${randomUUID().slice(0, 8)}@example.com`;
  await request(app)
    .post('/auth/code/request')
    .send({ email, purpose: 'signup', app: appName, name: 'Tolu' });
  const res = await request(app)
    .post('/auth/code/verify')
    .send({ email, code: mail.lastCode(email), purpose: 'signup', app: appName, name: 'Tolu' });
  expect(res.status).toBe(200);
  return { email, userId: res.body.user.id as string, token: res.body.accessToken as string };
}

const walletOf = (userId: string) => db.wallet.findUniqueOrThrow({ where: { userId } });
/** Background activation is fire-and-forget: wait for it (generous timeout: the test DB can be slow). */
const waitActive = (userId: string) =>
  vi.waitFor(async () => expect((await walletOf(userId)).activatedAt).not.toBeNull(), {
    timeout: 10_000,
    interval: 50,
  });

describe('wallet secret encryption (AES-256-GCM)', () => {
  it('round-trips, and the stored bytes never contain the secret', () => {
    const kp = Keypair.random();
    const blob = encryptWalletSecret(KEY, kp.secret(), kp.publicKey());
    expect(blob[0]).toBe(1); // version byte
    expect(blob.toString('utf8')).not.toContain(kp.secret());
    expect(decryptWalletSecret(KEY, blob, kp.publicKey())).toBe(kp.secret());
  });

  it("fails with the wrong key, tampered bytes, or another wallet's public key", () => {
    const kp = Keypair.random();
    const blob = encryptWalletSecret(KEY, kp.secret(), kp.publicKey());
    expect(() => decryptWalletSecret(Buffer.alloc(32, 9), blob, kp.publicKey())).toThrow();
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1]! ^= 0xff;
    expect(() => decryptWalletSecret(KEY, tampered, kp.publicKey())).toThrow();
    expect(() => decryptWalletSecret(KEY, blob, Keypair.random().publicKey())).toThrow();
  });

  it('newCustodialWallet gives a fresh keypair each time', () => {
    const a = newCustodialWallet(KEY);
    const b = newCustodialWallet(KEY);
    expect(a.stellarPublicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(a.stellarPublicKey).not.toBe(b.stellarPublicKey);
    expect(
      Keypair.fromSecret(
        decryptWalletSecret(KEY, a.encryptedSecret, a.stellarPublicKey),
      ).publicKey(),
    ).toBe(a.stellarPublicKey);
  });
});

describe('wallet at sign-up', () => {
  it('every new user gets a wallet in the same write, then it is activated on-chain', async () => {
    const app = appWith();
    const { userId } = await signUp(app);
    const pending = await walletOf(userId);
    expect(pending.stellarPublicKey).toMatch(/^G[A-Z2-7]{55}$/);

    await waitActive(userId);
    const active = await walletOf(userId);
    expect(active.activationTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(active.activationError).toBeNull();
    expect(fake.state.activateCalls).toEqual([active.stellarPublicKey]);
    expect(fake.state.accounts.get(active.stellarPublicKey)?.trust).toBe(true);
  });

  it('nurses get a wallet too', async () => {
    const { userId } = await signUp(appWith(), 'nurses');
    await waitActive(userId);
  });

  it('sign-up still succeeds when Stellar is down; the wallet stays pending with the reason', async () => {
    fake.state.failActivate = new Error('stellar: tx_bad_seq []');
    const { userId } = await signUp(appWith());
    await vi.waitFor(
      async () => expect((await walletOf(userId)).activationError).toContain('tx_bad_seq'),
      { timeout: 10_000, interval: 50 },
    );
    const w = await walletOf(userId);
    expect(w.activatedAt).toBeNull();
    expect(w.activationAttempts).toBe(1);
  });

  it('without a treasury (no chain) wallets are created but stay pending', async () => {
    const { userId } = await signUp(appWith(null));
    const w = await walletOf(userId);
    expect(w.activatedAt).toBeNull();
    expect(w.activationAttempts).toBe(0);
  });
});

describe('activation is safe to run many times', () => {
  async function pendingUser() {
    const { userId } = await signUp(appWith(null)); // no chain: stays pending
    return userId;
  }

  it('concurrent activations submit exactly one transaction', async () => {
    const userId = await pendingUser();
    fake.state.delayMs = 200;
    const wallets = buildWalletService(deps());
    const outcomes = await Promise.all([
      wallets.activate(userId),
      wallets.activate(userId),
      wallets.activate(userId),
    ]);
    // The invariant: exactly one activation and one Stellar transaction. The other calls are
    // "busy" (still running) or "already_active" (finished first on a slow database).
    expect(outcomes.filter((o) => o === 'activated')).toHaveLength(1);
    expect(
      outcomes
        .filter((o) => o !== 'activated')
        .every((o) => o === 'busy' || o === 'already_active'),
    ).toBe(true);
    expect(fake.state.activateCalls).toHaveLength(1);
    expect(await wallets.activate(userId)).toBe('already_active');
  });

  it('an account created by a crashed attempt is found and marked active without a second transaction', async () => {
    const userId = await pendingUser();
    const wallets = buildWalletService(deps());
    fake.state.createWithoutReturning = true;
    expect(await wallets.activate(userId)).toBe('failed'); // on-chain, but we never heard back
    expect((await walletOf(userId)).activatedAt).toBeNull();

    fake.state.createWithoutReturning = false;
    clock.advance(3 * MINUTE); // past the claim timeout
    expect(await wallets.activate(userId)).toBe('activated');
    expect(fake.state.activateCalls).toHaveLength(1);
    const w = await walletOf(userId);
    expect(w.activatedAt).not.toBeNull();
    expect(w.activationTxHash).toBeNull(); // hash unknown, but the account is verified on-chain
  });

  it('"account already exists" from Stellar is treated as success when the trustline is there', async () => {
    const userId = await pendingUser();
    const w = await walletOf(userId);
    // Exists on-chain but our accountState check raced: simulate by inserting after the first check.
    const wallets = buildWalletService(
      deps({
        accountState: (() => {
          let calls = 0;
          return async (address: string) => {
            calls++;
            if (calls === 1)
              return { exists: false, hasUsdcTrustline: false, usdcStroops: 0n, sponsor: null };
            return fake.chain.accountState(address);
          };
        })(),
        activate: async () => {
          fake.state.accounts.set(w.stellarPublicKey, { usdcStroops: 0n, trust: true });
          throw new AccountAlreadyExistsError();
        },
      }),
    );
    expect(await wallets.activate(userId)).toBe('activated');
  });

  it('a claim held by a live attempt blocks others; a stale one (crash) can be reclaimed after 2 minutes', async () => {
    const userId = await pendingUser();
    await db.wallet.update({ where: { userId }, data: { activationAttemptAt: clock() } });
    const wallets = buildWalletService(deps());
    expect(await wallets.activate(userId)).toBe('busy');
    clock.advance(2 * MINUTE + 1);
    expect(await wallets.activate(userId)).toBe('activated');
  });

  it('the background loop retries failed wallets with backoff (1, 2, 4... minutes)', async () => {
    // Other test files leave never-tried pending wallets behind; the loop takes those first (by
    // design), so take them out of the queue to keep this test about this wallet.
    await db.wallet.updateMany({ where: { activatedAt: null }, data: { activatedAt: clock() } });
    const userId = await pendingUser();
    const wallets = buildWalletService(deps());
    fake.state.failActivate = new Error('stellar request failed: timeout');
    expect(await wallets.activate(userId)).toBe('failed'); // attempt 1

    fake.state.failActivate = null;
    clock.advance(30_000);
    await wallets.activatePending(50);
    expect((await walletOf(userId)).activatedAt).toBeNull(); // backoff (1 min) not over

    clock.advance(31_000);
    await wallets.activatePending(50);
    expect((await walletOf(userId)).activatedAt).not.toBeNull();
  });
});

describe('GET /wallet', () => {
  it('active wallet: live USDC balance in naira and USDC, free answers left for women', async () => {
    const app = appWith();
    const { userId, token } = await signUp(app);
    await waitActive(userId);
    const w = await walletOf(userId);
    fake.state.accounts.get(w.stellarPublicKey)!.usdcStroops = koboToStroops(350_000, '1600'); // ₦3,500

    const res = await request(app).get('/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      stellarAddress: w.stellarPublicKey,
      status: 'active',
      balance: { kobo: 350_000, usdc: '2.1875000' },
      balanceSyncedAt: clock().toISOString(),
      freeAnswersRemaining: 3,
    });
    expect((await walletOf(userId)).cachedBalanceStroops).toBe(21_875_000n);
  });

  it('nurses get freeAnswersRemaining null', async () => {
    const app = appWith();
    const { token } = await signUp(app, 'nurses');
    const res = await request(app).get('/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.body.freeAnswersRemaining).toBeNull();
  });

  it('when Stellar does not answer, shows the last known balance with its timestamp', async () => {
    const app = appWith();
    const { userId, token } = await signUp(app);
    await waitActive(userId);
    await db.wallet.update({
      where: { userId },
      data: {
        cachedBalanceStroops: 3_125_000n,
        balanceSyncedAt: new Date('2026-11-19T08:00:00.000Z'),
      },
    });
    fake.state.failBalance = true;
    const res = await request(app).get('/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toEqual({ kobo: 50_000, usdc: '0.3125000' });
    expect(res.body.balanceSyncedAt).toBe('2026-11-19T08:00:00.000Z');
  });

  it('a pending wallet is shown as pending (address already usable for display)', async () => {
    const app = appWith(null);
    const { token } = await signUp(app);
    const res = await request(app).get('/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.body).toMatchObject({
      status: 'pending',
      balance: { kobo: 0, usdc: '0.0000000' },
      balanceSyncedAt: null,
    });
    expect(res.body.stellarAddress).toMatch(/^G/);
  });

  it('GET /wallet activates a pending wallet when Stellar is back', async () => {
    const app = appWith(null);
    const { userId, token } = await signUp(app); // no chain at sign-up: pending
    const later = appWith(); // chain available now
    const res = await request(later).get('/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.body.status).toBe('active');
    expect((await walletOf(userId)).activatedAt).not.toBeNull();
  });

  it('users created before Z4 (no wallet row) get one on first GET /wallet', async () => {
    const app = appWith(null);
    const { userId, token } = await signUp(app);
    await db.wallet.delete({ where: { userId } });
    const res = await request(app).get('/wallet').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.stellarAddress).toBe((await walletOf(userId)).stellarPublicKey);
  });

  it('requires sign-in', async () => {
    expect((await request(appWith()).get('/wallet')).status).toBe(401);
  });
});

describe('GET /wallet/transactions', () => {
  async function login(
    app: ReturnType<typeof buildTestApp>,
    email: string,
    appName: 'women' | 'nurses',
  ) {
    await request(app).post('/auth/code/request').send({ email, purpose: 'login', app: appName });
    const res = await request(app)
      .post('/auth/code/verify')
      .send({ email, code: mail.lastCode(email), purpose: 'login', app: appName });
    return res.body.accessToken as string;
  }

  beforeEach(async () => {
    const cfg = testConfig();
    await seed(db, {
      answerPriceKobo: cfg.answerPriceKobo,
      ngnPerUsdc: cfg.ngnPerUsdc,
      nodeEnv: 'test',
      walletEncryptionKey: cfg.wallet.encryptionKey,
    });
  });

  it('woman: confirmed top-ups only; free answers and unpaid top-ups are not listed', async () => {
    const app = appWith(null);
    const token = await login(app, SEED_EMAILS.tolu, 'women');
    const empty = await request(app)
      .get('/wallet/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(empty.body).toEqual({ items: [], nextCursor: null }); // her free answer cost her nothing

    const tolu = await db.user.findUniqueOrThrow({
      where: { email_role: { email: SEED_EMAILS.tolu, role: 'WOMAN' } },
    });
    const topup = (status: 'CONFIRMED' | 'PENDING', ref: string) =>
      db.topup.create({
        data: {
          womanId: tolu.id,
          paystackReference: ref,
          amountKobo: 350_000,
          amountStroops: koboToStroops(350_000, '1600'),
          status,
          stellarTxHash: status === 'CONFIRMED' ? 'e'.repeat(64) : null,
        },
      });
    await topup('CONFIRMED', 'cltop_test_confirmed');
    await topup('PENDING', 'cltop_test_pending');

    const res = await request(app)
      .get('/wallet/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      kind: 'topup',
      amount: { kobo: 350_000, usdc: '2.1875000' },
      stellarTxHash: 'e'.repeat(64),
      questionId: null,
    });
    expect(res.body.nextCursor).toBeNull();
  });

  it('nurse: earnings (+) and withdrawals (-), newest first, cursor-paged', async () => {
    const app = appWith(null);
    const amaka = await db.user.findUniqueOrThrow({
      where: { email_role: { email: SEED_EMAILS.amaka, role: 'NURSE' } },
    });
    await db.withdrawal.create({
      data: {
        nurseId: amaka.id,
        amountKobo: 20_000,
        amountStroops: 1_250_000n,
        destinationAddress: Keypair.random().publicKey(),
        status: 'CONFIRMED',
        stellarTxHash: 'f'.repeat(64),
        createdAt: new Date(clock().getTime() + MINUTE),
      },
    });
    const token = await login(app, SEED_EMAILS.amaka, 'nurses');

    const page1 = await request(app)
      .get('/wallet/transactions?limit=1')
      .set('Authorization', `Bearer ${token}`);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0]).toMatchObject({
      kind: 'withdrawal',
      amount: { kobo: -20_000, usdc: '-0.1250000' },
    });
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(`/wallet/transactions?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0]).toMatchObject({ kind: 'answer_earning', amount: { kobo: 40_000 } });
    expect(page2.body.items[0].questionId).toBeTruthy();
    expect(page2.body.nextCursor).toBeNull();
  });

  it('rejects a bad cursor or limit (400)', async () => {
    const app = appWith(null);
    const token = await login(app, SEED_EMAILS.tolu, 'women');
    expect(
      (
        await request(app)
          .get('/wallet/transactions?cursor=nope')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get('/wallet/transactions?limit=500')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(400);
  });
});
