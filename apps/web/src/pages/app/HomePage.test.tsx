import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiProvider';
import { createMockApi } from '../../api/mock/mock-api';
import type { CareLayerApi } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { useAuth } from '../../auth/useAuth';
import { ChatProvider } from '../../chat/ChatProvider';
import { paths } from '../../routes/paths';
import { listenForInstallPrompt, resetInstallPromptForTests } from '../../pwa/install-prompt';
import { ANDROID_UA, fakeInstallEvent, setStandalone, setUserAgent } from '../../pwa/test-helpers';
import { AskPage } from './AskPage';
import { HomePage } from './HomePage';

/*
 * W05 Home against the mock API: every link and button goes where it should,
 * on the desktop layout and the mobile one, and the empty state.
 */

let desktop = true;
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: desktop && query.includes('min-width'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  Element.prototype.scrollIntoView = vi.fn();
});

const location: { current: string; state: unknown } = { current: '', state: null };
function Shell() {
  const loc = useLocation();
  const { state } = useAuth();
  useEffect(() => {
    location.current = `${loc.pathname}${loc.search}`;
    location.state = loc.state;
  });
  return (
    <>
      <p hidden>{state.status}</p>
      <Outlet context={{ refreshWallet: () => {} }} />
    </>
  );
}

async function renderHome(api: CareLayerApi) {
  render(
    <ApiProvider api={api}>
      <AuthProvider>
        <ChatProvider>
          <MemoryRouter initialEntries={[paths.home]}>
            <Routes>
              <Route element={<Shell />}>
                <Route path={paths.home} element={<HomePage />} />
                <Route path={paths.ask} element={<AskPage />} />
                <Route path={paths.consultations} element={<p>Consultations page</p>} />
                <Route path={paths.wallet} element={<p>Wallet page</p>} />
                <Route path={paths.consultation} element={<p>Answer page</p>} />
                <Route path={paths.consultationWaiting} element={<p>Waiting page</p>} />
                <Route path={paths.emergency} element={<p>Emergency page</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ChatProvider>
      </AuthProvider>
    </ApiProvider>,
  );
  await screen.findByText('authenticated');
}

const mockApi = () => createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });

describe('W05 Home (desktop)', () => {
  beforeEach(() => {
    desktop = true;
  });

  it('greets her and shows her data from the API', async () => {
    await renderHome(mockApi());
    expect(
      await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Tolu$/ }),
    ).toBeTruthy();
    expect(await screen.findByText('₦3,500')).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByText('Private by default')).toBeTruthy();
    // Seeded: one question in review, three earlier ones.
    expect(await screen.findByRole('link', { name: 'View status' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Recent consultations' })).toBeTruthy();
  });

  it('links every card to the right screen', async () => {
    await renderHome(mockApi());
    const href = async (name: string | RegExp) =>
      (await screen.findByRole('link', { name })).getAttribute('href');
    expect(await href('Top up')).toBe(paths.wallet);
    expect(await href('View all')).toBe(paths.consultations);
    expect(await href(/^Your consultations|^Consultations:/)).toBe(paths.consultations);
    expect(await href('View status')).toMatch(/^\/consultations\/.+\/waiting$/);
    const rows = screen
      .getAllByRole('link')
      .filter((a) => /^\/consultations\/[^/]+$/.test(a.getAttribute('href') ?? ''));
    expect(rows.length).toBe(3);
  });

  it('sends her question to the assistant in a new chat', async () => {
    const api = mockApi();
    const send = vi.spyOn(api.chat, 'send');
    await renderHome(api);
    fireEvent.change(await screen.findByLabelText('Your question'), {
      target: { value: 'Is spotting normal on the pill?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask the assistant' }));
    await waitFor(() => expect(location.current).toMatch(/^\/ask/));
    expect(send.mock.calls[0]![0].messages).toEqual([
      { role: 'user', text: 'Is spotting normal on the pill?' },
    ]);
    expect(await screen.findByText('Is spotting normal on the pill?')).toBeTruthy();
  });

  it('opens the chat when the field is empty', async () => {
    await renderHome(mockApi());
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the assistant' }));
    await waitFor(() => expect(location.current).toBe(paths.ask));
  });

  it('shows the empty state when she has no consultations', async () => {
    const api = mockApi();
    vi.spyOn(api.questions, 'listMine').mockResolvedValue({ items: [], nextCursor: null });
    await renderHome(api);
    expect(await screen.findByText('No recent consultations')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View status' })).toBeNull();
  });
});

describe('W05 Home (mobile)', () => {
  beforeEach(() => {
    desktop = false;
  });

  it('greets her by name and links the active consultation card', async () => {
    await renderHome(mockApi());
    expect(await screen.findByRole('heading', { name: 'Tolu' })).toBeTruthy();
    const card = await screen.findByRole('link', { name: /Nurse reviewing|Waiting for a nurse/ });
    expect(card.getAttribute('href')).toMatch(/\/waiting$/);
    expect(screen.getByText('Private by default')).toBeTruthy();
  });

  it('opens the chat with a starter from a topic chip', async () => {
    await renderHome(mockApi());
    fireEvent.click(await screen.findByRole('link', { name: 'Pregnancy' }));
    await waitFor(() => expect(location.current).toBe(paths.ask));
    const field = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    expect(field.value).toBe('I have a question about pregnancy: ');
  });

  it('"Others" opens a blank chat', async () => {
    await renderHome(mockApi());
    fireEvent.click(await screen.findByRole('link', { name: 'Others' }));
    const field = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    expect(field.value).toBe('');
  });
});

describe('W05 Home: Add to Home Screen', () => {
  beforeEach(() => {
    resetInstallPromptForTests();
    setStandalone(false);
    setUserAgent(ANDROID_UA);
    listenForInstallPrompt();
  });

  for (const layout of ['desktop', 'mobile'] as const) {
    it(`${layout}: shows under Private by default, and Not now closes it`, async () => {
      desktop = layout === 'desktop';
      await renderHome(mockApi());
      await screen.findByText('Private by default');
      act(() => {
        window.dispatchEvent(fakeInstallEvent('accepted'));
      });
      const banner = await screen.findByRole('heading', {
        name: 'Add CareLayer to your home screen',
      });
      // It comes after the privacy card in the page.
      const privacy = screen.getByText('Private by default');
      expect(
        privacy.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
      await waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: 'Add CareLayer to your home screen' }),
        ).toBeNull(),
      );
    });
  }
});
