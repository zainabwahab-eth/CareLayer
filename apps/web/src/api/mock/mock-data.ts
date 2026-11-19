/*
 * MOCK DATA. Sample records for building and reviewing the women's app
 * without apps/api. Not real people, not real advice, not real transactions.
 *
 * - Names and consultations mirror the Figma screens (Tolu, Funmilayo B., ...)
 *   so the UI can be compared against the design.
 * - Ids are prefixed `mock_`, emails use example.com, and Stellar addresses
 *   and transaction hashes start with "MOCK", so mock data is easy to spot.
 * - Timestamps are relative to page load so "3 min ago" stays meaningful.
 */
import {
  FREE_ANSWERS_PER_WOMAN,
  type ConsentInput,
  type Conversation,
  type NurseSelection,
  type NursePublicProfile,
  type PublicNurse,
  type QuestionCategory,
  type User,
  type UserSettings,
  type WalletTransaction,
} from '@carelayer/shared';
import { MOCK_ANSWER_PRICE_KOBO, mockMoney } from './mock-rules';

/** Any email accepts this sign-in code in the mock. */
export const MOCK_VERIFICATION_CODE = '123456';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** Pad a mock Stellar value to its real length (56-char addresses, 64-char tx hashes). */
export function mockStellar(kind: 'address' | 'tx', seed: string) {
  const length = kind === 'address' ? 56 : 64;
  const prefix = kind === 'address' ? 'GMOCK' : 'MOCK';
  return (prefix + seed.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .padEnd(length, '0')
    .slice(0, length);
}

export const MOCK_USER: User = {
  id: 'mock_user_tolu',
  role: 'woman',
  displayName: 'Tolu',
  email: 'tolu@example.com',
  createdAt: ago(21 * DAY),
};

export const MOCK_SETTINGS: UserSettings = {
  appearance: 'system',
  quickExitTarget: 'google',
  spendingLimitPerAnswerKobo: 100_000, // ₦1,000
  mcpSpendingLimitPerAnswerKobo: 50_000, // ₦500
  mcpAskBeforeEachPayment: true,
};

export const MOCK_NOTIFICATIONS_SEED = { notifyWhenAnswered: true };

/** Version of the W07 consent text the mock records for seeded questions. */
export const MOCK_CONSENT_VERSION = 'mock-consent-v1';
const SEED_CONSENT: ConsentInput = {
  sharedFields: ['cleaned_text', 'original_text', 'category'],
  consentVersion: MOCK_CONSENT_VERSION,
};

/**
 * Mock verified nurses and midwives, modelled on the apps/api seed (Z1).
 * `profile` is the GET /nurses directory view; `publicView` is the PublicNurse
 * shown on answers. Never contact details, email or licence number.
 * Chiamaka is approved but not available, so she answers past questions but is
 * left out of the directory (GET /nurses returns available nurses only).
 */
export interface MockNurse {
  profile: NursePublicProfile;
  /** Name shown on answers. Short form, as drawn in Figma ("Funmilayo B."). */
  displayName: string;
}

export const MOCK_NURSES: readonly MockNurse[] = [
  {
    displayName: 'Funmilayo B.',
    profile: {
      id: 'mock_nurse_funmilayo',
      fullName: 'Funmilayo Bello',
      role: 'midwife',
      gender: 'female',
      yearsOfPractice: 6,
      bio: 'Midwife focused on family planning, periods and reproductive health. No question is too small or too embarrassing.',
      languages: ['english', 'yoruba'],
      topics: ['pregnancy', 'periods', 'contraception'],
      available: true,
      verified: true,
      avgResponseMinutes: 9,
      helpful: { percent: 96, count: 212 },
    },
  },
  {
    displayName: 'Hauwa M.',
    profile: {
      id: 'mock_nurse_hauwa',
      fullName: 'Hauwa Musa',
      role: 'midwife',
      gender: 'female',
      yearsOfPractice: 11,
      bio: 'Nurse-midwife with 11 years in maternal and newborn health. I answer in English or Hausa.',
      languages: ['english', 'hausa'],
      topics: ['pregnancy', 'periods'],
      available: true,
      verified: true,
      avgResponseMinutes: 14,
      helpful: { percent: 94, count: 87 },
    },
  },
  {
    displayName: 'Amaka O.',
    profile: {
      id: 'mock_nurse_amaka',
      fullName: 'Amaka Okafor',
      role: 'midwife',
      gender: 'female',
      yearsOfPractice: 9,
      bio: 'Midwife with 9 years in antenatal and postnatal care. I help women feel calm and informed through pregnancy, birth and the months after.',
      languages: ['english', 'igbo'],
      topics: ['pregnancy', 'periods', 'sexual_health'],
      available: true,
      verified: true,
      avgResponseMinutes: 11,
      helpful: { percent: 98, count: 154 },
    },
  },
  {
    displayName: 'Chiamaka E.',
    profile: {
      id: 'mock_nurse_chiamaka',
      fullName: 'Chiamaka Eze',
      role: 'nurse',
      gender: 'female',
      yearsOfPractice: 4,
      bio: 'Registered nurse in general practice.',
      languages: ['english', 'igbo', 'pidgin'],
      topics: ['pregnancy', 'periods', 'contraception', 'sexual_health', 'general'],
      available: false,
      verified: true,
      avgResponseMinutes: null,
      helpful: { percent: null, count: 0 },
    },
  },
];

/** The PublicNurse shown on answers (contract §8.3). */
export function toPublicNurse(nurse: MockNurse): PublicNurse {
  return {
    id: nurse.profile.id,
    displayName: nurse.displayName,
    role: nurse.profile.role,
    verified: true,
  };
}

/** Mock nurse answers by category, used when a new mock question gets "answered". */
export const MOCK_NURSE_ANSWERS: Record<QuestionCategory, string> = {
  pregnancy:
    'Thank you for your question. What you describe is common at this stage, and usually not a sign of a problem. Rest with your feet raised, drink plenty of water, and go to your antenatal clinic if it gets worse, or if you notice headaches, blurred vision or bleeding.',
  periods:
    'A cycle between 21 and 35 days is considered normal, and it can change from month to month. If your periods stay irregular for more than three months, or you have very heavy bleeding, please see a health worker for a check-up.',
  contraception:
    'Light spotting is common in the first three months of starting the pill and usually settles on its own. Keep taking it at the same time every day. If spotting continues after three months or is heavy, speak to a health worker about other options.',
  sexual_health:
    'Thank you for asking. This is common and treatable. Please visit a clinic for a quick test so you get the right treatment, and avoid sex until you have been checked. You did the right thing by asking.',
  general:
    'Thank you for your question. Based on what you shared, this does not sound urgent, but please visit a clinic if it lasts more than a week or gets worse.',
};

export interface MockQuestionRecord {
  id: string;
  category: QuestionCategory;
  originalText: string;
  cleanedText: string;
  isFree: boolean;
  createdAt: string;
  consent: ConsentInput;
  nurseSelection: NurseSelection;
  /** Set when nurseSelection = "chosen_nurse". */
  chosenNurseId: string | null;
  femaleOnly: boolean;
  /**
   * Simulated lifecycle: ms after creation when a nurse claims / answers.
   * A claim after QUESTION_CLAIMS_CLOSE_MINUTES means nobody claimed it in time: expired.
   */
  claimAfterMs: number;
  answerAfterMs: number;
  /** Who claims and answers it. */
  nurse: MockNurse;
  answerText: string;
  recommendSeeSomeoneToday: boolean;
  /** Set once she has collected (paid for) the answer. */
  collected: boolean;
  stellarTxHash: string | null;
  feedback: { helpful: boolean; updatedAt: string } | null;
}

const nurse = (index: number) => MOCK_NURSES[index % MOCK_NURSES.length]!;
const seedDefaults = {
  consent: SEED_CONSENT,
  nurseSelection: 'first_available',
  chosenNurseId: null,
  femaleOnly: false,
  recommendSeeSomeoneToday: false,
  feedback: null,
} as const satisfies Partial<MockQuestionRecord>;

/** Seed questions: the three "Recent consultations" and the active one from Figma Home. */
export function seedQuestions(): MockQuestionRecord[] {
  return [
    {
      id: 'mock_q_active',
      category: 'pregnancy',
      originalText: 'my feet dey swell small small, im 30 weeks pregnant is it normal',
      cleanedText: 'My feet are swelling a little. I am 30 weeks pregnant. Is it normal?',
      isFree: true, // she still has free answers; one is used when she collects
      createdAt: ago(3 * MINUTE),
      ...seedDefaults,
      claimAfterMs: 1 * MINUTE,
      answerAfterMs: 6 * MINUTE,
      nurse: nurse(3),
      answerText: MOCK_NURSE_ANSWERS.pregnancy,
      collected: false,
      stellarTxHash: null,
    },
    {
      id: 'mock_q_spotting',
      category: 'contraception',
      originalText: 'spotting after starting the pill, is this normal?',
      cleanedText: 'Spotting after starting the pill. Is this normal?',
      isFree: false,
      createdAt: ago(2 * DAY),
      ...seedDefaults,
      nurseSelection: 'chosen_nurse',
      chosenNurseId: nurse(0).profile.id,
      claimAfterMs: 2 * MINUTE,
      answerAfterMs: 9 * MINUTE,
      nurse: nurse(0),
      answerText: MOCK_NURSE_ANSWERS.contraception,
      collected: true,
      stellarTxHash: mockStellar('tx', 'spotting'),
      feedback: { helpful: true, updatedAt: ago(2 * DAY - 20 * MINUTE) },
    },
    {
      id: 'mock_q_cycle',
      category: 'periods',
      originalText: 'is a 40 day cycle normal',
      cleanedText: 'Is a 40-day cycle normal?',
      isFree: false,
      createdAt: ago(9 * DAY),
      ...seedDefaults,
      claimAfterMs: 4 * MINUTE,
      answerAfterMs: 14 * MINUTE,
      nurse: nurse(1),
      answerText: MOCK_NURSE_ANSWERS.periods,
      collected: true,
      stellarTxHash: mockStellar('tx', 'cycle'),
    },
    {
      id: 'mock_q_pain',
      category: 'sexual_health',
      originalText: 'pain during sex after birth, my baby is 4 months',
      cleanedText: 'Pain during sex after birth. My baby is 4 months old.',
      isFree: true,
      createdAt: ago(16 * DAY),
      ...seedDefaults,
      femaleOnly: true,
      claimAfterMs: 1 * MINUTE,
      answerAfterMs: 6 * MINUTE,
      nurse: nurse(2),
      recommendSeeSomeoneToday: true,
      answerText:
        'This is very common after giving birth and it is not your fault. Healing can take several months, and breastfeeding can cause dryness. Go slowly and use a water-based lubricant. If the pain is sharp or does not improve, please see a health worker for a check.',
      collected: true,
      stellarTxHash: null,
    },
  ];
}

export function seedConversations(): Conversation[] {
  return [
    {
      id: 'mock_conv_swelling',
      createdAt: ago(8 * MINUTE),
      messages: [
        {
          id: 'mock_msg_1',
          role: 'user',
          text: 'my feet dey swell small small, im 30 weeks pregnant is it normal',
          createdAt: ago(8 * MINUTE),
        },
        {
          id: 'mock_msg_2',
          role: 'assistant',
          text: 'Mild swelling in the feet is common at this stage of pregnancy. Would you like a verified midwife to look at your question?',
          createdAt: ago(8 * MINUTE - 4000),
        },
      ],
    },
  ];
}

/**
 * Illustrative history, chosen so totals match the Figma sidebar rather than
 * replaying the free-answer rule exactly. Wallet history that adds up to the Figma sidebar: ₦4,500 top-up, two ₦500 answers
 * = ₦3,500. One free answer used = 2 of 3 left.
 */
export function seedTransactions(): WalletTransaction[] {
  return [
    {
      id: 'mock_tx_spotting',
      kind: 'answer_payment',
      amount: mockMoney(-MOCK_ANSWER_PRICE_KOBO),
      stellarTxHash: mockStellar('tx', 'spotting'),
      questionId: 'mock_q_spotting',
      createdAt: ago(2 * DAY - 9 * MINUTE),
    },
    {
      id: 'mock_tx_cycle',
      kind: 'answer_payment',
      amount: mockMoney(-MOCK_ANSWER_PRICE_KOBO),
      stellarTxHash: mockStellar('tx', 'cycle'),
      questionId: 'mock_q_cycle',
      createdAt: ago(9 * DAY - 14 * MINUTE),
    },
    {
      id: 'mock_tx_topup',
      kind: 'topup',
      amount: mockMoney(450_000),
      stellarTxHash: mockStellar('tx', 'topup'),
      questionId: null,
      createdAt: ago(20 * DAY),
    },
  ];
}

export const MOCK_WALLET_SEED = {
  stellarAddress: mockStellar('address', 'tolu'),
  balanceKobo: 350_000,
  freeAnswersRemaining: FREE_ANSWERS_PER_WOMAN - 1,
};
