// Development seed data. Wipes every CareLayer table, then inserts a known demo state.
// Refuses to run when NODE_ENV=production.
//
// Placeholders (clearly not real):
// - Emails use example.com.
// - Wallets are real keypairs (secret encrypted with WALLET_ENCRYPTION_KEY) but start "pending":
//   the seed never touches Stellar. When the API runs with STELLAR_TREASURY_SECRET, the background
//   loop activates them on testnet. Tolu's ₦3,500 is only a cached figure: once her wallet is active,
//   GET /wallet shows the real on-chain balance (0 until she tops up in Z5).
// - Stellar tx hashes are sha256("carelayer-seed:<label>"): valid-looking, but not on-chain.
// - Licence numbers start with "SEED-".
// Times are relative to the moment the seed runs, so open questions are live (inside their windows).
import { createHash } from 'node:crypto';
import { DEFAULT_TOPICS_BY_ROLE, QUESTION_CATEGORIES } from '@carelayer/shared';
import type {
  AgeRange,
  Language,
  NurseRole,
  PrismaClient,
  SharedField,
} from '../generated/prisma/client.js';
import { koboToStroops, splitPayout, splitPayoutKobo } from '../lib/money.js';
import { helpfulRating, recomputeNurseStats } from '../modules/nurses/stats.js';
import { newCustodialWallet } from '../modules/wallets/crypto.js';

