// The global setup already migrated a fresh database; these tests prove the seed runs on it and
// that the schema keeps the privacy and money rules from CLAUDE.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { koboToStroops } from '../../src/lib/money.js';
import { SEED_EMAILS, seed, summarise } from '../../src/seed/seed.js';
import { testConfig, testDatabaseUrl } from '../helpers/env.js';

const db = createDb(testDatabaseUrl());
const cfg = testConfig();
const opts = {
  answerPriceKobo: cfg.answerPriceKobo,
  ngnPerUsdc: cfg.ngnPerUsdc,
  nodeEnv: 'test',
  walletEncryptionKey: cfg.wallet.encryptionKey,
};
let summary: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  summary = await seed(db, opts);
});
afterAll(() => db.$disconnect());

describe('seed on a freshly migrated database', () => {
  it('creates 1 woman, 4 nurses (3 approved, 1 pending) and 1 admin', () => {
    expect(summary.users).toEqual({ WOMAN: 1, NURSE: 4, ADMIN: 1 });
    expect(summary.nurses.map((n) => [n.name, n.status])).toEqual([
      ['Amaka Okafor', 'APPROVED'],
      ['Chiamaka Eze', 'PENDING_REVIEW'],
      ['Funmilayo Bello', 'APPROVED'],
      ['Hauwa Musa', 'APPROVED'],
    ]);
  });

  it('matches the agreed nurse profiles', () => {
    const byName = Object.fromEntries(summary.nurses.map((n) => [n.name, n]));
    expect(byName['Amaka Okafor']).toMatchObject({
      role: 'MIDWIFE',
      years: 9,
      languages: ['ENGLISH', 'IGBO'],
    });
    expect(byName['Funmilayo Bello']).toMatchObject({
      role: 'MIDWIFE',
      years: 6,
      languages: ['ENGLISH', 'YORUBA'],
    });
    expect(byName['Hauwa Musa']).toMatchObject({
      role: 'MIDWIFE',
      years: 11,
      languages: ['ENGLISH', 'HAUSA'],
    });
  });

  it('gives every approved nurse gender FEMALE, a bio within 280 chars, and at least one topic', async () => {
    const approved = await db.nurseProfile.findMany({
      where: { verificationStatus: 'APPROVED' },
      include: { topics: true },
    });
    expect(approved).toHaveLength(3);
    for (const n of approved) {
      expect(n.gender).toBe('FEMALE');
      expect(n.bio!.length).toBeLessThanOrEqual(280);
      expect(n.topics.length).toBeGreaterThan(0);
    }
  });

  it('Tolu: free answers follow the quote rule (1 used + 2 held by open questions = 0 left), ₦0, no fake top-ups', async () => {
    expect(summary.tolu.freeAnswersLeft).toBe(0);
    // Never more free promises than free answers: used + in-flight free quotes <= 3.
    const tolu = await db.user.findUniqueOrThrow({
      where: { email_role: { email: SEED_EMAILS.tolu, role: 'WOMAN' } },
    });
    const inFlightFree = await db.question.count({
      where: {
        womanId: tolu.id,
        isFree: true,
        collectedAt: null,
        status: { in: ['OPEN', 'CLAIMED', 'ANSWERED'] },
      },
    });
    expect(tolu.freeAnswersUsed + inFlightFree).toBe(3);
    expect(BigInt(summary.tolu.cachedBalanceStroops)).toBe(0n);
    // Money only appears through a real test top-up, so history always matches the chain.
    expect(summary.counts.topups).toBe(0);
    expect(await db.wallet.count({ where: { cachedBalanceStroops: { not: 0n } } })).toBe(0);
  });

  it('has questions in every status', () => {
    for (const s of ['OPEN', 'CLAIMED', 'ANSWERED', 'EXPIRED', 'CANCELLED']) {
      expect(summary.questionsByStatus[s]).toBeGreaterThan(0);
    }
  });

  it('covers the chosen-nurse window, the fallback and the female-only filter', async () => {
    const now = new Date();
    const open = await db.question.findMany({ where: { status: 'OPEN' } });
    const inWindow = open.find((q) => q.selection === 'CHOSEN_NURSE' && q.chosenUntil! > now);
    const fellBack = open.find(
      (q) => q.selection === 'CHOSEN_NURSE' && q.fellBackAt && q.chosenUntil! < now,
    );
    expect(inWindow?.chosenNurseId).toBeTruthy();
    expect(fellBack).toBeTruthy();
    expect(open.some((q) => q.femaleOnly)).toBe(true);
  });

  it('stores the original and cleaned question separately', async () => {
    const q = await db.question.findFirstOrThrow({ where: { pregnancyWeeks: 30 } });
    expect(q.originalText).toBe('my feet dey swell small small, im 30 weeks pregnant is it normal');
    expect(q.cleanedText).toBe(
      'My feet are swelling a little. I am 30 weeks pregnant. Is it normal?',
    );
  });

  it('records consent for every question', async () => {
    const [questions, consents] = await Promise.all([db.question.count(), db.consent.count()]);
    expect(consents).toBe(questions);
  });

  it('free answer: she paid 0, the treasury paid the nurse 80% (₦400) with a tx hash', async () => {
    const payment = await db.payment.findFirstOrThrow({ include: { payout: true } });
    expect(payment).toMatchObject({
      source: 'TREASURY_FREE',
      amountKobo: 0,
      amountStroops: 0n,
      stellarTxHash: null,
    });
    expect(payment.payout).toMatchObject({
      amountKobo: 40_000,
      fromTreasury: true,
      status: 'CONFIRMED',
    });
    expect(payment.payout!.amountStroops).toBe((koboToStroops(50_000, cfg.ngnPerUsdc) * 8n) / 10n);
    expect(payment.payout!.stellarTxHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('profile caches match the seeded answers and feedback', () => {
    const amaka = summary.nurses.find((n) => n.name === 'Amaka Okafor')!;
    expect(amaka.avgResponseMinutes).toBe(14);
    expect(amaka.helpful).toEqual({ percent: 100, count: 1 });
    const hauwa = summary.nurses.find((n) => n.name === 'Hauwa Musa')!;
    expect(hauwa.avgResponseMinutes).toBeNull();
    expect(hauwa.helpful).toEqual({ percent: null, count: 0 });
  });

  it('is repeatable: seeding twice gives the same state', async () => {
    const again = await seed(db, opts);
    expect(again).toEqual(summary);
    expect(await summarise(db)).toEqual(summary);
  });

  it('refuses to run in production', async () => {
    await expect(seed(db, { ...opts, nodeEnv: 'production' })).rejects.toThrow(/production/);
  });

  it('production seed: only when explicitly allowed AND no real account exists', async () => {
    // Fresh deployment (only seeded @example.com accounts): allowed once, on purpose.
    await expect(
      seed(db, { ...opts, nodeEnv: 'production', allowProduction: true }),
    ).resolves.toBeTruthy();
    // A real person signed up: never wipe.
    const real = await db.user.create({
      data: { role: 'WOMAN', email: 'someone@gmail.com', displayName: 'Real' },
    });
    await expect(
      seed(db, { ...opts, nodeEnv: 'production', allowProduction: true }),
    ).rejects.toThrow(/1 real account/);
    await db.user.delete({ where: { id: real.id } });
  });

  it('the admin email can be an inbox you own (deployments)', async () => {
    await seed(db, { ...opts, adminEmail: ' Ops@MyDomain.com ' });
    const admin = await db.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
    expect(admin.email).toBe('ops@mydomain.com');
    await seed(db, opts); // back to the standard demo state for the tests that follow
    expect(await db.user.count({ where: { email: SEED_EMAILS.tolu } })).toBe(1);
  });
});

describe('schema invariants', () => {
  type Col = { table_name: string; column_name: string; data_type: string };
  const columns = () =>
    db.$queryRaw<Col[]>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`;

  it('has no float or numeric columns anywhere (money is integer kobo / BigInt stroops)', async () => {
    const floats = (await columns()).filter((c) =>
      ['real', 'double precision', 'numeric'].includes(c.data_type),
    );
    expect(floats).toEqual([]);
  });

  it('stores every stroops amount as bigint and every kobo amount as integer', async () => {
    const cols = await columns();
    const stroops = cols.filter((c) => /stroops/i.test(c.column_name));
    const kobo = cols.filter((c) => /kobo/i.test(c.column_name));
    expect(stroops.length).toBeGreaterThan(5);
    expect(kobo.length).toBeGreaterThan(5);
    for (const c of stroops)
      expect([c.table_name, c.column_name, c.data_type]).toEqual([
        c.table_name,
        c.column_name,
        'bigint',
      ]);
    for (const c of kobo)
      expect([c.table_name, c.column_name, c.data_type]).toEqual([
        c.table_name,
        c.column_name,
        'integer',
      ]);
  });

  it('has a stellarTxHash on every payment, payout, top-up and withdrawal', async () => {
    const cols = await columns();
    for (const t of ['Payment', 'Payout', 'Topup', 'Withdrawal']) {
      expect(cols.some((c) => c.table_name === t && c.column_name === 'stellarTxHash')).toBe(true);
    }
  });

  it('never stores a location or phone number', async () => {
    const suspicious = (await columns()).filter(
      (c) =>
        /(location|latitude|longitude|lat$|lng$|geo|city|state|lga|phone|street|ip)/i.test(
          c.column_name,
        ) ||
        (/address/i.test(c.column_name) && !/stellar|payer|destination/i.test(c.column_name)),
    );
    expect(suspicious).toEqual([]);
  });

  it('logs emergencies as source + timestamp only (no user, no text, no red-flag id)', async () => {
    const cols = (await columns())
      .filter((c) => c.table_name === 'EmergencyEvent')
      .map((c) => c.column_name)
      .sort();
    expect(cols).toEqual(['createdAt', 'id', 'source']);
  });

  it('keeps saved chats apart from questions (nurses never reach a chat)', async () => {
    // Chats are saved to her account (2026-11-24), but nothing a nurse can read links to one.
    const cols = await columns();
    const chatLinks = cols.filter(
      (c) =>
        !['conversation', 'conversationmessage'].includes(c.table_name.toLowerCase()) &&
        /conversation|chat/i.test(c.column_name),
    );
    expect(chatLinks).toEqual([]);
  });
});
