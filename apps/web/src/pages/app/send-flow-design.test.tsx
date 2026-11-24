import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useNavigate,
  type NavigateFunction,
} from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiProvider';
import { createMockApi } from '../../api/mock/mock-api';
import type { CareLayerApi } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { useAuth } from '../../auth/useAuth';
import { ChatProvider } from '../../chat/ChatProvider';
import type { ChatContextValue } from '../../chat/chat-context';
import { useChat } from '../../chat/useChat';
import { consultationWaitingPath, paths } from '../../routes/paths';
import { ChooseAnswererPage } from './ChooseAnswererPage';
import { ConfirmPayPage } from './ConfirmPayPage';
import { ConsentPage } from './ConsentPage';
import { WaitingPage } from './WaitingPage';

/* W08-W10 laid out as in Figma (desktop and mobile), against the mock API. */

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
});

const chat: { current: ChatContextValue | null } = { current: null };
const nav: { current: NavigateFunction | null } = { current: null };

function Shell() {
  const value = useChat();
  const navigate = useNavigate();
  const { state } = useAuth();
  useEffect(() => {
    chat.current = value;
    nav.current = navigate;
  });
  return (
    <>
      <p hidden>{state.status}</p>
      <Outlet context={{ refreshWallet: () => {} }} />
    </>
  );
}

async function renderAt(api: CareLayerApi, path: string) {
  render(
    <ApiProvider api={api}>
      <AuthProvider>
        <ChatProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<Shell />}>
                <Route path={paths.ask} element={<p>Chat</p>} />
                <Route path={paths.askConsent} element={<ConsentPage />} />
                <Route path={paths.askChoose} element={<ChooseAnswererPage />} />
                <Route path={paths.askConfirm} element={<ConfirmPayPage />} />
                <Route path={paths.consultationWaiting} element={<WaitingPage />} />
                <Route path={paths.emergency} element={<p>Emergency screen</p>} />
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

/** Chat, consent, then on to W08. */
async function toChoose(api: CareLayerApi) {
  await renderAt(api, paths.ask);
  await act(() => chat.current!.send('Which contraceptive would be best for me?'));
  act(() => nav.current!(paths.askConsent));
  await screen.findByText(/exactly what the nurse will see/i, {}, { timeout: 5000 });
  fireEvent.click(screen.getByLabelText(/I agree to share this/));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Who should answer?' }, { timeout: 5000 });
}

describe('W08 Who should answer?', () => {
  it('desktop: stepper, the female-only toggle by the title, nurse cards, footer note', async () => {
    desktop = true;
    await toChoose(mockApi());
    expect(screen.getByRole('list', { name: 'Progress' })).toBeTruthy();
    expect(await screen.findByText('Licence verified')).toBeTruthy();
    expect(screen.getByText(/goes to the first available/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByText('Answer price')).toBeTruthy();
  });

  it('mobile: rows with a Verified badge; the toggle above Continue', async () => {
    desktop = false;
    await toChoose(mockApi());
    expect(await screen.findByText('Verified')).toBeTruthy();
    expect(screen.queryByText(/goes to the first available/)).toBeNull();
    expect(screen.getByRole('switch', { name: 'Only female health workers' })).toBeTruthy();
  });
});

describe('W09 Confirm and send', () => {
  it('desktop: summary with her question, and the pay panel with the buttons', async () => {
    desktop = true;
    await toChoose(mockApi());
    await waitFor(
      () =>
        expect(
          (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled,
        ).toBe(false),
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('complementary', { name: 'Send' })).toBeTruthy();
    expect(screen.getByText('Your question')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Nothing is charged/ })).toBeTruthy();
  });
});

describe('W10 Waiting', () => {
  async function sentQuestion(api: ReturnType<typeof createMockApi>) {
    const draft = await api.chat.draft({
      messages: [{ role: 'user', text: 'Is spotting normal on the pill?' }],
    });
    if (draft.kind !== 'draft') throw new Error('expected a draft');
    const created = await api.questions.create({
      originalText: draft.draft.originalText,
      source: 'web',
      consent: { sharedFields: ['cleaned_text', 'category'], consentVersion: 'w07-v1' },
      draftToken: draft.draftToken,
    });
    if (created.kind !== 'question') throw new Error('expected a question');
    return created.id;
  }

  it('desktop: headline, In review badge, timeline, and Notify me when answered saves', async () => {
    desktop = true;
    const api = mockApi();
    const update = vi.spyOn(api.me, 'updateNotifications');
    const id = await sentQuestion(api);
    await renderAt(api, consultationWaitingPath(id));

    expect(
      await screen.findByRole('heading', { name: 'Waiting for a verified nurse' }),
    ).toBeTruthy();
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getByText('Sent anonymously')).toBeTruthy();
    const notify = screen.getByRole('switch', { name: 'Notify me when answered' });
    // Her saved preference (on in the mock).
    await waitFor(() => expect(notify.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(notify);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifyWhenAnswered: false }));
    expect(notify.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByRole('link', { name: /Feeling worse while you wait/ }).getAttribute('href'),
    ).toBe(paths.emergency);
  });

  it('mobile: "Consultation" bar, badge and headline in the page, no notify card', async () => {
    desktop = false;
    const api = mockApi();
    const id = await sentQuestion(api);
    await renderAt(api, consultationWaitingPath(id));
    expect(await screen.findByRole('heading', { name: 'Consultation' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Waiting for a verified nurse' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Notify me when answered' })).toBeNull();
  });
});
