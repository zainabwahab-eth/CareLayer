// People for API tests: a signed-in woman (through the real auth flow) and nurses written straight
// to the database (onboarding is Z9).
import { randomUUID } from 'node:crypto';
import { QUESTION_CATEGORIES, type QuestionCategory } from '@carelayer/shared';
import type { Express } from 'express';
import request from 'supertest';
import type { Db } from '../../src/db.js';
import { newCustodialWallet } from '../../src/modules/wallets/crypto.js';
import type { memoryEmailSender } from './app.js';
import { testConfig } from './env.js';

const TOPIC_LABELS: Record<QuestionCategory, string> = {
  pregnancy: 'Pregnancy',
  periods: 'Periods',
  contraception: 'Contraception',
  sexual_health: 'Sexual health',
  general: 'General',
};

/** Topics exist in every real database (seed); tests make sure they do here too. */
export async function ensureTopics(db: Db) {
  for (const [i, slug] of QUESTION_CATEGORIES.entries()) {
    await db.topic.upsert({
      where: { slug },
      update: {},
      create: { slug, label: TOPIC_LABELS[slug], sortOrder: i + 1 },
    });
  }
}

export async function signUpWoman(
  app: Express,
  mail: ReturnType<typeof memoryEmailSender>,
  name = 'Tolu',
) {
  const email = `w-${randomUUID().slice(0, 8)}@example.com`;
  await request(app)
    .post('/auth/code/request')
    .send({ email, purpose: 'signup', app: 'women', name });
  const res = await request(app)
    .post('/auth/code/verify')
    .send({ email, code: mail.lastCode(email), purpose: 'signup', app: 'women', name });
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, userId: res.body.user.id as string, token: res.body.accessToken as string };
}

export async function createNurse(
  db: Db,
  opts: {
    name?: string;
    role?: 'NURSE' | 'MIDWIFE';
    gender?: 'FEMALE' | 'MALE' | null;
    status?: 'APPROVED' | 'PENDING_REVIEW' | 'DRAFT' | 'REJECTED';
    available?: boolean;
    topics?: QuestionCategory[];
    avgResponseSeconds?: number | null;
  } = {},
) {
  const email = `n-${randomUUID().slice(0, 8)}@example.com`;
  const user = await db.user.create({
    data: {
      role: 'NURSE',
      email,
      displayName: opts.name ?? 'Nurse Test',
      wallet: { create: newCustodialWallet(testConfig().wallet.encryptionKey) },
      nurseProfile: {
        create: {
          fullName: opts.name ?? 'Nurse Test',
          role: opts.role ?? 'MIDWIFE',
          gender: opts.gender === undefined ? 'FEMALE' : opts.gender,
          yearsOfPractice: 5,
          bio: 'Midwife in Lagos.',
          languages: ['ENGLISH', 'YORUBA'],
          licenceNumber: `RM-${randomUUID().slice(0, 10)}`,
          available: opts.available ?? true,
          verificationStatus: opts.status ?? 'APPROVED',
          avgResponseSeconds: opts.avgResponseSeconds ?? null,
          topics: {
            create: (opts.topics ?? ['pregnancy', 'periods']).map((topicSlug) => ({ topicSlug })),
          },
        },
      },
    },
  });
  return { userId: user.id, email };
}

/** Other test files and the seed leave nurses behind: take them out of the directory. */
export async function hideExistingNurses(db: Db) {
  await db.nurseProfile.updateMany({ data: { available: false } });
}
