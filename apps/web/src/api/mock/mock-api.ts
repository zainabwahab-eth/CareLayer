/*
 * MOCK API. In-browser stand-in for apps/api, used when VITE_USE_MOCK_API=true.
 *
 * - Implements the same CareLayerApi interface as the HTTP client, using only
 *   @carelayer/shared types, so screens never know which one is active.
 * - Mirrors the contract's behaviour and error codes (docs/API_CONTRACT.md v1)
 *   closely enough to build every state of the UI: loading, errors, emergency
 *   responses, free vs paid answers, spending limit, insufficient balance,
 *   consent, chosen nurse vs first available, "only female", expiry, feedback.
 * - State is in memory and resets on reload. The signed-in session is kept in
 *   sessionStorage to stand in for the httpOnly refresh cookie.
 * - Sign-in code for any email: MOCK_VERIFICATION_CODE ("123456").
 * - New questions are "claimed" by a mock nurse after ~45s and "answered"
 *   after ~2 min, so the waiting and response screens can be built. Pass a
 *   claimAfterMs beyond QUESTION_CLAIMS_CLOSE_MINUTES to see them expire.
 * - Top-ups skip Paystack: the "checkout" URL sends her straight back to the
 *   wallet screen with ?topupId=&reference= (like PAYSTACK_CALLBACK_URL). The
 *   top-up is "paid" after ~1.5s and "credited" after ~3s. That return is a
 *   full page load, so top-ups (only) are kept in sessionStorage, like Paystack's
 *   own record of the payment. A top-up of exactly
 *   MOCK_TOPUP_FAIL_KOBO (₦4,040) fails, so the failure state can be built.
 */
import {
  AUTH_RULES,
  CHAT_LIMITS,
  CHOSEN_NURSE_WINDOW_MINUTES,
  AGENT_TOKEN_PREFIX,
  FREE_ANSWERS_PER_WOMAN,
  MAX_AGENT_TOKENS,
  QUESTION_CLAIMS_CLOSE_MINUTES,
  SHARED_FIELDS,
  TOPUP_LIMITS_KOBO,
  type AgentTokenSummary,
  type AnswerResponse,
  type ApiErrorCode,
  type AuthTokensResponse,
  type ChatTurn,
  type Conversation,
  type ConversationMessage,
  type CreatedQuestion,
  type EscalationOffer,
  type Id,
  type MyQuestion,
  type NotificationPreferences,
  type Page,
  type PageQuery,
  type QuestionDraft,
  type QuestionStatus,
  type Topup,
  type User,
  type UserSettings,
  type WalletTransaction,
} from '@carelayer/shared';
import { ApiError } from '../errors';
import type { CareLayerApi } from '../types';
import {
  MOCK_SETTINGS,
  MOCK_USER,
  MOCK_VERIFICATION_CODE,
  MOCK_NOTIFICATIONS_SEED,
  MOCK_NURSE_ANSWERS,
  MOCK_NURSES,
  MOCK_WALLET_SEED,
  mockStellar,
  seedQuestions,
  seedTransactions,
  toPublicNurse,
  type MockNurse,
  type MockQuestionRecord,
} from './mock-data';
import {
  MOCK_ANSWER_PRICE_KOBO,
  detectMockRedFlags,
  mockAssistantReply,
  mockCategorise,
  mockCleanText,
  mockEmergencyResponse,
  mockMoney,
  mockShouldOfferEscalation,
} from './mock-rules';

export interface MockApiOptions {
  /** Simulated network latency per call. Default 350ms; use 0 in tests. */
  latencyMs?: number;
  /** Start signed in as the demo user (Tolu) unless she logged out this session. Default true. */
  startSignedIn?: boolean;
  /** Start the demo user with two saved chats (History). Default true; tests pass false. */
  seedChats?: boolean;
  /** Simulated nurse timings for new questions. */
  claimAfterMs?: number;
  answerAfterMs?: number;
  /** Simulated Paystack confirmation and USDC credit for top-ups. */
  topupPaidAfterMs?: number;
  topupCreditedAfterMs?: number;
}

/** A mock top-up of exactly this amount fails (₦4,040), to build the failure state. */
export const MOCK_TOPUP_FAIL_KOBO = 404_000;
/** Where Paystack sends her back (apps/api PAYSTACK_CALLBACK_URL points at the wallet screen). */
const MOCK_TOPUP_CALLBACK_PATH = '/account/wallet';

/** Stand-in for the refresh cookie: which mock user is signed in this browser session. */
const SESSION_KEY = 'carelayer.mock.session';
const SIGNED_OUT = 'signed-out';
const RESEND_COOLDOWN_MS = 30_000;
/** How long a mock draftToken is accepted (the API's are valid 2 hours). */
const DRAFT_TTL_MS = 2 * 60 * 60_000;
const MINUTE_MS = 60_000;
const CLAIMS_CLOSE_MS = QUESTION_CLAIMS_CLOSE_MINUTES * MINUTE_MS;
const CHOSEN_WINDOW_MS = CHOSEN_NURSE_WINDOW_MINUTES * MINUTE_MS;