export interface SeedOptions {
  answerPriceKobo: number;
  ngnPerUsdc: string;
  nodeEnv: string;
  /** WALLET_ENCRYPTION_KEY (32 bytes). */
  walletEncryptionKey: Buffer;
  now?: Date;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CONSENT_VERSION = 'consent-v1';
const ALL_SHARED: SharedField[] = [
  'CLEANED_TEXT',
  'ORIGINAL_TEXT',
  'ASSISTANT_NOTES',
  'CATEGORY',
  'AGE_RANGE',
  'PREGNANCY_WEEKS',
];

export const SEED_EMAILS = {
  tolu: 'tolu@example.com',
  amaka: 'amaka.okafor@example.com',
  funmilayo: 'funmilayo.bello@example.com',
  hauwa: 'hauwa.musa@example.com',
  chiamaka: 'chiamaka.eze@example.com',
  admin: 'admin@example.com',
} as const;

const TOPIC_LABELS: Record<(typeof QUESTION_CATEGORIES)[number], string> = {
  pregnancy: 'Pregnancy',
  periods: 'Periods',
  contraception: 'Contraception',
  sexual_health: 'Sexual health',
  general: 'General',
};

export const seedTxHash = (label: string) =>
  createHash('sha256').update(`carelayer-seed:${label}`).digest('hex');

/** Delete everything, children first. */
async function wipe(db: PrismaClient) {
  await db.$transaction([
    db.feedback.deleteMany(),
    db.payout.deleteMany(),
    db.payment.deleteMany(),
    db.answer.deleteMany(),
    db.claim.deleteMany(),
    db.consent.deleteMany(),
    db.question.deleteMany(),
    db.withdrawal.deleteMany(),
    db.topup.deleteMany(),
    db.nurseTopic.deleteMany(),
    db.nurseDocument.deleteMany(),
    db.nurseProfile.deleteMany(),
    db.topic.deleteMany(),
    db.wallet.deleteMany(),
    db.refreshToken.deleteMany(),
    db.session.deleteMany(),
    db.agentToken.deleteMany(),
    db.emailCode.deleteMany(),
    db.userSettings.deleteMany(),
    db.notificationPreference.deleteMany(),
    db.emergencyEvent.deleteMany(),
    db.user.deleteMany(),
  ]);
}

export async function seed(db: PrismaClient, opts: SeedOptions) {
  if (opts.nodeEnv === 'production') throw new Error('Refusing to seed: NODE_ENV=production');

  const now = opts.now ?? new Date();
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  const price = {
    priceKobo: opts.answerPriceKobo,
    priceStroops: koboToStroops(opts.answerPriceKobo, opts.ngnPerUsdc),
  };

  await wipe(db);

  // ---------- topics ----------
  await db.topic.createMany({
    data: QUESTION_CATEGORIES.map((slug, i) => ({
      slug,
      label: TOPIC_LABELS[slug],
      sortOrder: i + 1,
    })),
  });

  // ---------- users ----------
  async function createUser(input: {
    role: 'WOMAN' | 'NURSE' | 'ADMIN';
    email: string;
    displayName: string;
    freeAnswersUsed?: number;
    balanceKobo?: number;
    createdAt: Date;
  }) {
    return db.user.create({
      data: {
        role: input.role,
        email: input.email,
        displayName: input.displayName,
        freeAnswersUsed: input.freeAnswersUsed ?? 0,
        termsAcceptedAt: input.createdAt,
        termsVersion: 'terms-v1',
        createdAt: input.createdAt,
        settings: { create: {} },
        notificationPreference: { create: { notifyWhenAnswered: true } },
        wallet: {
          create: {
            ...newCustodialWallet(opts.walletEncryptionKey),
            cachedBalanceStroops: koboToStroops(input.balanceKobo ?? 0, opts.ngnPerUsdc),
            balanceSyncedAt: now,
          },
        },
      },
      include: { wallet: true },
    });
  }

  const admin = await createUser({
    role: 'ADMIN',
    email: SEED_EMAILS.admin,
    displayName: 'CareLayer Admin',
    createdAt: at(-60 * DAY),
  });
  const tolu = await createUser({
    role: 'WOMAN',
    email: SEED_EMAILS.tolu,
    displayName: 'Tolu',
    freeAnswersUsed: 1, // 2 of 3 free answers left
    balanceKobo: 350_000, // ₦3,500
    createdAt: at(-21 * DAY),
  });

  async function createNurse(input: {
    email: string;
    fullName: string;
    role: NurseRole;
    years: number;
    languages: Language[];
    bio: string;
    practiceArea: string;
    licence: string;
    approved: boolean;
    topics?: string[];
    createdAt: Date;
  }) {
    const user = await createUser({
      role: 'NURSE',
      email: input.email,
      displayName: input.fullName,
      createdAt: input.createdAt,
    });
    const submittedAt = new Date(input.createdAt.getTime() + DAY);
    const roleKey = input.role === 'MIDWIFE' ? 'midwife' : 'nurse';
    await db.nurseProfile.create({
      data: {
        userId: user.id,
        role: input.role,
        fullName: input.fullName,
        fullNameConfirmed: true,
        gender: 'FEMALE',
        practiceArea: input.practiceArea,
        yearsOfPractice: input.years,
        bio: input.bio,
        languages: input.languages,
        licenceNumber: input.licence,
        available: input.approved,
        guidanceAcceptedAt: input.createdAt,
        verificationStatus: input.approved ? 'APPROVED' : 'PENDING_REVIEW',
        submittedAt,
        reviewedAt: input.approved ? new Date(submittedAt.getTime() + DAY) : null,
        reviewedById: input.approved ? admin.id : null,
        documents: {
          create: (
            [
              'PRACTISING_LICENCE',
              'REGISTRATION_CERTIFICATE',
              'GOVERNMENT_ID',
              'SELFIE_WITH_ID',
            ] as const
          ).map((type) => ({
            type,
            storageKey: `seed/${user.id}/${type.toLowerCase()}.pdf`,
            fileName: `${type.toLowerCase()}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: 120_000,
            sha256: seedTxHash(`doc:${input.email}:${type}`),
            uploadedAt: input.createdAt,
          })),
        },
        topics: {
          create: (input.topics ?? DEFAULT_TOPICS_BY_ROLE[roleKey]).map((topicSlug) => ({
            topicSlug,
          })),
        },
      },
    });
    return user;
  }

  const amaka = await createNurse({
    email: SEED_EMAILS.amaka,
    fullName: 'Amaka Okafor',
    role: 'MIDWIFE',
    years: 9,
    languages: ['ENGLISH', 'IGBO'],
    practiceArea: 'Antenatal and postnatal care',
    bio: 'Midwife with 9 years in antenatal and postnatal care. I help women feel calm and informed through pregnancy, birth and the months after.',
    licence: 'SEED-RM-0001',
    approved: true,
    topics: ['pregnancy', 'periods', 'sexual_health'],
    createdAt: at(-120 * DAY),
  });
  const funmilayo = await createNurse({
    email: SEED_EMAILS.funmilayo,
    fullName: 'Funmilayo Bello',
    role: 'MIDWIFE',
    years: 6,
    languages: ['ENGLISH', 'YORUBA'],
    practiceArea: 'Family planning and reproductive health',
    bio: 'Midwife focused on family planning, periods and reproductive health. No question is too small or too embarrassing.',
    licence: 'SEED-RM-0002',
    approved: true,
    topics: ['pregnancy', 'periods', 'contraception'],
    createdAt: at(-100 * DAY),
  });
  const hauwa = await createNurse({
    email: SEED_EMAILS.hauwa,
    fullName: 'Hauwa Musa',
    role: 'MIDWIFE', // nurse-midwife
    years: 11,
    languages: ['ENGLISH', 'HAUSA'],
    practiceArea: 'Maternal and newborn health',
    bio: 'Nurse-midwife with 11 years in maternal and newborn health. I answer in English or Hausa.',
    licence: 'SEED-RM-0003',
    approved: true,
    createdAt: at(-90 * DAY),
  });
  const chiamaka = await createNurse({
    email: SEED_EMAILS.chiamaka,
    fullName: 'Chiamaka Eze',
    role: 'NURSE',
    years: 4,
    languages: ['ENGLISH', 'IGBO', 'PIDGIN'],
    practiceArea: 'General nursing',
    bio: 'Registered nurse in general practice.',
    licence: 'SEED-RN-0004',
    approved: false, // waits in the admin review queue
    createdAt: at(-2 * DAY),
  });

  // ---------- questions (one or more per status) ----------
  async function createQuestion(input: {
    originalText: string;
    cleanedText: string;
    assistantNotes?: string;
    topicSlug: string;
    ageRange?: AgeRange;
    pregnancyWeeks?: number;
    createdAt: Date;
    status: 'OPEN' | 'CLAIMED' | 'ANSWERED' | 'EXPIRED' | 'CANCELLED';
    chosenNurseId?: string;
    femaleOnly?: boolean;
    fellBackAt?: Date;
    answeredAt?: Date;
    expiredAt?: Date;
    cancelledAt?: Date;
    collectedAt?: Date;
  }) {
    const chosen = Boolean(input.chosenNurseId);
    return db.question.create({
      data: {
        womanId: tolu.id,
        source: 'WEB',
        status: input.status,
        originalText: input.originalText,
        cleanedText: input.cleanedText,
        assistantNotes: input.assistantNotes ?? null,
        topicSlug: input.topicSlug,
        ageRange: input.ageRange ?? null,
        pregnancyWeeks: input.pregnancyWeeks ?? null,
        femaleOnly: input.femaleOnly ?? false,
        selection: chosen ? 'CHOSEN_NURSE' : 'FIRST_AVAILABLE',
        chosenNurseId: input.chosenNurseId ?? null,
        chosenUntil: chosen ? new Date(input.createdAt.getTime() + 10 * MINUTE) : null,
        fellBackAt: input.fellBackAt ?? null,
        expiresAt: new Date(input.createdAt.getTime() + 30 * MINUTE),
        ...price,
        // She had free answers left when she asked each of these.
        isFree: true,
        createdAt: input.createdAt,
        answeredAt: input.answeredAt ?? null,
        expiredAt: input.expiredAt ?? null,
        cancelledAt: input.cancelledAt ?? null,
        collectedAt: input.collectedAt ?? null,
        consent: {
          create: {
            sharedFields: ALL_SHARED,
            consentVersion: CONSENT_VERSION,
            agreedAt: input.createdAt,
          },
        },
      },
    });
  }

  // 1. ANSWERED + collected. Her first free answer: she paid nothing, the treasury paid Amaka ₦400.
  const q1Created = at(-9 * DAY);
  const q1 = await createQuestion({
    originalText: 'is a 40 day cycle normal',
    cleanedText: 'Is a 40-day cycle normal?',
    topicSlug: 'periods',
    ageRange: 'AGE_25_34',
    createdAt: q1Created,
    status: 'ANSWERED',
    answeredAt: new Date(q1Created.getTime() + 14 * MINUTE),
    collectedAt: new Date(q1Created.getTime() + 20 * MINUTE),
  });
  const q1Claim = await db.claim.create({
    data: {
      questionId: q1.id,
      nurseId: amaka.id,
      status: 'ANSWERED',
      claimedAt: new Date(q1Created.getTime() + 4 * MINUTE),
      expiresAt: new Date(q1Created.getTime() + 14 * MINUTE),
      endedAt: new Date(q1Created.getTime() + 14 * MINUTE),
    },
  });
  const q1Answer = await db.answer.create({
    data: {
      questionId: q1.id,
      claimId: q1Claim.id,
      nurseId: amaka.id,
      text: 'A cycle between 21 and 35 days is considered normal, and it can change from month to month. A 40-day cycle now and then is common, especially with stress or weight changes. If your periods stay longer than 35 days for more than three months, or you have very heavy bleeding, please see a health worker for a check-up.',
      createdAt: new Date(q1Created.getTime() + 14 * MINUTE),
    },
  });
  const q1Payment = await db.payment.create({
    data: {
      questionId: q1.id,
      source: 'TREASURY_FREE',
      amountKobo: 0,
      amountStroops: 0n,
      platformFeeStroops: 0n,
      status: 'CONFIRMED',
      createdAt: new Date(q1Created.getTime() + 20 * MINUTE),
      settledAt: new Date(q1Created.getTime() + 20 * MINUTE),
    },
  });
  await db.payout.create({
    data: {
      paymentId: q1Payment.id,
      nurseId: amaka.id,
      amountKobo: splitPayoutKobo(price.priceKobo).nurse,
      amountStroops: splitPayout(price.priceStroops).nurse,
      fromTreasury: true,
      destinationAddress: amaka.wallet!.stellarPublicKey,
      status: 'CONFIRMED',
      stellarTxHash: seedTxHash('payout:q1'),
      createdAt: new Date(q1Created.getTime() + 20 * MINUTE),
      confirmedAt: new Date(q1Created.getTime() + 21 * MINUTE),
    },
  });
  await db.feedback.create({ data: { answerId: q1Answer.id, womanId: tolu.id, helpful: true } });

  // 2. ANSWERED, not collected yet (W11 demo). Chosen nurse Funmilayo claimed inside her window.
  const q2Created = at(-40 * MINUTE);
  const q2 = await createQuestion({
    originalText: 'spotting after starting the pill, is this normal?',
    cleanedText: 'Spotting after starting the pill. Is this normal?',
    assistantNotes: 'Started a combined pill about three weeks ago.',
    topicSlug: 'contraception',
    ageRange: 'AGE_18_24',
    createdAt: q2Created,
    status: 'ANSWERED',
    chosenNurseId: funmilayo.id,
    answeredAt: new Date(q2Created.getTime() + 12 * MINUTE),
  });
  const q2Claim = await db.claim.create({
    data: {
      questionId: q2.id,
      nurseId: funmilayo.id,
      status: 'ANSWERED',
      claimedAt: new Date(q2Created.getTime() + 3 * MINUTE),
      expiresAt: new Date(q2Created.getTime() + 13 * MINUTE),
      endedAt: new Date(q2Created.getTime() + 12 * MINUTE),
    },
  });
  await db.answer.create({
    data: {
      questionId: q2.id,
      claimId: q2Claim.id,
      nurseId: funmilayo.id,
      text: 'Light spotting is common in the first three months of starting the pill and usually settles on its own. Keep taking it at the same time every day. If spotting continues after three months, is heavy, or comes with pain, speak to a health worker about other options.',
      recommendSeeSomeoneToday: false,
      createdAt: new Date(q2Created.getTime() + 12 * MINUTE),
    },
  });

  // 3. CLAIMED: Hauwa holds an active 10-minute lock.
  const q3Created = at(-3 * MINUTE);
  const q3 = await createQuestion({
    originalText: 'my feet dey swell small small, im 30 weeks pregnant is it normal',
    cleanedText: 'My feet are swelling a little. I am 30 weeks pregnant. Is it normal?',
    assistantNotes: 'She did not mention headaches, blurred vision or bleeding.',
    topicSlug: 'pregnancy',
    ageRange: 'AGE_25_34',
    pregnancyWeeks: 30,
    createdAt: q3Created,
    status: 'CLAIMED',
  });
  await db.claim.create({
    data: {
      questionId: q3.id,
      nurseId: hauwa.id,
      status: 'ACTIVE',
      claimedAt: at(-1 * MINUTE),
      expiresAt: at(9 * MINUTE),
    },
  });

  // 4. OPEN, inside Amaka's chosen-nurse window (only she can see and claim it for now).
  await createQuestion({
    originalText: 'pain during sex after birth, my baby is 4 months',
    cleanedText: 'Pain during sex after birth. My baby is 4 months old.',
    topicSlug: 'sexual_health',
    ageRange: 'AGE_25_34',
    createdAt: at(-2 * MINUTE),
    status: 'OPEN',
    chosenNurseId: amaka.id,
  });

  // 5. OPEN, first available, "Only female health workers".
  await createQuestion({
    originalText: 'i missed my period for 2 months but the test is negative',
    cleanedText: 'I missed my period for 2 months, but the test is negative.',
    topicSlug: 'periods',
    ageRange: 'AGE_18_24',
    createdAt: at(-5 * MINUTE),
    status: 'OPEN',
    femaleOnly: true,
  });

  // 6. OPEN after fallback: Funmilayo was chosen but did not claim within 10 minutes.
  await createQuestion({
    originalText: 'which family planing is good when breastfeeding',
    cleanedText: 'Which family planning is good when breastfeeding?',
    topicSlug: 'contraception',
    ageRange: 'AGE_25_34',
    createdAt: at(-15 * MINUTE),
    status: 'OPEN',
    chosenNurseId: funmilayo.id,
    fellBackAt: at(-5 * MINUTE),
  });

  // 7. EXPIRED: Hauwa claimed at minute 25, the lock ran out at 35, nobody answered. She paid nothing.
  const q7Created = at(-2 * DAY);
  const q7 = await createQuestion({
    originalText: 'i have small white discharge every morning is it infection',
    cleanedText: 'I have a small white discharge every morning. Is it an infection?',
    topicSlug: 'sexual_health',
    createdAt: q7Created,
    status: 'EXPIRED',
    expiredAt: new Date(q7Created.getTime() + 35 * MINUTE),
  });
  await db.claim.create({
    data: {
      questionId: q7.id,
      nurseId: hauwa.id,
      status: 'EXPIRED',
      claimedAt: new Date(q7Created.getTime() + 25 * MINUTE),
      expiresAt: new Date(q7Created.getTime() + 35 * MINUTE),
      endedAt: new Date(q7Created.getTime() + 35 * MINUTE),
    },
  });

  // 8. CANCELLED before anyone claimed it.
  const q8Created = at(-5 * DAY);
  await createQuestion({
    originalText: 'how many days after my period can i get pregnant',
    cleanedText: 'How many days after my period can I get pregnant?',
    topicSlug: 'general',
    createdAt: q8Created,
    status: 'CANCELLED',
    cancelledAt: new Date(q8Created.getTime() + 6 * MINUTE),
  });

  // ---------- money and safety ----------
  await db.topup.create({
    data: {
      womanId: tolu.id,
      paystackReference: 'seed_topup_tolu_1',
      amountKobo: 350_000,
      amountStroops: koboToStroops(350_000, opts.ngnPerUsdc),
      status: 'CONFIRMED',
      stellarTxHash: seedTxHash('topup:tolu:1'),
      createdAt: at(-10 * DAY),
      creditedAt: at(-10 * DAY),
    },
  });
  await db.emergencyEvent.create({ data: { source: 'CHAT', createdAt: at(-1 * DAY) } });

  for (const nurse of [amaka, funmilayo, hauwa, chiamaka]) await recomputeNurseStats(db, nurse.id);

  return summarise(db);
}

/** Counts and key facts, printed by the CLI and asserted by tests. */
export async function summarise(db: PrismaClient) {
  const [users, questionsByStatus, nurses, tolu] = await Promise.all([
    db.user.groupBy({ by: ['role'], _count: true, orderBy: { role: 'asc' } }),
    db.question.groupBy({ by: ['status'], _count: true, orderBy: { status: 'asc' } }),
    db.nurseProfile.findMany({
      orderBy: { fullName: 'asc' },
      include: { topics: true },
    }),
    db.user.findUniqueOrThrow({
      where: { email_role: { email: SEED_EMAILS.tolu, role: 'WOMAN' } },
      include: { wallet: true },
    }),
  ]);
  const [claims, activeClaims, answers, payments, payouts, topups, emergencyEvents] =
    await Promise.all([
      db.claim.count(),
      db.claim.count({ where: { status: 'ACTIVE' } }),
      db.answer.count(),
      db.payment.count(),
      db.payout.count(),
      db.topup.count(),
      db.emergencyEvent.count(),
    ]);
  return {
    users: Object.fromEntries(users.map((u) => [u.role, u._count])),
    questionsByStatus: Object.fromEntries(questionsByStatus.map((q) => [q.status, q._count])),
    nurses: nurses.map((n) => ({
      name: n.fullName,
      role: n.role,
      status: n.verificationStatus,
      years: n.yearsOfPractice,
      languages: n.languages,
      topics: n.topics.map((t) => t.topicSlug).sort(),
      avgResponseMinutes:
        n.avgResponseSeconds === null ? null : Math.round(n.avgResponseSeconds / 60),
      helpful: helpfulRating(n.helpfulCount, n.feedbackCount),
    })),
    tolu: {
      freeAnswersLeft: 3 - tolu.freeAnswersUsed,
      cachedBalanceStroops: tolu.wallet!.cachedBalanceStroops.toString(),
    },
    counts: { claims, activeClaims, answers, payments, payouts, topups, emergencyEvents },
  };
}
