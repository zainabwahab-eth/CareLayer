// The partial unique indexes on Claim are the database-level guarantee behind
// "one active claim per nurse" and "one active claim per question" (Z7 builds on them).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { SEED_EMAILS, seed } from '../../src/seed/seed.js';
import { testConfig, testDatabaseUrl } from '../helpers/env.js';

const db = createDb(testDatabaseUrl());
afterAll(() => db.$disconnect());

const cfg = testConfig();
const MIN = 60_000;

async function nurseId(email: string) {
  return (await db.user.findUniqueOrThrow({ where: { email_role: { email, role: 'NURSE' } } })).id;
}
const openQuestions = () =>
  db.question.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' } });

function claim(questionId: string, nurse: string, status: 'ACTIVE' | 'RELEASED' = 'ACTIVE') {
  return db.claim.create({
    data: { questionId, nurseId: nurse, status, expiresAt: new Date(Date.now() + 10 * MIN) },
  });
}

function isUniqueViolation(err: unknown, index: string) {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    JSON.stringify(err.meta ?? {}).includes(index)
  );
}

beforeEach(async () => {
  await seed(db, {
    answerPriceKobo: cfg.answerPriceKobo,
    ngnPerUsdc: cfg.ngnPerUsdc,
    nodeEnv: 'test',
    walletEncryptionKey: cfg.wallet.encryptionKey,
  });
});

describe('Claim partial unique indexes', () => {
  it('exist in Postgres as partial indexes on status = ACTIVE', async () => {
    const rows = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Claim' AND indexname LIKE 'Claim_one_active_%'`;
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'Claim_one_active_per_nurse',
      'Claim_one_active_per_question',
    ]);
    for (const r of rows)
      expect(r.indexdef).toMatch(/UNIQUE INDEX .* WHERE \(status = 'ACTIVE'::"ClaimStatus"\)/);
  });

  it('reject a second ACTIVE claim for the same nurse', async () => {
    const hauwa = await nurseId(SEED_EMAILS.hauwa); // already holds the seeded active claim
    const [q] = await openQuestions();
    const err = await claim(q!.id, hauwa).catch((e: unknown) => e);
    expect(isUniqueViolation(err, 'Claim_one_active_per_nurse')).toBe(true);
  });

  it('reject a second ACTIVE claim on the same question', async () => {
    const claimed = await db.question.findFirstOrThrow({ where: { status: 'CLAIMED' } });
    const amaka = await nurseId(SEED_EMAILS.amaka);
    const err = await claim(claimed.id, amaka).catch((e: unknown) => e);
    expect(isUniqueViolation(err, 'Claim_one_active_per_question')).toBe(true);
  });

  it('allow any number of non-active claims (history is kept)', async () => {
    const hauwa = await nurseId(SEED_EMAILS.hauwa);
    const qs = await openQuestions();
    await claim(qs[0]!.id, hauwa, 'RELEASED');
    await claim(qs[1]!.id, hauwa, 'RELEASED');
    expect(await db.claim.count({ where: { nurseId: hauwa } })).toBe(4); // 2 seeded + 2 released
  });

  it('allow a new ACTIVE claim once the previous one is released', async () => {
    const hauwa = await nurseId(SEED_EMAILS.hauwa);
    await db.claim.updateMany({
      where: { nurseId: hauwa, status: 'ACTIVE' },
      data: { status: 'RELEASED', endedAt: new Date() },
    });
    const [q] = await openQuestions();
    await expect(claim(q!.id, hauwa)).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('let exactly one of two simultaneous claims on a question win', async () => {
    const [q] = await openQuestions();
    const results = await Promise.allSettled([
      claim(q!.id, await nurseId(SEED_EMAILS.amaka)),
      claim(q!.id, await nurseId(SEED_EMAILS.funmilayo)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isUniqueViolation(rejected.reason, 'Claim_one_active_per_question')).toBe(true);
  });
});