interface UserData {
  settings: UserSettings;
  notifications: NotificationPreferences;
  wallet: { stellarAddress: string; balanceKobo: number; freeAnswersRemaining: number };
  /** Drafts handed out by chat.draft, by token (stand-in for the API's signed tokens). */
  drafts: Map<string, { draft: QuestionDraft; expiresAt: number }>;
  questions: MockQuestionRecord[];
  transactions: WalletTransaction[];
  topups: MockTopup[];
  /** Claude connections (agent tokens). Revoked ones are removed. */
  agentTokens: AgentTokenSummary[];
  /** Saved chats, as POST /chat stores them. */
  conversations: Conversation[];
}

interface MockTopup {
  id: Id;
  reference: string;
  amountKobo: number;
  createdAt: string;
  stellarTxHash: string | null;
  credited: boolean;
}

interface PendingCode {
  purpose: 'signup' | 'login' | 'step_up';
  name?: string;
  attempts: number;
  expiresAt: number;
  resendAvailableAt: number;
}

const fail = (
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never => {
  throw new ApiError(status, code, message, details);
};

function readSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(value: string) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, value);
  } catch {
    // Storage unavailable: the session just will not survive a reload.
  }
}

/** Paystack's record of mock top-ups. Survives the redirect back to the wallet. */
const TOPUPS_KEY = 'carelayer.mock.topups';

function readStoredTopups(): Record<Id, MockTopup[]> {
  try {
    const raw = window.sessionStorage.getItem(TOPUPS_KEY);
    return raw ? (JSON.parse(raw) as Record<Id, MockTopup[]>) : {};
  } catch {
    return {};
  }
}

function writeStoredTopups(userId: Id, topups: MockTopup[]) {
  try {
    window.sessionStorage.setItem(
      TOPUPS_KEY,
      JSON.stringify({ ...readStoredTopups(), [userId]: topups }),
    );
  } catch {
    // Storage unavailable: a top-up cannot be followed after the redirect.
  }
}

function paginate<T>(items: readonly T[], query: PageQuery = {}): Page<T> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
  const start = query.cursor ? Number(query.cursor) : 0;
  if (!Number.isInteger(start) || start < 0) {
    fail(400, 'VALIDATION_FAILED', 'Invalid cursor.');
  }
  const pageItems = items.slice(start, start + limit);
  const next = start + limit;
  return { items: pageItems, nextCursor: next < items.length ? String(next) : null };
}

function requireText(
  text: unknown,
  field: string,
  max: number = CHAT_LIMITS.maxTextLength,
): string {
  if (typeof text !== 'string' || !text.trim()) {
    fail(400, 'VALIDATION_FAILED', `${field} is required.`, { field });
  }
  const value = (text as string).trim();
  if (value.length > max) {
    fail(400, 'VALIDATION_FAILED', `${field} is too long.`, { field, max });
  }
  return value;
}

/** The same checks as the API's ChatRequestSchema / DraftRequestSchema (contract §7). */
function requireTurns(messages: unknown, lastMustBeHers: boolean): ChatTurn[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    fail(400, 'VALIDATION_FAILED', 'Send at least one message.', { field: 'messages' });
  }
  const turns = messages as ChatTurn[];
  if (turns.length > CHAT_LIMITS.maxTurns) {
    fail(400, 'VALIDATION_FAILED', `Send at most the last ${CHAT_LIMITS.maxTurns} messages.`, {
      field: 'messages',
    });
  }
  const checked = turns.map((turn) => {
    if (turn?.role !== 'user' && turn?.role !== 'assistant') {
      fail(400, 'VALIDATION_FAILED', 'role must be "user" or "assistant"', { field: 'messages' });
    }
    return { role: turn.role, text: requireText(turn.text, 'messages') };
  });
  if (lastMustBeHers && checked[checked.length - 1]!.role !== 'user') {
    fail(400, 'VALIDATION_FAILED', 'The last message must be hers (role "user").', {
      field: 'messages',
    });
  }
  if (!lastMustBeHers && !checked.some((t) => t.role === 'user')) {
    fail(400, 'VALIDATION_FAILED', 'Include at least one of her messages (role "user").', {
      field: 'messages',
    });
  }
  return checked;
}

