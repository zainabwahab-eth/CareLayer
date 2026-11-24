import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/ApiProvider';
import { createMockApi } from '../api/mock/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import { readSessionHint } from '../auth/session-hint';
import { ThemeProvider } from '../theme/ThemeProvider';
import { LandingRoute } from './LandingRoute';
import { paths } from './paths';

beforeEach(() => {
  // jsdom has no matchMedia: system theme light, mobile layout.
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});

function renderLanding(startSignedIn: boolean) {
  const api = createMockApi({ latencyMs: 0, startSignedIn });
  render(
    <ApiProvider api={api}>
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[paths.welcome]}>
            <Routes>
              <Route path={paths.welcome} element={<LandingRoute />} />
              <Route path={paths.home} element={<p>Home screen</p>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </ApiProvider>,
  );
}

describe('Landing page (/)', () => {
  it('shows the landing page to a signed-out visitor', async () => {
    renderLanding(false);
    expect(
      await screen.findByRole('heading', { name: 'Ask the question you’ve been holding in.' }),
    ).toBeTruthy();
    expect(readSessionHint()).toBe(false);
  });

  it('sends a signed-in visitor straight to Home', async () => {
    renderLanding(true);
    expect(await screen.findByText('Home screen')).toBeTruthy();
    expect(readSessionHint()).toBe(true);
  });

  it('waits on a loading screen (no landing flash) when this browser was signed in', async () => {
    window.localStorage.setItem('carelayer.session', '1');
    renderLanding(true);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(await screen.findByText('Home screen')).toBeTruthy();
  });

  it('switches between light and dark mode', async () => {
    renderLanding(false);
    const toDark = await screen.findByRole('button', { name: 'Switch to dark mode' });
    fireEvent.click(toDark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    document.documentElement.removeAttribute('data-theme');
  });

  it('links every call to action somewhere real', async () => {
    renderLanding(false);
    await screen.findByRole('heading', { level: 1 });
    const hrefs = (name: string | RegExp) =>
      screen.getAllByRole('link', { name }).map((link) => link.getAttribute('href'));

    expect(hrefs('Ask a question')).toEqual([paths.beforeYouStart, paths.beforeYouStart]);
    expect(hrefs('Log in')).toEqual([paths.logIn]);
    expect(hrefs('How it works')).toEqual(['#how-it-works', '#how-it-works']);
    expect(hrefs('FAQ')).toEqual(['#faq']);
    expect(hrefs('Contact')).toEqual(['mailto:hello@carelayer.health']);
    expect(hrefs(/shows you where to get help/)).toEqual([paths.emergency]);
    expect(hrefs('112')).toEqual(['tel:112']);
    for (const name of ['I’m a nurse or midwife', 'Join as a nurse or midwife']) {
      expect(hrefs(name)[0]).toMatch(/^https?:\/\//);
    }
    // Every in-page link has its section.
    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
  });
});
