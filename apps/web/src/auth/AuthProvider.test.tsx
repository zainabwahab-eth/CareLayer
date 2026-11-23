import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthTokensResponse } from '@carelayer/shared';
import { ApiProvider } from '../api/ApiProvider';
import { ApiError } from '../api/errors';
import type { CareLayerApi } from '../api/types';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

const tokens = {
  accessToken: 'token',
  user: { id: 'u1', role: 'woman', displayName: 'Amina' },
} as unknown as AuthTokensResponse;
const offline = () => new ApiError(0, 'INTERNAL', 'Could not reach CareLayer.');

function fakeApi(refresh: () => Promise<AuthTokensResponse>) {
  return {
    mode: 'mock',
    auth: { refresh: vi.fn(refresh), logout: vi.fn(async () => {}) },
  } as unknown as CareLayerApi & {
    auth: { refresh: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
  };
}

function Probe() {
  const { state, logout } = useAuth();
  return (
    <>
      <p>
        {state.status}:{state.reason}
      </p>
      <button type="button" onClick={() => void logout()}>
        Log out
      </button>
    </>
  );
}

const renderWith = (api: CareLayerApi) =>
  render(
    <ApiProvider api={api}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </ApiProvider>,
  );

const goOnline = () =>
  act(async () => {
    window.dispatchEvent(new Event('online'));
  });

describe('AuthProvider: opened offline', () => {
  it('restores the session when the connection comes back', async () => {
    const api = fakeApi(vi.fn().mockRejectedValueOnce(offline()).mockResolvedValue(tokens));
    renderWith(api);
    await screen.findByText('unauthenticated:none');

    await goOnline();
    await screen.findByText('authenticated:none');
    expect(api.auth.refresh).toHaveBeenCalledTimes(2);

    // Done: further connection changes do not refresh again.
    await goOnline();
    expect(api.auth.refresh).toHaveBeenCalledTimes(2);
  });

  it('does not retry when there is simply no session', async () => {
    const api = fakeApi(async () => {
      throw new ApiError(401, 'UNAUTHENTICATED', 'No session.');
    });
    renderWith(api);
    await screen.findByText('unauthenticated:none');
    await goOnline();
    expect(api.auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('never signs her back in after she chose Log out while offline', async () => {
    const api = fakeApi(vi.fn().mockRejectedValueOnce(offline()).mockResolvedValue(tokens));
    renderWith(api);
    await screen.findByText('unauthenticated:none');

    await act(async () => {
      screen.getByRole('button', { name: 'Log out' }).click();
    });
    await screen.findByText('unauthenticated:logout');

    await goOnline();
    await waitFor(() => expect(api.auth.refresh).toHaveBeenCalledTimes(2));
    expect(screen.getByText('unauthenticated:logout')).toBeTruthy();
  });
});