/** Her question for a nurse: her messages joined verbatim (as apps/api questionTextFrom). */
function questionTextFrom(turns: readonly ChatTurn[]): string {
  return turns
    .filter((t) => t.role === 'user')
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Two saved chats for the demo user, so History is not empty in mock mode. */
function seedConversations(): Conversation[] {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const chat = (id: string, minutesAgo: number, turns: Array<[string, string]>): Conversation => ({
    id,
    title: turns[0]![0],
    createdAt: at(minutesAgo + 5),
    updatedAt: at(minutesAgo),
    questions: [],
    messages: turns.flatMap(([q, a], i) => [
      {
        id: `${id}_u${i}`,
        role: 'user' as const,
        text: q,
        emergency: false,
        createdAt: at(minutesAgo + 4 - i),
      },
      {
        id: `${id}_a${i}`,
        role: 'assistant' as const,
        text: a,
        emergency: false,
        createdAt: at(minutesAgo + 4 - i),
      },
    ]),
  });
  return [
    chat('mock_chat_seed_1', 30, [
      [
        'I have a mosquito bite, what can I do?',
        'Wash the area with soap and water and try not to scratch it. A cool cloth or calamine lotion can soothe the itch.',
      ],
      [
        'Are there ointments I can use?',
        'Yes, there are ointments you can use to help with itching and swelling, such as hydrocortisone cream or calamine lotion.',
      ],
    ]),
    chat('mock_chat_seed_2', 60 * 26, [
      [
        'Is it normal to have cramps a week before my period?',
        'Mild cramps before a period are common. If they are severe or new for you, a nurse can check.',
      ],
    ]),
  ];
}

export function createMockApi(options: MockApiOptions = {}): CareLayerApi {
  const {
    latencyMs = 350,
    startSignedIn = true,
    seedChats = true,
    claimAfterMs = 45_000,
    answerAfterMs = 120_000,
    topupPaidAfterMs = 1_500,
    topupCreditedAfterMs = 3_000,
  } = options;

  let counter = 0;
  const nextId = (prefix: string) => `mock_${prefix}_${Date.now().toString(36)}${++counter}`;
  const now = () => Date.now();
  const iso = (ms = now()) => new Date(ms).toISOString();

  // ---- state ---------------------------------------------------------------
  const usersByEmail = new Map<string, User>([[MOCK_USER.email, { ...MOCK_USER }]]);
  const dataByUser = new Map<Id, UserData>([
    [
      MOCK_USER.id,
      {
        settings: { ...MOCK_SETTINGS },
        notifications: { ...MOCK_NOTIFICATIONS_SEED },
        wallet: { ...MOCK_WALLET_SEED },
        drafts: new Map(),
        questions: seedQuestions(),
        transactions: seedTransactions(),
        topups: readStoredTopups()[MOCK_USER.id] ?? [],
        agentTokens: [],
        conversations: seedChats ? seedConversations() : [],
      },
    ],
  ]);
  const pendingCodes = new Map<string, PendingCode>();

  const storedSession = readSession();
  let currentUserId: Id | null =
    storedSession === SIGNED_OUT
      ? null
      : storedSession && [...usersByEmail.values()].some((u) => u.id === storedSession)
        ? storedSession
        : startSignedIn
          ? MOCK_USER.id
          : null;

  // ---- helpers -------------------------------------------------------------
  /** Simulate latency and hand back a deep copy so the UI can never mutate mock state. */
  async function respond<T>(produce: () => T): Promise<T> {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    return structuredClone(produce());
  }

  function currentUser(): User {
    const user = [...usersByEmail.values()].find((u) => u.id === currentUserId);
    return user ?? fail(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }

  function currentData(): UserData {
    return dataByUser.get(currentUser().id)!;
  }

  function signIn(user: User): AuthTokensResponse {
    currentUserId = user.id;
    writeSession(user.id);
    return {
      accessToken: nextId('access'),
      accessTokenExpiresAt: iso(now() + AUTH_RULES.accessTokenTtlMinutes * 60_000),
      user,
    };
  }

  function createAccount(email: string, displayName: string): User {
    const user: User = {
      id: nextId('user'),
      role: 'woman',
      displayName,
      email,
      createdAt: iso(),
    };
    usersByEmail.set(email, user);
    dataByUser.set(user.id, {
      settings: { ...MOCK_SETTINGS },
      notifications: { ...MOCK_NOTIFICATIONS_SEED },
      wallet: {
        stellarAddress: mockStellar('address', user.id),
        balanceKobo: 0,
        freeAnswersRemaining: FREE_ANSWERS_PER_WOMAN,
      },
      drafts: new Map(),
      questions: [],
      transactions: [],
      topups: [],
      agentTokens: [],
      conversations: [],
    });
    return user;
  }

  /** Nobody claimed it before claims closed (contract §8.1 step 8): she pays nothing. */
  const neverClaimed = (q: MockQuestionRecord) => q.claimAfterMs > CLAIMS_CLOSE_MS;

  function questionStatus(q: MockQuestionRecord): QuestionStatus {
    const age = now() - Date.parse(q.createdAt);
    if (neverClaimed(q)) return age >= CLAIMS_CLOSE_MS ? 'expired' : 'open';
    if (age >= q.answerAfterMs) return 'answered';
    if (age >= q.claimAfterMs) return 'claimed';
    return 'open';
  }

  function claimsCloseAt(q: MockQuestionRecord) {
    return iso(Date.parse(q.createdAt) + CLAIMS_CLOSE_MS);
  }

  function answeredAt(q: MockQuestionRecord) {
    return iso(Date.parse(q.createdAt) + q.answerAfterMs);
  }

  function findQuestion(id: Id) {
    return (
      currentData().questions.find((q) => q.id === id) ??
      fail(404, 'NOT_FOUND', 'We could not find that question.')
    );
  }

  function toAnswerResponse(q: MockQuestionRecord): AnswerResponse {
    return {
      answer: {
        questionId: q.id,
        text: q.answerText,
        nurse: toPublicNurse(q.nurse),
        recommendSeeSomeoneToday: q.recommendSeeSomeoneToday,
        answeredAt: answeredAt(q),
      },
      payment: {
        amount: mockMoney(MOCK_ANSWER_PRICE_KOBO),
        stellarTxHash: q.stellarTxHash,
        paidFromTreasury: q.isFree,
      },
    };
  }

  function toMyQuestion(q: MockQuestionRecord): MyQuestion {
    const status = questionStatus(q);
    return {
      id: q.id,
      status,
      category: q.category,
      originalText: q.originalText,
      cleanedText: q.cleanedText,
      price: mockMoney(MOCK_ANSWER_PRICE_KOBO),
      isFree: q.isFree,
      nurseSelection: q.nurseSelection,
      chosenNurse: q.chosenNurseId ? toPublicNurse(findNurse(q.chosenNurseId)!) : null,
      femaleOnly: q.femaleOnly,
      claimsCloseAt: claimsCloseAt(q),
      // Contract: present once answered AND paid/collected.
      answer: status === 'answered' && q.collected ? toAnswerResponse(q).answer : null,
      feedback: q.feedback ? { helpful: q.feedback.helpful } : null,
      createdAt: q.createdAt,
    };
  }

  function findNurse(id: Id): MockNurse | undefined {
    return MOCK_NURSES.find((n) => n.profile.id === id);
  }

  /** Approved, available nurses she may send this question to (GET /nurses and selection). */
  function eligibleNurses(femaleOnly: boolean): MockNurse[] {
    return MOCK_NURSES.filter(
      (n) => n.profile.available && (!femaleOnly || n.profile.gender === 'female'),
    );
  }

  function escalationOffer(
    data: UserData,
    category: MockQuestionRecord['category'],
  ): EscalationOffer {
    const isFree = data.wallet.freeAnswersRemaining > 0;
    return {
      price: mockMoney(MOCK_ANSWER_PRICE_KOBO),
      isFree,
      freeAnswersRemaining: data.wallet.freeAnswersRemaining,
      suggestedCategory: category,
      exceedsSpendingLimit:
        !isFree && MOCK_ANSWER_PRICE_KOBO > data.settings.spendingLimitPerAnswerKobo,
    };
  }

  /** Topup status from its age; credits the wallet once, when it first reads as credited. */
  function settleTopup(data: UserData, topup: MockTopup): Topup {
    const age = now() - Date.parse(topup.createdAt);
    const fails = topup.amountKobo === MOCK_TOPUP_FAIL_KOBO;
    let status: Topup['status'] = 'pending';
    if (fails && age >= topupPaidAfterMs) status = 'failed';
    else if (!fails && age >= topupCreditedAfterMs) status = 'credited';
    else if (!fails && age >= topupPaidAfterMs) status = 'paid';

    if (status === 'credited' && !topup.credited) {
      topup.credited = true;
      topup.stellarTxHash = mockStellar('tx', topup.id.replace(/^mock_/, ''));
      data.wallet.balanceKobo += topup.amountKobo;
      data.transactions.unshift({
        id: nextId('tx'),
        kind: 'topup',
        amount: mockMoney(topup.amountKobo),
        stellarTxHash: topup.stellarTxHash,
        questionId: null,
        createdAt: iso(),
      });
    }
    return {
      id: topup.id,
      status,
      amount: mockMoney(topup.amountKobo),
      stellarTxHash: topup.stellarTxHash,
      createdAt: topup.createdAt,
    };
  }

  // ---- API -----------------------------------------------------------------
  return {
    mode: 'mock',

    auth: {
      requestCode: (body) =>
        respond(() => {
          const email = body.email?.trim().toLowerCase() ?? '';
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            fail(400, 'VALIDATION_FAILED', 'Enter a valid email address.', { field: 'email' });
          }
          if (body.app !== 'women') fail(403, 'WRONG_APP', 'This account is for the other app.');
          const exists = usersByEmail.has(email);
          if (body.purpose === 'signup') {
            if (!body.name?.trim()) {
              fail(400, 'VALIDATION_FAILED', 'Tell us what to call you.', { field: 'name' });
            }
            if (exists) fail(409, 'ACCOUNT_EXISTS', 'You already have an account. Log in instead.');
          }
          if (body.purpose === 'login' && !exists) {
            fail(404, 'ACCOUNT_NOT_FOUND', 'We could not find that account. Sign up instead.');
          }
          if (body.purpose === 'step_up') currentUser();

          const previous = pendingCodes.get(email);
          if (previous && previous.resendAvailableAt > now()) {
            fail(429, 'RATE_LIMITED', 'Please wait a moment before asking for a new code.');
          }
          const resendAvailableAt = now() + RESEND_COOLDOWN_MS;
          pendingCodes.set(email, {
            purpose: body.purpose,
            name: body.name?.trim(),
            attempts: 0,
            expiresAt: now() + AUTH_RULES.codeTtlMinutes * 60_000,
            resendAvailableAt,
          });
          return { sent: true as const, resendAvailableAt: iso(resendAvailableAt) };
        }),

      verifyCode: (body) =>
        respond(() => {
          const email = body.email?.trim().toLowerCase() ?? '';
          if (body.app !== 'women') fail(403, 'WRONG_APP', 'This account is for the other app.');
          const pending = pendingCodes.get(email);
          if (!pending || pending.purpose !== body.purpose || pending.expiresAt < now()) {
            fail(410, 'CODE_EXPIRED', 'That code has expired. We can send you a new one.');
          }
          const code = pending!;
          if (code.attempts >= AUTH_RULES.codeMaxAttempts) {
            fail(429, 'CODE_ATTEMPTS_EXCEEDED', 'Too many tries. Ask for a new code.');
          }
          if (body.code !== MOCK_VERIFICATION_CODE) {
            code.attempts += 1;
            const attemptsRemaining = AUTH_RULES.codeMaxAttempts - code.attempts;
            if (attemptsRemaining <= 0) {
              fail(429, 'CODE_ATTEMPTS_EXCEEDED', 'Too many tries. Ask for a new code.');
            }
            fail(400, 'CODE_INVALID', 'That code is not right.', { attemptsRemaining });
          }
          pendingCodes.delete(email);
          const user =
            body.purpose === 'signup'
              ? createAccount(email, body.name?.trim() || code.name || 'Friend')
              : usersByEmail.get(email)!;
          return signIn(user);
        }),

      signInWithGoogle: (body) =>
        respond(() => {
          if (!body.idToken?.trim()) fail(401, 'GOOGLE_TOKEN_INVALID', 'Google sign-in failed.');
          if (body.app !== 'women') fail(403, 'WRONG_APP', 'This account is for the other app.');
          // Mock: "login" signs in the demo user; "signup" creates a Google-style test account.
          if (body.mode === 'login') return signIn(usersByEmail.get(MOCK_USER.email)!);
          const email = 'google.user@example.com';
          if (usersByEmail.has(email)) {
            fail(409, 'ACCOUNT_EXISTS', 'You already have an account. Log in instead.');
          }
          return signIn(createAccount(email, body.name?.trim() || 'Friend'));
        }),

      refresh: () =>
        respond(() => {
          const user = [...usersByEmail.values()].find((u) => u.id === currentUserId);
          return user
            ? signIn(user)
            : fail(401, 'REFRESH_INVALID', 'Your session has ended. Please sign in again.');
        }),

      logout: () =>
        respond(() => {
          currentUser();
          currentUserId = null;
          writeSession(SIGNED_OUT);
        }),

      logoutAll: () =>
        respond(() => {
          currentUser();
          currentUserId = null;
          writeSession(SIGNED_OUT);
        }),
    },

    me: {
      get: () => respond(() => currentUser()),
      update: (body) =>
        respond(() => {
          const user = currentUser();
          if (body.displayName !== undefined) {
            const name = body.displayName.trim();
            if (!name || name.length > 60) {
              fail(400, 'VALIDATION_FAILED', 'Use between 1 and 60 characters.', {
                field: 'displayName',
              });
            }
            user.displayName = name;
          }
          return user;
        }),
      getSettings: () => respond(() => currentData().settings),
      updateSettings: (body) =>
        respond(() => {
          const data = currentData();
          for (const key of [
            'spendingLimitPerAnswerKobo',
            'mcpSpendingLimitPerAnswerKobo',
          ] as const) {
            const value = body[key];
            if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
              fail(400, 'VALIDATION_FAILED', 'Limits must be whole amounts of zero or more.', {
                field: key,
              });
            }
          }
          data.settings = { ...data.settings, ...body };
          return data.settings;
        }),
      getNotifications: () => respond(() => currentData().notifications),
      updateNotifications: (body) =>
        respond(() => {
          const data = currentData();
          if (
            body.notifyWhenAnswered !== undefined &&
            typeof body.notifyWhenAnswered !== 'boolean'
          ) {
            fail(400, 'VALIDATION_FAILED', 'notifyWhenAnswered must be true or false.', {
              field: 'notifyWhenAnswered',
            });
          }
          data.notifications = { ...data.notifications, ...body };
          return data.notifications;
        }),
    },

    nurses: {
      list: (query = {}) =>
        respond(() => {
          currentUser(); // auth: agent (a signed-in woman here)
          return eligibleNurses(query.femaleOnly === true)
            .filter((n) => !query.topic || n.profile.topics.includes(query.topic))
            .map((n) => n.profile);
        }),
    },

    wallet: {
      get: () =>
        respond(() => {
          const { wallet } = currentData();
          return {
            stellarAddress: wallet.stellarAddress,
            status: 'active' as const,
            balance: mockMoney(wallet.balanceKobo),
            balanceSyncedAt: iso(),
            freeAnswersRemaining: wallet.freeAnswersRemaining,
          };
        }),
      listTransactions: (query) =>
        respond(() => {
          const sorted = [...currentData().transactions].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          );
          return paginate(sorted, query);
        }),
    },

    topups: {
      create: (body) =>
        respond(() => {
          const data = currentData();
          const { amountKobo } = body;
          if (
            !Number.isInteger(amountKobo) ||
            amountKobo < TOPUP_LIMITS_KOBO.min ||
            amountKobo > TOPUP_LIMITS_KOBO.max
          ) {
            fail(400, 'VALIDATION_FAILED', 'Top up between ₦100 and ₦100,000.', {
              field: 'amountKobo',
            });
          }
          const topup: MockTopup = {
            id: nextId('topup'),
            reference: nextId('ref'),
            amountKobo,
            createdAt: iso(),
            stellarTxHash: null,
            credited: false,
          };
          data.topups.push(topup);
          writeStoredTopups(currentUser().id, data.topups);
          const url = new URL(MOCK_TOPUP_CALLBACK_PATH, window.location.origin);
          url.searchParams.set('topupId', topup.id);
          url.searchParams.set('reference', topup.reference);
          return {
            topupId: topup.id,
            reference: topup.reference,
            authorizationUrl: url.toString(),
          };
        }),
      get: (id) =>
        respond(() => {
          const data = currentData();
          const topup =
            data.topups.find((t) => t.id === id) ??
            fail(404, 'NOT_FOUND', 'We could not find that top-up.');
          const result = settleTopup(data, topup);
          writeStoredTopups(currentUser().id, data.topups);
          return result;
        }),
    },

    chat: {
      // Like POST /chat: the thread comes from the client; her message and the reply are saved.
      send: (body) =>
        respond(() => {
          const data = currentData();
          const turns = requireTurns(body?.messages, true);
          const text = turns[turns.length - 1]!.text;
          const existing = body.conversationId
            ? data.conversations.find((c) => c.id === body.conversationId)
            : undefined;
          if (body.conversationId && !existing) fail(404, 'NOT_FOUND', 'Chat not found.');

          const save = (messages: Array<Omit<ConversationMessage, 'id' | 'createdAt'>>) => {
            const at = iso();
            const rows = messages.map((m) => ({ ...m, id: nextId('cmsg'), createdAt: at }));
            if (existing) {
              existing.messages.push(...rows);
              existing.updatedAt = at;
              return existing.id;
            }
            const conversation: Conversation = {
              id: nextId('chat'),
              title: text.replace(/\s+/g, ' ').trim().slice(0, 80),
              createdAt: at,
              updatedAt: at,
              messages: rows,
              questions: [],
            };
            data.conversations.push(conversation);
            return conversation.id;
          };

          // Red-flag check on her new message first: emergency, nothing queued, free.
          const flags = detectMockRedFlags(text);
          if (flags.length > 0) {
            const conversationId = save([{ role: 'user', text, emergency: true }]);
            return { ...mockEmergencyResponse(flags), conversationId };
          }

          // Categorise from everything she has said, not just the latest message.
          const category = mockCategorise(questionTextFrom(turns));
          const userCount = turns.filter((t) => t.role === 'user').length;
          const reply = mockAssistantReply(category);
          const conversationId = save([
            { role: 'user', text, emergency: false },
            { role: 'assistant', text: reply, emergency: false },
          ]);
          return {
            kind: 'reply' as const,
            message: {
              id: nextId('msg'),
              role: 'assistant' as const,
              text: reply,
              createdAt: iso(),
            },
            escalationOffer: mockShouldOfferEscalation(text, userCount)
              ? escalationOffer(data, category)
              : null,
            conversationId,
          };
        }),

      listConversations: (query = {}) =>
        respond(() => {
          const sorted = [...currentData().conversations].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          );
          return paginate(
            sorted.map((c) => ({
              id: c.id,
              title: c.title,
              preview: (c.messages.at(-1)?.text ?? '').slice(0, 120),
              messageCount: c.messages.length,
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
            })),
            query,
          );
        }),

      getConversation: (id) =>
        respond(() => {
          const found = currentData().conversations.find((c) => c.id === id);
          return found ?? fail(404, 'NOT_FOUND', 'Chat not found.');
        }),

      deleteConversation: (id) =>
        respond(() => {
          const data = currentData();
          const index = data.conversations.findIndex((c) => c.id === id);
          if (index === -1) fail(404, 'NOT_FOUND', 'Chat not found.');
          data.conversations.splice(index, 1);
        }),
      draft: (body) =>
        respond(() => {
          const data = currentData();
          const turns = requireTurns(body?.messages, false);
          // Everything she wrote is checked for red flags, as on the API.
          const flags = detectMockRedFlags(questionTextFrom(turns));
          if (flags.length > 0) return mockEmergencyResponse(flags);

          // Like the API: the question is the message the nurse was offered for, else her
          // latest real question (not "I'm ready to ask now"), never the whole chat.
          const focus = body.focusIndex === undefined ? undefined : turns[body.focusIndex];
          const hers = turns.filter((t) => t.role === 'user' && t.text.trim());
          const question =
            focus?.role === 'user' && focus.text.trim()
              ? focus
              : ([...hers].reverse().find((t) => t.text.trim().split(/\s+/).length > 4) ??
                hers.at(-1)!);
          const originalText = question.text.trim();

          const category = mockCategorise(originalText);
          const draft: QuestionDraft = {
            originalText,
            cleanedText: mockCleanText(originalText),
            assistantNotes: null,
            category,
            ageRange: null,
            pregnancyWeeks: null,
          };
          const draftToken = nextId('draft');
          const expiresAt = now() + DRAFT_TTL_MS;
          data.drafts.set(draftToken, { draft, expiresAt });
          return {
            kind: 'draft' as const,
            draft,
            draftToken,
            draftExpiresAt: iso(expiresAt),
            offer: escalationOffer(data, category),
          };
        }),
    },

    questions: {
      create: (body) =>
        respond(() => {
          const data = currentData();
          const originalText = requireText(
            body.originalText,
            'originalText',
            CHAT_LIMITS.maxQuestionLength,
          );

          // With a draftToken the question is exactly the draft she saw on W07 (§8.1 step 4).
          let draft: QuestionDraft | null = null;
          if (body.draftToken !== undefined) {
            const issued = data.drafts.get(body.draftToken);
            if (!issued || issued.expiresAt < now()) {
              fail(
                400,
                'VALIDATION_FAILED',
                'This draft has expired. Review your question again before sending it.',
                { field: 'draftToken' },
              );
            }
            draft = issued!.draft;
            if (draft.originalText !== body.originalText) {
              fail(400, 'VALIDATION_FAILED', 'originalText must match the draft.', {
                field: 'originalText',
              });
            }
          }

          // Red-flag check comes first (§8.1 step 1): emergency, nothing queued, free.
          const flags = detectMockRedFlags(originalText);
          if (flags.length > 0) return mockEmergencyResponse(flags);

          const consent = body.consent;
          if (
            !consent ||
            !Array.isArray(consent.sharedFields) ||
            consent.sharedFields.length === 0 ||
            !consent.sharedFields.every((f) => SHARED_FIELDS.includes(f)) ||
            typeof consent.consentVersion !== 'string' ||
            !consent.consentVersion.trim()
          ) {
            fail(400, 'CONSENT_REQUIRED', 'Agree to what is shared with the nurse first.');
          }

          const nurseSelection = body.nurseSelection ?? 'first_available';
          if (nurseSelection !== 'first_available' && nurseSelection !== 'chosen_nurse') {
            fail(400, 'VALIDATION_FAILED', 'Unknown nurse selection.', { field: 'nurseSelection' });
          }
          const femaleOnly = body.femaleOnly === true;
          const eligible = eligibleNurses(femaleOnly);
          let answerer: MockNurse;
          if (nurseSelection === 'chosen_nurse') {
            if (!body.chosenNurseId) {
              fail(400, 'VALIDATION_FAILED', 'Choose a nurse.', { field: 'chosenNurseId' });
            }
            const chosen = eligible.find((n) => n.profile.id === body.chosenNurseId);
            if (!chosen) {
              fail(409, 'CHOSEN_NURSE_UNAVAILABLE', 'That nurse is not available right now.');
            }
            answerer = chosen!;
          } else {
            answerer =
              eligible[data.questions.length % Math.max(eligible.length, 1)] ?? MOCK_NURSES[0]!;
          }

          const isFree = data.wallet.freeAnswersRemaining > 0;
          if (
            !isFree &&
            MOCK_ANSWER_PRICE_KOBO > data.settings.spendingLimitPerAnswerKobo &&
            !body.approvedAboveLimit
          ) {
            fail(409, 'SPENDING_LIMIT_EXCEEDED', 'This answer costs more than your limit.', {
              priceKobo: MOCK_ANSWER_PRICE_KOBO,
              spendingLimitKobo: data.settings.spendingLimitPerAnswerKobo,
            });
          }

          const category = draft?.category ?? mockCategorise(originalText);
          const record: MockQuestionRecord = {
            id: nextId('q'),
            category,
            originalText, // stored verbatim
            cleanedText: draft?.cleanedText ?? mockCleanText(originalText),
            isFree,
            createdAt: iso(),
            consent: {
              sharedFields: [...consent.sharedFields],
              consentVersion: consent.consentVersion,
            },
            nurseSelection,
            chosenNurseId: nurseSelection === 'chosen_nurse' ? answerer.profile.id : null,
            femaleOnly,
            claimAfterMs,
            answerAfterMs,
            nurse: answerer,
            answerText: MOCK_NURSE_ANSWERS[category],
            recommendSeeSomeoneToday: false,
            collected: false,
            stellarTxHash: null,
            feedback: null,
          };
          data.questions.unshift(record);
          // Shown in the chat she asked from (ignored if it is not hers), as on the API.
          const fromChat = body.conversationId
            ? data.conversations.find((c) => c.id === body.conversationId)
            : undefined;
          fromChat?.questions.push({ questionId: record.id, createdAt: record.createdAt });

          const created: CreatedQuestion = {
            kind: 'question',
            id: record.id,
            status: 'open',
            category,
            price: mockMoney(MOCK_ANSWER_PRICE_KOBO),
            isFree,
            nurseSelection,
            chosenUntil:
              nurseSelection === 'chosen_nurse'
                ? iso(Date.parse(record.createdAt) + CHOSEN_WINDOW_MS)
                : null,
            claimsCloseAt: claimsCloseAt(record),
            questionKey: null, // signed-in caller
            createdAt: record.createdAt,
          };
          return created;
        }),

      getStatus: (id) =>
        respond(() => {
          const q = findQuestion(id);
          const status = questionStatus(q);
          return {
            id: q.id,
            status,
            category: q.category,
            claimsCloseAt: claimsCloseAt(q),
            answeredAt: status === 'answered' ? answeredAt(q) : null,
            expiredAt: status === 'expired' ? claimsCloseAt(q) : null,
          };
        }),

      listMine: (query = {}) =>
        respond(() => {
          const sorted = [...currentData().questions].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          );
          const mine = sorted.map(toMyQuestion);
          const { status, ...page } = query;
          return paginate(status ? mine.filter((q) => q.status === status) : mine, page);
        }),

      getMine: (id) => respond(() => toMyQuestion(findQuestion(id))),

      collectAnswer: (id, body = {}) =>
        respond(() => {
          const data = currentData();
          const q = findQuestion(id);
          // Answered guard runs before any payment. Expired questions are never charged.
          const status = questionStatus(q);
          if (status === 'expired') {
            fail(410, 'QUESTION_EXPIRED', 'No nurse was free in time. You were not charged.');
          }
          if (status !== 'answered') {
            fail(409, 'QUESTION_NOT_ANSWERED', 'A nurse has not answered yet.');
          }
          if (q.collected) return toAnswerResponse(q);

          if (q.isFree) {
            data.wallet.freeAnswersRemaining = Math.max(0, data.wallet.freeAnswersRemaining - 1);
          } else {
            const limitKobo = data.settings.spendingLimitPerAnswerKobo;
            if (MOCK_ANSWER_PRICE_KOBO > limitKobo && !body.approvedAboveLimit) {
              fail(409, 'SPENDING_LIMIT_EXCEEDED', 'This answer costs more than your limit.', {
                priceKobo: MOCK_ANSWER_PRICE_KOBO,
                spendingLimitKobo: limitKobo,
              });
            }
            if (data.wallet.balanceKobo < MOCK_ANSWER_PRICE_KOBO) {
              fail(
                409,
                'INSUFFICIENT_BALANCE',
                'Not enough in your wallet for this answer. Top up to continue.',
                {
                  price: mockMoney(MOCK_ANSWER_PRICE_KOBO),
                  balance: mockMoney(data.wallet.balanceKobo),
                },
              );
            }
            data.wallet.balanceKobo -= MOCK_ANSWER_PRICE_KOBO;
            q.stellarTxHash = mockStellar('tx', nextId('pay').replace(/^mock_/, ''));
            data.transactions.unshift({
              id: nextId('tx'),
              kind: 'answer_payment',
              amount: mockMoney(-MOCK_ANSWER_PRICE_KOBO),
              stellarTxHash: q.stellarTxHash,
              questionId: q.id,
              createdAt: iso(),
            });
          }
          q.collected = true;
          return toAnswerResponse(q);
        }),

      submitFeedback: (id, body) =>
        respond(() => {
          const q = findQuestion(id);
          if (typeof body.helpful !== 'boolean') {
            fail(400, 'VALIDATION_FAILED', 'helpful must be true or false.', { field: 'helpful' });
          }
          // Feedback is on an answer she has seen (answered + collected).
          if (questionStatus(q) !== 'answered' || !q.collected) {
            fail(409, 'QUESTION_NOT_ANSWERED', 'You can rate an answer once you have read it.');
          }
          q.feedback = { helpful: body.helpful, updatedAt: iso() };
          return { questionId: q.id, helpful: q.feedback.helpful, updatedAt: q.feedback.updatedAt };
        }),
    },

    agentTokens: {
      list: () =>
        respond(() =>
          [...currentData().agentTokens].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        ),

      create: (body) =>
        respond(() => {
          const data = currentData();
          const label = typeof body.label === 'string' ? body.label.trim() : '';
          if (!label || label.length > 60) {
            fail(400, 'VALIDATION_FAILED', 'Give this connection a name (up to 60 characters).', {
              field: 'label',
            });
          }
          if (data.agentTokens.length >= MAX_AGENT_TOKENS) {
            fail(409, 'CONFLICT', `You can have up to ${MAX_AGENT_TOKENS} Claude connections.`);
          }
          const summary: AgentTokenSummary = {
            id: nextId('agent'),
            label,
            createdAt: iso(),
            lastUsedAt: null,
          };
          data.agentTokens.push(summary);
          return { ...summary, token: `${AGENT_TOKEN_PREFIX}${nextId('secret')}` };
        }),

      revoke: (id) =>
        respond(() => {
          const data = currentData();
          const index = data.agentTokens.findIndex((t) => t.id === id);
          if (index === -1) fail(404, 'NOT_FOUND', 'That connection was not found.');
          data.agentTokens.splice(index, 1);
        }),
    },

    emergency: {
      get: () => respond(() => mockEmergencyResponse([])),
    },
  };
}
