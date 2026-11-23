import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, signIn, testApi } from '../../test/render-app';

const at = (router: ReturnType<typeof renderApp>['router']) => router.state.location.pathname;

describe('routing by verification status', () => {
  it('signed out: the onboarding steps send her to Log in', async () => {
    const { router } = renderApp(testApi(), '/onboarding/documents');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(at(router)).toBe('/log-in');
  });

  it('a new nurse starts at Step 1 (N02)', async () => {
    const api = testApi();
    await signIn(api, 'new@example.com', 'Ngozi Eze');
    const { router } = renderApp(api, '/start');
    await screen.findByRole('heading', { name: 'Your licence' });
    expect(at(router)).toBe('/onboarding/licence');
  });

  it('in review: steps are closed and N04 shows', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    const { router } = renderApp(api, '/onboarding/licence');
    await screen.findByRole('heading', { name: 'We’re checking your licence' });
    expect(at(router)).toBe('/onboarding/review');
  });

  it('approved: Today, never the review screen', async () => {
    const api = testApi();
    await signIn(api, 'amaka@example.com');
    const { router } = renderApp(api, '/onboarding/review');
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), Amaka/ });
    expect(at(router)).toBe('/today');
  });

  it('signed in: Join sends her on', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    const { router } = renderApp(api, '/');
    await waitFor(() => expect(at(router)).toBe('/onboarding/review'));
  });

  it('profile fails to load: says so, with Try again', async () => {
    const api = testApi();
    await signIn(api, 'funmi@example.com');
    let calls = 0;
    const original = api.nurse.getProfile;
    api.nurse.getProfile = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('boom')) : original();
    };
    renderApp(api, '/start');
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('alert').textContent).toMatch(/could not load your profile/);
    retry.click();
    await screen.findByRole('heading', { name: 'We’re checking your licence' });
  });
});
