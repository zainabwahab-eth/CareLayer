import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpNurseApi } from './http-api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = {
  accessToken: 'access-1',
  accessTokenExpiresAt: '2026-01-01T00:00:00Z',
  user: { id: 'n1', role: 'nurse', displayName: 'A', email: 'a@b.co', createdAt: '' },
};

afterEach(() => vi.unstubAllGlobals());

describe('HTTP nurse API', () => {
  it('uploads multipart with type then file, the bearer token, and no JSON content type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, tokens))
      .mockResolvedValueOnce(json(201, { id: 'd1', type: 'government_id' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpNurseApi('http://api.test');
    await api.auth.refresh();

    const file = new File(['%PDF-1.7'], 'id.pdf', { type: 'application/pdf' });
    await api.nurse.uploadDocument('government_id', file);

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe('http://api.test/nurse/documents');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers.Authorization).toBe('Bearer access-1');
    expect(init.headers['Content-Type']).toBeUndefined();
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(['type', 'file']);
    expect(form.get('type')).toBe('government_id');
    expect((form.get('file') as File).name).toBe('id.pdf');
  });

  it('refreshes once on 401 UNAUTHENTICATED and retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, tokens))
      .mockResolvedValueOnce(json(200, { userId: 'n1' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpNurseApi('http://api.test');
    await expect(api.nurse.getProfile()).resolves.toEqual({ userId: 'n1' });
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      'http://api.test/nurse/profile',
      'http://api.test/auth/refresh',
      'http://api.test/nurse/profile',
    ]);
  });

  it('turns contract errors into ApiError, and a proxy 413 into the size message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(409, {
          error: {
            code: 'ONBOARDING_INCOMPLETE',
            message: 'Finish',
            details: { missing: ['role'] },
          },
        }),
      )
      .mockResolvedValueOnce(new Response('<html>Too large</html>', { status: 413 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpNurseApi('http://api.test');
    await expect(api.nurse.submit()).rejects.toMatchObject({
      status: 409,
      code: 'ONBOARDING_INCOMPLETE',
      details: { missing: ['role'] },
    });
    await expect(
      api.nurse.uploadDocument('selfie_with_id', new File(['x'], 'a.jpg')),
    ).rejects.toMatchObject({ status: 413, message: 'Files can be up to 10 MB.' });
  });

  it('reports no connection as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(createHttpNurseApi('http://api.test').nurse.getProfile()).rejects.toMatchObject({
      status: 0,
    });
  });

  it('treats a 200 that is not JSON (wrong VITE_API_URL, captive portal) as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<!doctype html><html></html>', { status: 200 })),
    );
    await expect(createHttpNurseApi('http://api.test').nurse.getProfile()).rejects.toMatchObject({
      status: 200,
      code: 'INTERNAL',
    });
  });

  it('uses a relative base URL (the /api same-origin proxy) as is', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { userId: 'n1' }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpNurseApi('/api').nurse.getProfile();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/nurse/profile');
  });
});
