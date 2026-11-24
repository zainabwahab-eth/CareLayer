import type {
  AnswerResponse,
  ApiErrorBody,
  AuthTokensResponse,
  ChatResponse,
  CreateQuestionResponse,
  CreateTopupResponse,
  DraftResponse,
  EmergencyResponse,
  FeedbackResponse,
  MyQuestion,
  NotificationPreferences,
  NursePublicProfile,
  Page,
  QuestionStatusResponse,
  RequestCodeResponse,
  Topup,
  User,
  UserSettings,
  WalletResponse,
  WalletTransaction,
} from '@carelayer/shared';
import { ApiError } from '../errors';
import type { CareLayerApi } from '../types';

/*
 * fetch client for apps/api, used when VITE_USE_MOCK_API is not "true".
 *
 * Follows docs/API_CONTRACT.md §0: JSON in/out, `Authorization: Bearer`,
 * refresh token only in the httpOnly `cl_refresh` cookie (hence
 * `credentials: 'include'`). The access token is held in memory only,
 * never in localStorage. On a 401 it refreshes once and retries.
 *
 * Verified against apps/api routes in H10 (see docs/QUESTIONS.md Q5).
 * There is no fallback to mock data: a failed request always rejects with
 * ApiError, so screens show their error state.
 */

/**
 * Longest wait for one request. Chat and drafts call an LLM (about 10 s, retried
 * once by the API), so this is generous; it stops a dead mobile connection from
 * leaving a spinner up forever.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

const UNREACHABLE = 'Could not reach CareLayer. Check your connection.';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Query string values. `undefined` entries are left out. */
type Query = Readonly<Record<string, string | number | boolean | undefined>>;

interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Public endpoints never send a token and never trigger a refresh. */
  auth?: boolean;
}

export function createHttpApi(
  baseUrl: string,
  { timeoutMs = REQUEST_TIMEOUT_MS }: { timeoutMs?: number } = {},
): CareLayerApi {
  let accessToken: string | null = null;
  let refreshing: Promise<AuthTokensResponse> | null = null;

  function remember(tokens: AuthTokensResponse) {
    accessToken = tokens.accessToken;
    return tokens;
  }

  function buildUrl(path: string, query?: Query) {
    // baseUrl may be relative ("/api", the same-origin proxy for phone testing).
    const url = new URL(path, new URL(`${baseUrl}/`, window.location.origin));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async function send<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const { body, query, auth = true } = options;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response: Response;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      response = await fetch(buildUrl(path, query), {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // Status 0 = never reached the API (offline, DNS, CORS, timeout). AuthProvider
      // keeps the session and retries when the connection comes back.
      throw new ApiError(
        0,
        'INTERNAL',
        timedOut ? 'CareLayer is taking too long to answer. Please try again.' : UNREACHABLE,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      try {
        return (await response.json()) as T;
      } catch {
        // A 2xx that is not JSON is not apps/api: usually VITE_API_URL points at the
        // web server (its index.html) or a captive portal on a phone's Wi-Fi.
        throw new ApiError(response.status, 'INTERNAL', UNREACHABLE);
      }
    }

    let errorBody: ApiErrorBody | null = null;
    try {
      errorBody = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error (proxy, crash). Fall through to a generic error.
    }
    if (errorBody?.error?.code) throw ApiError.fromBody(response.status, errorBody);
    throw new ApiError(response.status, 'INTERNAL', 'Something went wrong. Please try again.');
  }

  /** Authenticated request: on 401 UNAUTHENTICATED, refresh once and retry. */
  async function authed<T>(method: Method, path: string, options: RequestOptions = {}) {
    try {
      return await send<T>(method, path, options);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'UNAUTHENTICATED') throw error;
      await refresh();
      return send<T>(method, path, options);
    }
  }

  function refresh() {
    // Collapse concurrent refreshes into one request (the cookie rotates on every refresh).
    refreshing ??= send<AuthTokensResponse>('POST', 'auth/refresh', { auth: false })
      .then(remember)
      .catch((error: unknown) => {
        accessToken = null;
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  const id = encodeURIComponent;

  return {
    mode: 'http',

    auth: {
      requestCode: (body) =>
        send<RequestCodeResponse>('POST', 'auth/code/request', {
          body,
          auth: body.purpose === 'step_up',
        }),
      verifyCode: (body) =>
        send<AuthTokensResponse>('POST', 'auth/code/verify', { body, auth: false }).then(remember),
      signInWithGoogle: (body) =>
        send<AuthTokensResponse>('POST', 'auth/google', { body, auth: false }).then(remember),
      refresh,
      logout: async () => {
        try {
          await send<void>('POST', 'auth/logout');
        } finally {
          accessToken = null;
        }
      },
      logoutAll: async () => {
        // Every session ends on the server, so the token is useless afterwards.
        await authed<void>('POST', 'auth/logout-all');
        accessToken = null;
      },
    },

    me: {
      get: () => authed<User>('GET', 'me'),
      update: (body) => authed<User>('PATCH', 'me', { body }),
      getSettings: () => authed<UserSettings>('GET', 'me/settings'),
      updateSettings: (body) => authed<UserSettings>('PATCH', 'me/settings', { body }),
      getNotifications: () => authed<NotificationPreferences>('GET', 'me/notifications'),
      updateNotifications: (body) =>
        authed<NotificationPreferences>('PATCH', 'me/notifications', { body }),
    },

    wallet: {
      get: () => authed<WalletResponse>('GET', 'wallet'),
      listTransactions: (query) =>
        authed<Page<WalletTransaction>>('GET', 'wallet/transactions', { query: { ...query } }),
    },

    topups: {
      create: (body) => authed<CreateTopupResponse>('POST', 'topups', { body }),
      get: (topupId) => authed<Topup>('GET', `topups/${id(topupId)}`),
    },

    chat: {
      send: (body) => authed<ChatResponse>('POST', 'chat', { body }),
      draft: (body) => authed<DraftResponse>('POST', 'chat/draft', { body }),
    },

    nurses: {
      list: (query) => authed<NursePublicProfile[]>('GET', 'nurses', { query: { ...query } }),
    },

    questions: {
      create: (body) => authed<CreateQuestionResponse>('POST', 'questions', { body }),
      getStatus: (questionId) =>
        authed<QuestionStatusResponse>('GET', `questions/${id(questionId)}/status`),
      listMine: (query) => authed<Page<MyQuestion>>('GET', 'me/questions', { query: { ...query } }),
      getMine: (questionId) => authed<MyQuestion>('GET', `me/questions/${id(questionId)}`),
      collectAnswer: (questionId, body) =>
        authed<AnswerResponse>(
          'POST',
          `me/questions/${id(questionId)}/collect`,
          body ? { body } : undefined,
        ),
      submitFeedback: (questionId, body) =>
        authed<FeedbackResponse>('POST', `questions/${id(questionId)}/feedback`, { body }),
    },

    emergency: {
      get: () => send<EmergencyResponse>('GET', 'emergency', { auth: false }),
    },
  };
}
