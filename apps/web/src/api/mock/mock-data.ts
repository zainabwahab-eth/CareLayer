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
  type Conversation,
  type PublicWorker,
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

/** Mock verified health workers (public view only: never contact details). */
export const MOCK_WORKERS: readonly PublicWorker[] = [
  { displayName: 'Funmilayo B.', role: 'midwife', verified: true },
  { displayName: 'Hauwa M.', role: 'midwife', verified: true },
  { displayName: 'Amaka O.', role: 'midwife', verified: true },
  { displayName: 'Chiamaka E.', role: 'nurse', verified: true },
];

/** Mock health worker answers by category, used when a new mock question gets "answered". */
export const MOCK_WORKER_ANSWERS: Record<QuestionCategory, string> = {
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
  conversationId: string | null;
  /** Simulated lifecycle: ms after creation when a worker claims / answers. */
  claimAfterMs: number;
  answerAfterMs: number;
  worker: PublicWorker;
  answerText: string;
  /** Set once she has collected (paid for) the answer. */
  collected: boolean;
  stellarTxHash: string | null;
}

const worker = (index: number) => MOCK_WORKERS[index % MOCK_WORKERS.length]!;

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
      conversationId: 'mock_conv_swelling',
      claimAfterMs: 1 * MINUTE,
      answerAfterMs: 6 * MINUTE,
      worker: worker(3),
      answerText: MOCK_WORKER_ANSWERS.pregnancy,
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
      conversationId: null,
      claimAfterMs: 2 * MINUTE,
      answerAfterMs: 9 * MINUTE,
      worker: worker(0),
      answerText: MOCK_WORKER_ANSWERS.contraception,
      collected: true,
      stellarTxHash: mockStellar('tx', 'spotting'),
    },
    {
      id: 'mock_q_cycle',
      category: 'periods',
      originalText: 'is a 40 day cycle normal',
      cleanedText: 'Is a 40-day cycle normal?',
      isFree: false,
      createdAt: ago(9 * DAY),
      conversationId: null,
      claimAfterMs: 4 * MINUTE,
      answerAfterMs: 14 * MINUTE,
      worker: worker(1),
      answerText: MOCK_WORKER_ANSWERS.periods,
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
      conversationId: null,
      claimAfterMs: 1 * MINUTE,
      answerAfterMs: 6 * MINUTE,
      worker: worker(2),
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
