import {
  CLAIM_LOCK_MINUTES,
  CHOSEN_NURSE_WINDOW_MINUTES,
  DEFAULT_ANSWER_PRICE_KOBO,
  MIN_WITHDRAWAL_KOBO,
  PAYOUT_SPLIT,
  QUESTION_CLAIMS_CLOSE_MINUTES,
  type AgeRange,
  type Answer,
  type ApiErrorCode,
  type EarningEntry,
  type EarningsDay,
  type EarningsResponse,
  type NurseDashboard,
  type NurseProfile,
  type NurseQuestionTab,
  type NurseQuestionView,
  type Page,
  type PageQuery,
  type QuestionCategory,
  type QuestionStatus,
  type SubmitAnswerBody,
  type WalletTransaction,
  type Withdrawal,
  type WithdrawalMemo,
} from '@carelayer/shared';
import { ApiError } from '@web/api/errors';
import { mockMoney } from '@web/api/mock/mock-rules';

/*
 * MOCK DATA / MOCK BEHAVIOUR for the nurse workspace (cases, earnings, withdrawals).
 * Sample questions are illustrative text for building the UI, not medical content.
 *
 * Follows apps/api's rules (src/modules/nurses/cases.ts, earnings.ts):
 *   - claims close 30 min after a question is asked; a claim locks it for 10 min;
 *   - one active claim per nurse (409 ACTIVE_CLAIM_EXISTS with details.questionId);
 *   - an expired lock returns the question to open (410 CLAIM_EXPIRED on answer);
 *   - female-only questions are hidden from nurses who are not female;
 *   - a chosen nurse's question is hers alone for 10 minutes;
 *   - withdrawals need a fresh code (403 STEP_UP_REQUIRED), ₦100 minimum,
 *     at most `available`, one at a time, Stellar G… addresses only.
 *
 * Mock only: the woman "opens" an answer 20 s after it is sent, which is when
 * the real API pays the nurse (pay on delivery). Waiting questions are topped
 * up so the Cases list is never empty while building.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CLAIMS_CLOSE_MS = QUESTION_CLAIMS_CLOSE_MINUTES * MINUTE;
const LOCK_MS = CLAIM_LOCK_MINUTES * MINUTE;
const CHOSEN_MS = CHOSEN_NURSE_WINDOW_MINUTES * MINUTE;
/** When the mock woman opens the answer (and the nurse is paid). */
export const MOCK_COLLECT_AFTER_MS = 20_000;
/** A mock withdrawal stays "submitted" this long, then confirms. */
const MOCK_WITHDRAWAL_SETTLE_MS = 15_000;
/** The nurse's share of the default answer price (₦400). */
export const NURSE_SHARE_KOBO = (DEFAULT_ANSWER_PRICE_KOBO * PAYOUT_SPLIT.nurseBps) / 10_000;
/** Lagos is UTC+1 all year. */
const LAGOS_OFFSET_MS = 60 * MINUTE;

export interface MockCase {
  id: string;
  category: QuestionCategory;
  cleanedText: string;
  originalText: string | null;
  assistantNotes: string | null;
  ageRange: AgeRange | null;
  pregnancyWeeks: number | null;
  femaleOnly: boolean;
  /** The nurse she chose (user id), if any. */
  chosenNurseId: string | null;
  createdAt: number;
  claimedBy: string | null;
  claimExpiresAt: number | null;
  answeredBy: string | null;
  answeredAt: number | null;
}

export interface MockWithdrawal {
  id: string;
  nurseId: string;
  amountKobo: number;
  destinationAddress: string;
  destinationMemo: WithdrawalMemo | null;
  createdAt: number;
  /** Mock: a withdrawal to an address ending in "FAIL" fails, to build that state. */
  fails: boolean;
}

export interface MockEarning {
  id: string;
  nurseId: string;
  questionId: string;
  category: QuestionCategory;
  title: string;
  earnedAt: number;
}

