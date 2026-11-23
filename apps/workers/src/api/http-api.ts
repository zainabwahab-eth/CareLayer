import type {
  Answer,
  ApiErrorBody,
  AuthTokensResponse,
  Claim,
  EarningsResponse,
  NurseDashboard,
  NurseDocument,
  NurseProfile,
  NurseQuestionView,
  Page,
  PageQuery,
  RequestCodeResponse,
  SessionInfo,
  StepUpResponse,
  UserSettings,
  WalletTransaction,
  Withdrawal,
} from '@carelayer/shared';
import { ApiError } from '@web/api/errors';
import type { NurseApi } from './types';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** `path?key=value`, leaving out empty values. */
function withQuery(path: string, query: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const page = (query?: PageQuery) => ({ cursor: query?.cursor, limit: query?.limit });
const enc = encodeURIComponent;

interface RequestOptions {
  /** JSON body, or FormData for uploads (the browser sets the multipart boundary). */
  body?: unknown;
  /** Send the access token (default true). */
  auth?: boolean;
}

/*
 * Fetch client for apps/api, the same rules as apps/web's client:
 *   - the refresh token is an httpOnly cookie (`credentials: 'include'`);
 *     the access token stays in memory only, never in storage;
 *   - on 401 UNAUTHENTICATED it refreshes once and retries;
 *   - concurrent refreshes collapse into one (the cookie rotates on every refresh).
 */
export function createHttpNurseApi(baseUrl: string): NurseApi {
  let accessToken: string | null = null;
  let refreshing: Promise<AuthTokensResponse> | null = null;

  const remember = (tokens: AuthTokensResponse) => {
    accessToken = tokens.accessToken;
    return tokens;
  };

  async function send<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const { body, auth = true } = options;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'INTERNAL', 'Could not reach CareLayer. Check your connection.');
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      try {
        return (await response.json()) as T;
      } catch {
        // A 2xx that is not JSON is not apps/api: usually VITE_API_URL points at the
        // web server (its index.html) or a captive portal on a phone's Wi-Fi.
        throw new ApiError(
          response.status,
          'INTERNAL',
          'Could not reach CareLayer. Check your connection.',
        );
      }
    }

    let errorBody: ApiErrorBody | null = null;
    try {
      errorBody = (await response.json()) as ApiErrorBody;
    } catch {
      // Not JSON (proxy, crash). Fall through.
    }
    if (errorBody?.error?.code) throw ApiError.fromBody(response.status, errorBody);
    if (response.status === 413) {
      // A proxy in front of the API can refuse a large upload before the API sees it.
      throw new ApiError(413, 'VALIDATION_FAILED', 'Files can be up to 10 MB.', { field: 'file' });
    }
    throw new ApiError(response.status, 'INTERNAL', 'Something went wrong. Please try again.');
  }

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

  return {
    mode: 'http',

    auth: {
      // A step-up code is for the signed-in nurse, so that request carries her token.
      requestCode: (body) =>
        body.purpose === 'step_up'
          ? authed<RequestCodeResponse>('POST', 'auth/code/request', { body })
          : send<RequestCodeResponse>('POST', 'auth/code/request', { body, auth: false }),
      verifyCode: async (body) =>
        remember(await send<AuthTokensResponse>('POST', 'auth/code/verify', { body, auth: false })),
      signInWithGoogle: async (body) =>
        remember(await send<AuthTokensResponse>('POST', 'auth/google', { body, auth: false })),
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
      stepUp: (body) => authed<StepUpResponse>('POST', 'auth/step-up', { body }),
      listSessions: () => authed<SessionInfo[]>('GET', 'auth/sessions'),
      revokeSession: (sessionId) => authed<void>('DELETE', `auth/sessions/${enc(sessionId)}`),
    },

    me: {
      getSettings: () => authed<UserSettings>('GET', 'me/settings'),
      updateSettings: (body) => authed<UserSettings>('PATCH', 'me/settings', { body }),
    },

    nurse: {
      getProfile: () => authed<NurseProfile>('GET', 'nurse/profile'),
      updateProfile: (body) => authed<NurseProfile>('PATCH', 'nurse/profile', { body }),
      updatePreferences: (body) => authed<NurseProfile>('PATCH', 'nurse/preferences', { body }),
      uploadDocument: (type, file) => {
        // `type` before `file`: multer reads fields in order. FormData can be re-sent on the retry.
        const body = new FormData();
        body.append('type', type);
        body.append('file', file, file.name);
        return authed<NurseDocument>('POST', 'nurse/documents', { body });
      },
      removeDocument: (documentId) => authed<void>('DELETE', `nurse/documents/${enc(documentId)}`),
      submit: () => authed<NurseProfile>('POST', 'nurse/profile/submit'),
      setPayoutAddress: (body) => authed<NurseProfile>('PUT', 'nurse/payout-address', { body }),
    },

    cases: {
      dashboard: () => authed<NurseDashboard>('GET', 'nurse/dashboard'),
      list: (tab, query) =>
        authed<Page<NurseQuestionView>>(
          'GET',
          withQuery('nurse/questions', { tab, ...page(query) }),
        ),
      get: (questionId) => authed<NurseQuestionView>('GET', `nurse/questions/${enc(questionId)}`),
      current: () => authed<NurseQuestionView | null>('GET', 'nurse/claim'),
      claim: (questionId) => authed<Claim>('POST', `nurse/questions/${enc(questionId)}/claim`),
      release: (questionId) => authed<void>('POST', `nurse/questions/${enc(questionId)}/release`),
      answer: (questionId, body) =>
        authed<Answer>('POST', `nurse/questions/${enc(questionId)}/answer`, { body }),
    },

    earnings: {
      get: () => authed<EarningsResponse>('GET', 'nurse/earnings'),
      listWithdrawals: (query) =>
        authed<Page<Withdrawal>>('GET', withQuery('nurse/withdrawals', page(query))),
      withdraw: (body) => authed<Withdrawal>('POST', 'nurse/withdrawals', { body }),
      listTransactions: (query) =>
        authed<Page<WalletTransaction>>('GET', withQuery('wallet/transactions', page(query))),
    },
  };
}
