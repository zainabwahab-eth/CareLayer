import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApi } from './http-api';

/*
 * The women's app HTTP client against the real apps/api routes (H10).
 * Paths and methods here are the ones apps/api serves (each module router.ts in apps/api/src/modules).
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string, message = 'x') =>
  json(status, { error: { code, message } });
const tokens = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2026-01-01T00:00:00Z',
  user: { id: 'u1', role: 'woman', displayName: 'Tolu', email: 't@e.co', createdAt: '' },
};

type FetchMock = ReturnType<typeof vi.fn>;
const stubFetch = (...responses: Array<Response | Error>) => {
  const fetchMock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const call = (fetchMock: FetchMock, n: number) => {
  const [url, init] = fetchMock.mock.calls[n]! as [string, RequestInit];
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    credentials: init.credentials,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('HTTP API: chat (contract §7, stateless)', () => {
  it('POST /chat sends the whole thread with the bearer token', async () => {
    const reply = {
      kind: 'reply',
      message: { id: 'm1', role: 'assistant', text: 'Hi', createdAt: '' },
      escalationOffer: null,
    };
    const fetchMock = stubFetch(json(200, tokens), json(200, reply));
    const api = createHttpApi('http://api.test');
    await api.auth.refresh();

    const messages = [
      { role: 'user' as const, text: 'first' },
      { role: 'assistant' as const, text: 'answer' },
      { role: 'user' as const, text: 'second' },
    ];
    await expect(api.chat.send({ messages })).resolves.toEqual(reply);

    const sent = call(fetchMock, 1);
    expect(sent.url).toBe('http://api.test/chat');
    expect(sent.method).toBe('POST');
    expect(sent.headers.Authorization).toBe('Bearer access-1');
    expect(sent.headers['Content-Type']).toBe('application/json');
    expect(sent.credentials).toBe('include');
    expect(sent.body).toEqual({ messages });
  });

  it('POST /chat/draft returns the draft and its token', async () => {
    const draft = { kind: 'draft', draft: { originalText: 'q' }, draftToken: 't', offer: {} };
    const fetchMock = stubFetch(json(200, draft));
    const api = createHttpApi('http://api.test');
    await expect(
      api.chat.draft({ messages: [{ role: 'user', text: 'q' }] }),
    ).resolves.toMatchObject({ kind: 'draft', draftToken: 't' });
    expect(call(fetchMock, 0)).toMatchObject({ url: 'http://api.test/chat/draft', method: 'POST' });
  });
});

describe('HTTP API: endpoints match apps/api', () => {
  it.each([
    [
      'me.getSettings',
      (a: ReturnType<typeof createHttpApi>) => a.me.getSettings(),
      'GET',
      '/me/settings',
    ],
    [
      'me.updateSettings',
      (a: ReturnType<typeof createHttpApi>) => a.me.updateSettings({ appearance: 'dark' }),
      'PATCH',
      '/me/settings',
    ],
    [
      'me.getNotifications',
      (a: ReturnType<typeof createHttpApi>) => a.me.getNotifications(),
      'GET',
      '/me/notifications',
    ],
    [
      'me.updateNotifications',
      (a: ReturnType<typeof createHttpApi>) =>
        a.me.updateNotifications({ notifyWhenAnswered: true }),
      'PATCH',
      '/me/notifications',
    ],
    [
      'me.update',
      (a: ReturnType<typeof createHttpApi>) => a.me.update({ displayName: 'T' }),
      'PATCH',
      '/me',
    ],
    ['wallet.get', (a: ReturnType<typeof createHttpApi>) => a.wallet.get(), 'GET', '/wallet'],
    [
      'wallet.listTransactions',
      (a: ReturnType<typeof createHttpApi>) => a.wallet.listTransactions({ cursor: 'c1' }),
      'GET',
      '/wallet/transactions?cursor=c1',
    ],
    [
      'topups.create',
      (a: ReturnType<typeof createHttpApi>) => a.topups.create({ amountKobo: 100_000 }),
      'POST',
      '/topups',
    ],
    [
      'topups.get',
      (a: ReturnType<typeof createHttpApi>) => a.topups.get('tp 1'),
      'GET',
      '/topups/tp%201',
    ],
    [
      'questions.listMine',
      (a: ReturnType<typeof createHttpApi>) =>
        a.questions.listMine({ status: 'answered', limit: 100 }),
      'GET',
      '/me/questions?status=answered&limit=100',
    ],
    [
      'questions.getMine',
      (a: ReturnType<typeof createHttpApi>) => a.questions.getMine('q1'),
      'GET',
      '/me/questions/q1',
    ],
    [
      'questions.getStatus',
      (a: ReturnType<typeof createHttpApi>) => a.questions.getStatus('q1'),
      'GET',
      '/questions/q1/status',
    ],
    [
      'questions.collectAnswer',
      (a: ReturnType<typeof createHttpApi>) => a.questions.collectAnswer('q1'),
      'POST',
      '/me/questions/q1/collect',
    ],
    [
      'questions.submitFeedback',
      (a: ReturnType<typeof createHttpApi>) => a.questions.submitFeedback('q1', { helpful: true }),
      'POST',
      '/questions/q1/feedback',
    ],
    [
      'nurses.list',
      (a: ReturnType<typeof createHttpApi>) => a.nurses.list({ femaleOnly: true }),
      'GET',
      '/nurses?femaleOnly=true',
    ],
  ])('%s -> %s %s', async (_name, run, method, path) => {
    const fetchMock = stubFetch(json(200, {}));
    await run(createHttpApi('http://api.test'));
    expect(call(fetchMock, 0)).toMatchObject({ method, url: `http://api.test${path}` });
  });

  it('GET /emergency is public: no token, no refresh on failure', async () => {
    const fetchMock = stubFetch(json(200, tokens), apiError(401, 'UNAUTHENTICATED'));
    const api = createHttpApi('http://api.test');
    await api.auth.refresh();
    await expect(api.emergency.get()).rejects.toMatchObject({ status: 401 });
    expect(call(fetchMock, 1).headers.Authorization).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves a relative base URL (the /api same-origin proxy) against the page', async () => {
    const fetchMock = stubFetch(json(200, {}));
    await createHttpApi('/api').wallet.get();
    expect(call(fetchMock, 0).url).toBe(`${window.location.origin}/api/wallet`);
  });
});

describe('HTTP API: session handling', () => {
  it('refreshes once on 401 UNAUTHENTICATED, then retries with the new token', async () => {
    const fetchMock = stubFetch(
      apiError(401, 'UNAUTHENTICATED'),
      json(200, tokens),
      json(200, { id: 'u1' }),
    );
    const api = createHttpApi('http://api.test');
    await expect(api.me.get()).resolves.toEqual({ id: 'u1' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://api.test/me',
      'http://api.test/auth/refresh',
      'http://api.test/me',
    ]);
    expect(call(fetchMock, 2).headers.Authorization).toBe('Bearer access-1');
  });

  it('collapses concurrent refreshes into one request (the cookie rotates)', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh') ? json(200, tokens) : json(200, {}),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpApi('http://api.test');
    await Promise.all([api.auth.refresh(), api.auth.refresh(), api.auth.refresh()]);
    expect(fetchMock.mock.calls.filter(([u]) => u.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('rejects with the session error when the refresh fails, and drops the token', async () => {
    const fetchMock = stubFetch(
      json(200, tokens),
      apiError(401, 'UNAUTHENTICATED'),
      apiError(401, 'REFRESH_INVALID'),
      json(200, {}),
    );
    const api = createHttpApi('http://api.test');
    await api.auth.refresh();
    await expect(api.wallet.get()).rejects.toMatchObject({ code: 'REFRESH_INVALID' });
    // The next call goes out with no stale token.
    await api.emergency.get();
    expect(call(fetchMock, 3).headers.Authorization).toBeUndefined();
  });

  it('does not refresh on other errors (no duplicate requests)', async () => {
    const fetchMock = stubFetch(apiError(403, 'FORBIDDEN'));
    const api = createHttpApi('http://api.test');
    await expect(api.wallet.get()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logout forgets the token even if the request fails', async () => {
    const fetchMock = stubFetch(json(200, tokens), new TypeError('offline'), json(200, {}));
    const api = createHttpApi('http://api.test');
    await api.auth.refresh();
    await expect(api.auth.logout()).rejects.toMatchObject({ status: 0 });
    await api.emergency.get();
    expect(call(fetchMock, 1)).toMatchObject({
      url: 'http://api.test/auth/logout',
      method: 'POST',
    });
    expect(call(fetchMock, 2).headers.Authorization).toBeUndefined();
  });

  it('verifyCode keeps the access token in memory for later calls', async () => {
    const fetchMock = stubFetch(json(200, tokens), json(200, {}));
    const api = createHttpApi('http://api.test');
    await api.auth.verifyCode({ email: 't@e.co', code: '123456', app: 'women', purpose: 'login' });
    await api.wallet.get();
    expect(call(fetchMock, 0).headers.Authorization).toBeUndefined();
    expect(call(fetchMock, 1).headers.Authorization).toBe('Bearer access-1');
  });
});

describe('HTTP API: failures never fall back to mock data', () => {
  it('turns contract errors into ApiError with code and details', async () => {
    stubFetch(
      json(409, {
        error: {
          code: 'SPENDING_LIMIT_EXCEEDED',
          message: 'Over',
          details: { priceKobo: 50_000, spendingLimitKobo: 20_000 },
        },
      }),
    );
    await expect(
      createHttpApi('http://api.test').questions.collectAnswer('q1'),
    ).rejects.toMatchObject({
      status: 409,
      code: 'SPENDING_LIMIT_EXCEEDED',
      details: { priceKobo: 50_000, spendingLimitKobo: 20_000 },
    });
  });

  it('reports no connection as status 0', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(createHttpApi('http://api.test').wallet.get()).rejects.toMatchObject({
      status: 0,
      message: 'Could not reach CareLayer. Check your connection.',
    });
  });

  it('a non-JSON error (proxy, crash) becomes a generic ApiError', async () => {
    stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(createHttpApi('http://api.test').wallet.get()).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL',
    });
  });

  it('a 200 that is not JSON (wrong VITE_API_URL, captive portal) is an error, not data', async () => {
    stubFetch(new Response('<!doctype html><html></html>', { status: 200 }));
    await expect(createHttpApi('http://api.test').wallet.get()).rejects.toMatchObject({
      status: 200,
      code: 'INTERNAL',
    });
  });

  it('gives up after the timeout with status 0', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = createHttpApi('http://api.test', { timeoutMs: 1_000 }).chat.send({
      messages: [{ role: 'user', text: 'hi' }],
    });
    const assertion = expect(pending).rejects.toMatchObject({
      status: 0,
      message: 'CareLayer is taking too long to answer. Please try again.',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
