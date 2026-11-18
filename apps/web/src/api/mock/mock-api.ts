/*
 * MOCK API. In-browser stand-in for apps/api, used when VITE_USE_MOCK_API=true.
 *
 * - Implements the same CareLayerApi interface as the HTTP client, using only
 *   @carelayer/shared types, so screens never know which one is active.
 * - Mirrors the contract's behaviour and error codes (docs/API_CONTRACT.md v0)
 *   closely enough to build every state of the UI: loading, errors, emergency
 *   responses, free vs paid answers, spending limit, insufficient balance.
 * - State is in memory and resets on reload. The signed-in session is kept in
 *   sessionStorage to stand in for the httpOnly refresh cookie.
 * - Sign-in code for any email: MOCK_VERIFICATION_CODE ("123456").
 * - New questions are "claimed" by a mock health worker after ~45s and
 *   "answered" after ~2 min, so the waiting and response screens can be built.
 */
import {
  AUTH_RULES,
  FREE_ANSWERS_PER_WOMAN,
  type AnswerResponse,
  type ApiErrorCode,
  type AuthTokensResponse,
  type ChatMessage,
  type Conversation,
  type CreatedQuestion,
  type EscalationOffer,
  type Id,
  type MyQuestion,
  type Page,
  type PageQuery,
  type QuestionStatus,
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
  MOCK_WALLET_SEED,
  MOCK_WORKER_ANSWERS,
  MOCK_WORKERS,
  mockStellar,
  seedConversations,
  seedQuestions,
  seedTransactions,
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
  /** Simulated health worker timings for new questions. */
  claimAfterMs?: number;
  answerAfterMs?: number;
}

/** Stand-in for the refresh cookie: which mock user is signed in this browser session. */
const SESSION_KEY = 'carelayer.mock.session';
const SIGNED_OUT = 'signed-out';
const RESEND_COOLDOWN_MS = 30_000;
const MAX_TEXT_LENGTH = 4_000;