export interface WorkspaceState {
  cases: MockCase[];
  earnings: MockEarning[];
  withdrawals: MockWithdrawal[];
  /** Per nurse: when her last step-up code stops counting (ms). */
  freshUntil: Record<string, number>;
  nextId: number;
}

const fail = (
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never => {
  throw new ApiError(status, code, message, details);
};

const iso = (ms: number) => new Date(ms).toISOString();

const SAMPLE_QUESTIONS: ReadonlyArray<
  Pick<
    MockCase,
    'category' | 'cleanedText' | 'assistantNotes' | 'ageRange' | 'pregnancyWeeks' | 'femaleOnly'
  >
> = [
  {
    category: 'contraception',
    cleanedText: 'I missed two of my pills this week. What should I do now?',
    assistantNotes: 'Combined pill. Missed on two days in a row, mid-pack. Had sex since.',
    ageRange: 'age_18_24',
    pregnancyWeeks: null,
    femaleOnly: false,
  },
  {
    category: 'periods',
    cleanedText: 'My cycle has been over 40 days for the last three months. Is this normal?',
    assistantNotes: null,
    ageRange: 'age_25_34',
    pregnancyWeeks: null,
    femaleOnly: true,
  },
  {
    category: 'pregnancy',
    cleanedText: 'Is it safe to sleep on my back at 30 weeks?',
    assistantNotes: 'First pregnancy. No other symptoms mentioned.',
    ageRange: 'age_25_34',
    pregnancyWeeks: 30,
    femaleOnly: false,
  },
  {
    category: 'sexual_health',
    cleanedText:
      'I have had itching and a white discharge for four days. It does not smell. What could it be and what can I do?',
    assistantNotes: 'No fever or pain reported.',
    ageRange: null,
    pregnancyWeeks: null,
    femaleOnly: false,
  },
  {
    category: 'general',
    cleanedText: 'I feel tired all the time and my hair is falling out. Should I get tested?',
    assistantNotes: null,
    ageRange: 'age_35_44',
    pregnancyWeeks: null,
    femaleOnly: false,
  },
];

const ANSWERED_TITLES: ReadonlyArray<[QuestionCategory, string]> = [
  ['pregnancy', 'I’m 24 weeks pregnant and my feet have been swollen for two days'],
  ['contraception', 'I missed two pills this week'],
  ['periods', 'My period came twice this month'],
  ['pregnancy', 'Can I drink coffee in the first trimester?'],
  ['general', 'Is it normal to feel dizzy after standing up?'],
];

/** Start of a question's text, as the API's EarningEntry.title. */
function titleOf(text: string): string {
  return text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
}

export function seedWorkspace(now: number, approvedNurseId: string): WorkspaceState {
  const state: WorkspaceState = {
    cases: [],
    earnings: [],
    withdrawals: [],
    freshUntil: {},
    nextId: 1,
  };
  // About two weeks of answers for the approved nurse (Amaka), some today.
  const offsets = [
    0.08, 0.15, 0.3, 1.1, 1.3, 2.2, 3.1, 3.4, 4.2, 5.5, 6.1, 7.3, 8.2, 9.4, 10.1, 11.6, 12.2, 13.5,
  ];
  offsets.forEach((daysAgo, i) => {
    const [category, title] = ANSWERED_TITLES[i % ANSWERED_TITLES.length]!;
    const answeredAt = now - daysAgo * DAY;
    const questionId = `mock_case_done_${i + 1}`;
    state.cases.push({
      id: questionId,
      category,
      cleanedText: `${title}.`,
      originalText: null,
      assistantNotes: null,
      ageRange: 'age_25_34',
      pregnancyWeeks: category === 'pregnancy' ? 24 : null,
      femaleOnly: false,
      chosenNurseId: null,
      createdAt: answeredAt - 7 * MINUTE,
      claimedBy: approvedNurseId,
      claimExpiresAt: null,
      answeredBy: approvedNurseId,
      answeredAt,
    });
    state.earnings.push({
      id: `mock_earning_${i + 1}`,
      nurseId: approvedNurseId,
      questionId,
      category,
      title: titleOf(title),
      // Seeded answers were already opened (and paid).
      earnedAt: answeredAt + MINUTE,
    });
  });
  state.withdrawals.push({
    id: 'mock_withdrawal_1',
    nurseId: approvedNurseId,
    amountKobo: 200_000,
    destinationAddress: 'GMOCKEXCHANGEWALLETADDRESSFORTHENURSEAPP000000000000000',
    destinationMemo: { type: 'id', value: '1234567' },
    createdAt: now - 6 * DAY,
    fails: false,
  });
  return state;
}

/** Work out a case's status at `now` (claims expire, questions close): as the API's sweeper. */
function settle(c: MockCase, now: number): QuestionStatus {
  if (c.answeredAt !== null) return 'answered';
  if (c.claimedBy && c.claimExpiresAt !== null && c.claimExpiresAt <= now) {
    c.claimedBy = null;
    c.claimExpiresAt = null;
  }
  if (c.claimedBy) return 'claimed';
  return now >= c.createdAt + CLAIMS_CLOSE_MS ? 'expired' : 'open';
}

export function createWorkspace(getState: () => WorkspaceState, now: () => number = Date.now) {
  const nextId = (prefix: string) => `mock_${prefix}_${getState().nextId++}`;

  /** Can she see (and claim) this open question? Contract §9 "Visibility". */
  const visibleTo = (c: MockCase, p: NurseProfile, t: number) =>
    (!c.femaleOnly || p.gender === 'female') &&
    (c.chosenNurseId === null || c.chosenNurseId === p.userId || t >= c.createdAt + CHOSEN_MS);

  const toView = (c: MockCase, p: NurseProfile, t: number): NurseQuestionView => {
    const status = settle(c, t);
    return {
      id: c.id,
      status,
      category: c.category,
      cleanedText: c.cleanedText,
      originalText: c.originalText,
      assistantNotes: c.assistantNotes,
      ageRange: c.ageRange,
      pregnancyWeeks: c.pregnancyWeeks,
      femaleOnly: c.femaleOnly,
      chosenForYou: c.chosenNurseId === p.userId && t < c.createdAt + CHOSEN_MS,
      claimsCloseAt: iso(c.createdAt + CLAIMS_CLOSE_MS),
      createdAt: iso(c.createdAt),
      claimExpiresAt:
        status === 'claimed' && c.claimedBy === p.userId ? iso(c.claimExpiresAt!) : null,
    };
  };

  /** Keep a few recent questions waiting, so the mock never runs dry. */
  const topUp = (p: NurseProfile, t: number) => {
    const s = getState();
    const waiting = s.cases.filter((c) => settle(c, t) === 'open' && visibleTo(c, p, t));
    for (let i = waiting.length; i < 3; i++) {
      const sample = SAMPLE_QUESTIONS[s.nextId % SAMPLE_QUESTIONS.length]!;
      // The first top-up is reserved for her (inside the 10-minute window), to show "Chosen for you".
      const chosen = !s.cases.some((c) => c.chosenNurseId);
      s.cases.push({
        ...sample,
        id: nextId('case'),
        originalText: null,
        // Female-only samples only for nurses who would see them.
        femaleOnly: sample.femaleOnly && p.gender === 'female',
        chosenNurseId: chosen ? p.userId : null,
        createdAt: t - (chosen ? 2 : 4 + ((s.nextId * 5) % 12)) * MINUTE,
        claimedBy: null,
        claimExpiresAt: null,
        answeredBy: null,
        answeredAt: null,
      });
    }
  };

  const requireApproved = (p: NurseProfile) => {
    if (p.verificationStatus !== 'approved') {
      fail(
        403,
        'NURSE_NOT_APPROVED',
        'Your profile must be approved before you can see questions.',
      );
    }
  };

  const activeClaimOf = (p: NurseProfile, t: number) =>
    getState().cases.find((c) => settle(c, t) === 'claimed' && c.claimedBy === p.userId) ?? null;

  const find = (id: string) => getState().cases.find((c) => c.id === id);

  // ---- money ----

  const earningsOf = (nurseId: string) =>
    getState()
      .earnings.filter((e) => e.nurseId === nurseId)
      .sort((a, b) => b.earnedAt - a.earnedAt);

  const earningStatus = (e: MockEarning, t: number): EarningEntry['status'] =>
    t >= e.earnedAt ? 'confirmed' : 'pending';

  const withdrawalStatus = (w: MockWithdrawal, t: number): Withdrawal['status'] => {
    if (t < w.createdAt + MOCK_WITHDRAWAL_SETTLE_MS) return 'submitted';
    return w.fails ? 'failed' : 'confirmed';
  };

  const toWithdrawal = (w: MockWithdrawal, t: number): Withdrawal => {
    const status = withdrawalStatus(w, t);
    return {
      id: w.id,
      status,
      amount: mockMoney(w.amountKobo),
      destinationAddress: w.destinationAddress,
      destinationMemo: w.destinationMemo,
      stellarTxHash: status === 'confirmed' ? `MOCKTX${w.id.toUpperCase()}` : null,
      failureReason: status === 'failed' ? 'The destination refused the payment (mock).' : null,
      createdAt: iso(w.createdAt),
      confirmedAt: status === 'confirmed' ? iso(w.createdAt + MOCK_WITHDRAWAL_SETTLE_MS) : null,
    };
  };

  const withdrawalsOf = (nurseId: string) =>
    getState()
      .withdrawals.filter((w) => w.nurseId === nurseId)
      .sort((a, b) => b.createdAt - a.createdAt);

  /** Balance in her CareLayer wallet, and what is still leaving it. */
  const balances = (p: NurseProfile, t: number) => {
    // With her own payout wallet, payouts land there, not in her CareLayer wallet.
    const earned = earningsOf(p.userId)
      .filter((e) => earningStatus(e, t) === 'confirmed')
      .reduce((sum) => sum + NURSE_SHARE_KOBO, 0);
    let out = 0;
    let inFlight = 0;
    for (const w of withdrawalsOf(p.userId)) {
      const status = withdrawalStatus(w, t);
      if (status === 'confirmed') out += w.amountKobo;
      if (status === 'submitted') inFlight += w.amountKobo;
    }
    const balance = earned - out;
    return { balance, available: Math.max(0, balance - inFlight) };
  };

  const lagosDay = (ms: number) => new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);

  const paginate = <T>(items: T[], query: PageQuery = {}): Page<T> => {
    const limit = query.limit ?? 20;
    const start = query.cursor ? Number(query.cursor) : 0;
    if (!Number.isInteger(start) || start < 0) {
      fail(400, 'VALIDATION_FAILED', 'Invalid cursor.', { field: 'cursor' });
    }
    const end = start + limit;
    return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
  };

  return {
    dashboard(p: NurseProfile): NurseDashboard {
      const t = now();
      if (p.verificationStatus === 'approved') topUp(p, t);
      const approved = p.verificationStatus === 'approved';
      const waiting = approved
        ? getState().cases.filter((c) => settle(c, t) === 'open' && visibleTo(c, p, t))
        : [];
      const mine = getState().cases.filter((c) => c.answeredBy === p.userId);
      const today = lagosDay(t);
      const weekStart = t - ((new Date(t + LAGOS_OFFSET_MS).getUTCDay() + 6) % 7) * DAY;
      const active = activeClaimOf(p, t);
      return {
        verificationStatus: p.verificationStatus,
        available: p.available,
        topics: p.topics,
        activeClaim: active ? toView(active, p, t) : null,
        waitingCount: waiting.length,
        chosenForYouCount: waiting.filter((c) => toView(c, p, t).chosenForYou).length,
        answeredToday: mine.filter((c) => lagosDay(c.answeredAt!) === today).length,
        answeredThisWeek: mine.filter((c) => lagosDay(c.answeredAt!) >= lagosDay(weekStart)).length,
        avgResponseMinutes: p.avgResponseMinutes ?? (mine.length ? 7 : null),
        helpful: p.helpful.count ? p.helpful : mine.length ? { percent: 96, count: 24 } : p.helpful,
      };
    },

    list(p: NurseProfile, tab: NurseQuestionTab, query: PageQuery = {}) {
      requireApproved(p);
      const t = now();
      if (tab === 'waiting') {
        topUp(p, t);
        const views = getState()
          .cases.filter((c) => settle(c, t) === 'open' && visibleTo(c, p, t))
          .map((c) => toView(c, p, t))
          // Chosen-for-you first, then oldest first.
          .sort(
            (a, b) =>
              Number(b.chosenForYou) - Number(a.chosenForYou) ||
              a.createdAt.localeCompare(b.createdAt),
          );
        return { items: views.slice(0, query.limit ?? 20), nextCursor: null };
      }
      if (tab === 'active') {
        const active = activeClaimOf(p, t);
        return { items: active ? [toView(active, p, t)] : [], nextCursor: null };
      }
      const done = getState()
        .cases.filter((c) => c.answeredBy === p.userId)
        .sort((a, b) => b.answeredAt! - a.answeredAt!)
        .map((c) => toView(c, p, t));
      return paginate(done, query);
    },

    get(p: NurseProfile, id: string): NurseQuestionView {
      requireApproved(p);
      const t = now();
      const c = find(id);
      const mineToo = c && (c.claimedBy === p.userId || c.answeredBy === p.userId);
      if (!c || (!mineToo && !visibleTo(c, p, t))) {
        return fail(404, 'NOT_FOUND', 'Question not found.');
      }
      return toView(c, p, t);
    },

    current(p: NurseProfile) {
      requireApproved(p);
      const t = now();
      const active = activeClaimOf(p, t);
      return active ? toView(active, p, t) : null;
    },

    claim(p: NurseProfile, id: string) {
      requireApproved(p);
      const t = now();
      const c = find(id);
      if (!c || !visibleTo(c, p, t)) return fail(404, 'NOT_FOUND', 'Question not found.');
      const status = settle(c, t);
      if (status === 'expired') fail(410, 'QUESTION_EXPIRED', 'This question has expired.');
      if (status === 'claimed' || status === 'answered') {
        fail(409, 'QUESTION_ALREADY_CLAIMED', 'Another nurse took this question.');
      }
      const mine = activeClaimOf(p, t);
      if (mine) {
        fail(409, 'ACTIVE_CLAIM_EXISTS', 'Finish or release your current question first.', {
          questionId: mine.id,
        });
      }
      c.claimedBy = p.userId;
      c.claimExpiresAt = t + LOCK_MS;
      return { questionId: c.id, expiresAt: iso(c.claimExpiresAt) };
    },

    release(p: NurseProfile, id: string) {
      requireApproved(p);
      const t = now();
      const c = find(id);
      const wasMine = c?.claimedBy === p.userId;
      if (!c || !wasMine) return fail(403, 'NOT_CLAIM_OWNER', 'You do not hold this question.');
      if (settle(c, t) !== 'claimed') {
        fail(410, 'CLAIM_EXPIRED', 'Your 10 minutes on this question ran out.');
      }
      c.claimedBy = null;
      c.claimExpiresAt = null;
      // A chosen-nurse question opens to everyone once she lets it go.
      c.chosenNurseId = null;
    },

    answer(p: NurseProfile, id: string, body: SubmitAnswerBody): Answer {
      requireApproved(p);
      const t = now();
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text) fail(400, 'VALIDATION_FAILED', 'Write your answer.', { field: 'text' });
      if (text.length > 5000) {
        fail(400, 'VALIDATION_FAILED', 'Answers can be up to 5000 characters.', { field: 'text' });
      }
      const c = find(id);
      if (!c || (c.claimedBy !== p.userId && c.answeredBy !== p.userId)) {
        return fail(403, 'NOT_CLAIM_OWNER', 'You do not hold this question.');
      }
      if (c.answeredBy) fail(403, 'NOT_CLAIM_OWNER', 'You do not hold this question.');
      if (settle(c, t) !== 'claimed') {
        fail(410, 'CLAIM_EXPIRED', 'Your 10 minutes on this question ran out.');
      }
      c.answeredBy = p.userId;
      c.answeredAt = t;
      c.claimExpiresAt = null;
      getState().earnings.push({
        id: nextId('earning'),
        nurseId: p.userId,
        questionId: c.id,
        category: c.category,
        title: titleOf(c.cleanedText),
        earnedAt: t + MOCK_COLLECT_AFTER_MS,
      });
      return {
        questionId: c.id,
        text,
        nurse: {
          id: p.userId,
          displayName: p.fullName,
          role: p.role ?? 'nurse',
          verified: true,
        },
        recommendSeeSomeoneToday: body.recommendSeeSomeoneToday ?? false,
        answeredAt: iso(t),
      };
    },

    earnings(p: NurseProfile): EarningsResponse {
      const t = now();
      const { balance, available } = balances(p, t);
      const confirmed = earningsOf(p.userId).filter((e) => earningStatus(e, t) === 'confirmed');
      const today = lagosDay(t);
      const dayIndex = (new Date(t + LAGOS_OFFSET_MS).getUTCDay() + 6) % 7; // Monday = 0
      const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
      const days: EarningsDay[] = weekdays.map((weekday, i) => {
        const date = lagosDay(t + (i - dayIndex) * DAY);
        const onDay = confirmed.filter((e) => lagosDay(e.earnedAt) === date);
        return {
          date,
          weekday,
          total: mockMoney(onDay.length * NURSE_SHARE_KOBO),
          answersCount: onDay.length,
          isToday: date === today,
        };
      });
      const weekFrom = days[0]!.date;
      const monthFrom = `${today.slice(0, 7)}-01`;
      const inWeek = confirmed.filter((e) => lagosDay(e.earnedAt) >= weekFrom);
      const inMonth = confirmed.filter((e) => lagosDay(e.earnedAt) >= monthFrom);
      const recent = [
        ...earningsOf(p.userId).map((e) => ({
          at: Math.min(e.earnedAt, t),
          entry: {
            kind: 'earning' as const,
            id: e.id,
            questionId: e.questionId,
            category: e.category,
            title: e.title,
            amount: mockMoney(NURSE_SHARE_KOBO),
            paidFromTreasury: false,
            status: earningStatus(e, t),
            stellarTxHash:
              earningStatus(e, t) === 'confirmed' ? `MOCKTX${e.id.toUpperCase()}` : null,
            earnedAt: iso(Math.min(e.earnedAt, t)),
          },
        })),
        ...withdrawalsOf(p.userId)
          .filter((w) => withdrawalStatus(w, t) !== 'failed')
          .map((w) => {
            const view = toWithdrawal(w, t);
            return {
              at: w.createdAt,
              entry: {
                kind: 'withdrawal' as const,
                id: w.id,
                amount: mockMoney(-w.amountKobo),
                destinationAddress: w.destinationAddress,
                destinationMemo: w.destinationMemo,
                status: view.status,
                stellarTxHash: view.stellarTxHash,
                createdAt: view.createdAt,
              },
            };
          }),
      ]
        .sort((a, b) => b.at - a.at)
        .slice(0, 10)
        .map((r) => r.entry);
      return {
        available: mockMoney(available),
        balance: mockMoney(balance),
        balanceSyncedAt: iso(t),
        stellarAddress: p.custodialStellarAddress,
        payoutAddress: p.ownStellarAddress,
        totalEarned: mockMoney(confirmed.length * NURSE_SHARE_KOBO),
        answersCount: confirmed.length,
        thisWeek: {
          from: weekFrom,
          total: mockMoney(inWeek.length * NURSE_SHARE_KOBO),
          answersCount: inWeek.length,
          days,
        },
        thisMonth: {
          from: monthFrom,
          total: mockMoney(inMonth.length * NURSE_SHARE_KOBO),
          answersCount: inMonth.length,
        },
        recent,
      };
    },

    listWithdrawals(p: NurseProfile, query?: PageQuery) {
      const t = now();
      return paginate(
        withdrawalsOf(p.userId).map((w) => toWithdrawal(w, t)),
        query,
      );
    },

    listTransactions(p: NurseProfile, query?: PageQuery): Page<WalletTransaction> {
      const t = now();
      const rows: WalletTransaction[] = [
        ...earningsOf(p.userId)
          .filter((e) => earningStatus(e, t) === 'confirmed')
          .map((e) => ({
            id: `tx_${e.id}`,
            kind: 'answer_earning' as const,
            amount: mockMoney(NURSE_SHARE_KOBO),
            stellarTxHash: `MOCKTX${e.id.toUpperCase()}`,
            questionId: e.questionId,
            createdAt: iso(e.earnedAt),
          })),
        ...withdrawalsOf(p.userId)
          .filter((w) => withdrawalStatus(w, t) === 'confirmed')
          .map((w) => ({
            id: `tx_${w.id}`,
            kind: 'withdrawal' as const,
            amount: mockMoney(-w.amountKobo),
            stellarTxHash: `MOCKTX${w.id.toUpperCase()}`,
            questionId: null,
            createdAt: iso(w.createdAt),
          })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return paginate(rows, query);
    },

    // ---- step-up ----

    markFresh(nurseId: string) {
      const until = now() + 5 * MINUTE;
      getState().freshUntil[nurseId] = until;
      return { freshUntil: iso(until) };
    },

    requireFresh(nurseId: string) {
      if ((getState().freshUntil[nurseId] ?? 0) <= now()) {
        fail(403, 'STEP_UP_REQUIRED', 'Confirm it is you with a new code first.');
      }
    },

    withdraw(
      p: NurseProfile,
      body: {
        amountKobo: number;
        destination: { kind: string; address: string; memo?: WithdrawalMemo };
      },
    ): Withdrawal {
      this.requireFresh(p.userId);
      const t = now();
      if (body?.destination?.kind !== 'stellar') {
        fail(400, 'VALIDATION_FAILED', 'Only Stellar withdrawals are available for now.');
      }
      const address = body.destination.address.trim();
      if (!/^G[A-Z2-7]{55}$/.test(address)) {
        fail(400, 'STELLAR_ADDRESS_INVALID', 'That is not a valid Stellar address (G…).', {
          field: 'destination.address',
        });
      }
      if (address === p.custodialStellarAddress) {
        fail(
          400,
          'STELLAR_ADDRESS_INVALID',
          'That is your CareLayer wallet. Enter the wallet you want to send to.',
          {
            field: 'destination.address',
          },
        );
      }
      const memo = body.destination.memo;
      if (memo) {
        const bad =
          memo.type === 'id'
            ? !/^\d{1,20}$/.test(memo.value)
            : new TextEncoder().encode(memo.value).length > 28 || !memo.value;
        if (bad) {
          fail(400, 'VALIDATION_FAILED', 'That memo is not one Stellar accepts.', {
            field: 'destination.memo',
          });
        }
      }
      if (!Number.isInteger(body.amountKobo) || body.amountKobo < MIN_WITHDRAWAL_KOBO) {
        fail(400, 'VALIDATION_FAILED', 'The smallest withdrawal is ₦100.', { field: 'amountKobo' });
      }
      const { available } = balances(p, t);
      if (body.amountKobo > available) {
        fail(409, 'INSUFFICIENT_BALANCE', 'You cannot withdraw more than you have.', {
          available: mockMoney(available),
          requested: mockMoney(body.amountKobo),
        });
      }
      if (withdrawalsOf(p.userId).some((w) => withdrawalStatus(w, t) === 'submitted')) {
        fail(409, 'CONFLICT', 'A withdrawal is already in progress. Wait for it to finish.');
      }
      const w: MockWithdrawal = {
        id: nextId('withdrawal'),
        nurseId: p.userId,
        amountKobo: body.amountKobo,
        destinationAddress: address,
        destinationMemo: memo ?? null,
        createdAt: t,
        fails: address.endsWith('FAIL'),
      };
      getState().withdrawals.push(w);
      return toWithdrawal(w, t);
    },
  };
}
