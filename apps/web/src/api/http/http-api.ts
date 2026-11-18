import type {
  AnswerResponse,
  ApiErrorBody,
  AuthTokensResponse,
  Conversation,
  CreateQuestionResponse,
  EmergencyResponse,
  MyQuestion,
  Page,
  PageQuery,
  QuestionStatusResponse,
  RequestCodeResponse,
  SendMessageResponse,
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
 * NOTE: written against the contract; not yet exercised against a running
 * apps/api. Verify when the backend endpoints land.
 */

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  query?: PageQuery;
  /** Public endpoints never send a token and never trigger a refresh. */
  auth?: boolean;
}

export function createHttpApi(baseUrl: string): CareLayerApi {
  let accessToken: string | null = null;
  let refreshing: Promise<AuthTokensResponse> | null = null;

  function remember(tokens: AuthTokensResponse) {
    accessToken = tokens.accessToken;
    return tokens;
  }

  function buildUrl(path: string, query?: PageQuery) {
    const url = new URL(path, `${baseUrl}/`);
    if (query?.cursor) url.searchParams.set('cursor', query.cursor);
    if (query?.limit !== undefined) url.searchParams.set('limit', String(query.limit));
    return url.toString();
  }

  async function send<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const { body, query, auth = true } = options;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response: Response;
    try {
      response = await fetch(buildUrl(path, query), {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'INTERNAL', 'Could not reach CareLayer. Check your connection.');
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
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
    },

    me: {
      get: () => authed<User>('GET', 'me'),
      update: (body) => authed<User>('PATCH', 'me', { body }),
      getSettings: () => authed<UserSettings>('GET', 'me/settings'),
      updateSettings: (body) => authed<UserSettings>('PATCH', 'me/settings', { body }),
    },

    wallet: {
      get: () => authed<WalletResponse>('GET', 'wallet'),
      listTransactions: (query) =>
        authed<Page<WalletTransaction>>('GET', 'wallet/transactions', { query }),
    },

    chat: {
      createConversation: () => authed<Conversation>('POST', 'chat/conversations'),
      listConversations: (query) =>
        authed<Page<Conversation>>('GET', 'chat/conversations', { query }),
      getConversation: (conversationId) =>
        authed<Conversation>('GET', `chat/conversations/${id(conversationId)}`),
      sendMessage: (conversationId, body) =>
        authed<SendMessageResponse>('POST', `chat/conversations/${id(conversationId)}/messages`, {
          body,
        }),
    },

    questions: {
      create: (body) => authed<CreateQuestionResponse>('POST', 'questions', { body }),
      getStatus: (questionId) =>
        authed<QuestionStatusResponse>('GET', `questions/${id(questionId)}/status`),
      listMine: (query) => authed<Page<MyQuestion>>('GET', 'me/questions', { query }),
      getMine: (questionId) => authed<MyQuestion>('GET', `me/questions/${id(questionId)}`),
      collectAnswer: (questionId) =>
        authed<AnswerResponse>('POST', `me/questions/${id(questionId)}/collect`),
    },

    emergency: {
      get: () => send<EmergencyResponse>('GET', 'emergency', { auth: false }),
    },
  };
}