interface UserData {
  settings: UserSettings;
  wallet: { stellarAddress: string; balanceKobo: number; freeAnswersRemaining: number };
  conversations: Conversation[];
  questions: MockQuestionRecord[];
  transactions: WalletTransaction[];
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

function requireText(text: unknown, field: string): string {
  if (typeof text !== 'string' || !text.trim()) {
    fail(400, 'VALIDATION_FAILED', `${field} is required.`, { field });
  }
  const value = (text as string).trim();
  if (value.length > MAX_TEXT_LENGTH) {
    fail(400, 'VALIDATION_FAILED', `${field} is too long.`, { field, max: MAX_TEXT_LENGTH });
  }
  return value;
}

export function createMockApi(options: MockApiOptions = {}): CareLayerApi {
  const {
    latencyMs = 350,
    startSignedIn = true,
    claimAfterMs = 45_000,
    answerAfterMs = 120_000,
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
        wallet: { ...MOCK_WALLET_SEED },
        conversations: seedConversations(),
        questions: seedQuestions(),
        transactions: seedTransactions(),
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
      wallet: {
        stellarAddress: mockStellar('address', user.id),
        balanceKobo: 0,
        freeAnswersRemaining: FREE_ANSWERS_PER_WOMAN,
      },
      conversations: [],
      questions: [],
      transactions: [],
    });
    return user;
  }

  function questionStatus(q: MockQuestionRecord): QuestionStatus {
    const age = now() - Date.parse(q.createdAt);
    if (age >= q.answerAfterMs) return 'answered';
    if (age >= q.claimAfterMs) return 'claimed';
    return 'open';
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
        worker: q.worker,
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
      // Contract: present once answered AND paid/collected.
      answer: status === 'answered' && q.collected ? toAnswerResponse(q).answer : null,
      createdAt: q.createdAt,
    };
  }

  function findConversation(id: Id) {
    return (
      currentData().conversations.find((c) => c.id === id) ??
      fail(404, 'NOT_FOUND', 'We could not find that conversation.')
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
    },

    wallet: {
      get: () =>
        respond(() => {
          const { wallet } = currentData();
          return {
            stellarAddress: wallet.stellarAddress,
            balance: mockMoney(wallet.balanceKobo),
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

    chat: {
      createConversation: () =>
        respond(() => {
          const conversation: Conversation = { id: nextId('conv'), createdAt: iso(), messages: [] };
          currentData().conversations.unshift(conversation);
          return conversation;
        }),
      listConversations: (query) =>
        respond(() => {
          // Contract: list items carry the last message only.
          const summaries = currentData().conversations.map((c) => ({
            ...c,
            messages: c.messages.slice(-1),
          }));
          return paginate(summaries, query);
        }),
      getConversation: (id) => respond(() => findConversation(id)),
      sendMessage: (conversationId, body) =>
        respond(() => {
          const data = currentData();
          const conversation = findConversation(conversationId);
          const text = requireText(body.text, 'text');
          const userMessage: ChatMessage = {
            id: nextId('msg'),
            role: 'user',
            text,
            createdAt: iso(),
          };
          conversation.messages.push(userMessage);

          // Red-flag check comes first: emergency response, nothing queued, free.
          const flags = detectMockRedFlags(text);
          if (flags.length > 0) return mockEmergencyResponse(flags);

          // Categorise from everything she has said, not just the latest message.
          const category = mockCategorise(
            conversation.messages
              .filter((m) => m.role === 'user')
              .map((m) => m.text)
              .join(' '),
          );
          const message: ChatMessage = {
            id: nextId('msg'),
            role: 'assistant',
            text: mockAssistantReply(category),
            createdAt: iso(now() + 1),
          };
          conversation.messages.push(message);
          const userCount = conversation.messages.filter((m) => m.role === 'user').length;
          return {
            kind: 'reply' as const,
            message,
            escalationOffer: mockShouldOfferEscalation(text, userCount)
              ? escalationOffer(data, category)
              : null,
          };
        }),
    },

    questions: {
      create: (body) =>
        respond(() => {
          const data = currentData();
          const originalText = requireText(body.originalText, 'originalText');
          if (body.conversationId) findConversation(body.conversationId);

          const flags = detectMockRedFlags(originalText);
          if (flags.length > 0) return mockEmergencyResponse(flags);

          const isFree = data.wallet.freeAnswersRemaining > 0;
          if (
            !isFree &&
            MOCK_ANSWER_PRICE_KOBO > data.settings.spendingLimitPerAnswerKobo &&
            !body.approvedAboveLimit
          ) {
            fail(409, 'SPENDING_LIMIT_EXCEEDED', 'This answer costs more than your limit.', {
              priceKobo: MOCK_ANSWER_PRICE_KOBO,
              limitKobo: data.settings.spendingLimitPerAnswerKobo,
            });
          }

          const category = mockCategorise(originalText);
          const record: MockQuestionRecord = {
            id: nextId('q'),
            category,
            originalText, // stored verbatim
            cleanedText: mockCleanText(originalText),
            isFree,
            createdAt: iso(),
            conversationId: body.conversationId ?? null,
            claimAfterMs,
            answerAfterMs,
            worker: MOCK_WORKERS[data.questions.length % MOCK_WORKERS.length]!,
            answerText: MOCK_WORKER_ANSWERS[category],
            collected: false,
            stellarTxHash: null,
          };
          data.questions.unshift(record);

          const created: CreatedQuestion = {
            kind: 'question',
            id: record.id,
            status: 'open',
            category,
            price: mockMoney(MOCK_ANSWER_PRICE_KOBO),
            isFree,
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
            answeredAt: status === 'answered' ? answeredAt(q) : null,
          };
        }),

      listMine: (query) =>
        respond(() => {
          const sorted = [...currentData().questions].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          );
          return paginate(sorted.map(toMyQuestion), query);
        }),

      getMine: (id) => respond(() => toMyQuestion(findQuestion(id))),

      collectAnswer: (id) =>
        respond(() => {
          const data = currentData();
          const q = findQuestion(id);
          // Answered guard runs before any payment.
          if (questionStatus(q) !== 'answered') {
            fail(409, 'QUESTION_NOT_ANSWERED', 'A health worker has not answered yet.');
          }
          if (q.collected) return toAnswerResponse(q);

          if (q.isFree) {
            data.wallet.freeAnswersRemaining = Math.max(0, data.wallet.freeAnswersRemaining - 1);
          } else {
            if (data.wallet.balanceKobo < MOCK_ANSWER_PRICE_KOBO) {
              fail(409, 'INSUFFICIENT_BALANCE', 'Top up your balance to see this answer.', {
                priceKobo: MOCK_ANSWER_PRICE_KOBO,
                balanceKobo: data.wallet.balanceKobo,
              });
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
    },

    emergency: {
      get: () => respond(() => mockEmergencyResponse([])),
    },
  };
}
