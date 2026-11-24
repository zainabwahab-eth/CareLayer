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
import { paths } from '../../routes/paths';
import { ClaudeConnections } from './account/ClaudeConnections';
import { ChooseAnswererPage } from './ChooseAnswererPage';
import { ConfirmPayPage } from './ConfirmPayPage';
import { ConsentPage } from './ConsentPage';
import { NurseResponsePage } from './NurseResponsePage';
import { WaitingPage } from './WaitingPage';

/*
 * W07-W11 against the mock API (same contract as apps/api): consent, choose,
 * confirm and send, wait, then open (and pay for) the answer.
 */

beforeEach(() => {
  // jsdom has no matchMedia: render the mobile layout.
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

const chat: { current: ChatContextValue | null } = { current: null };
const nav: { current: NavigateFunction | null } = { current: null };

function ChatProbe() {
  return <p>Chat</p>;
}

/**
 * Shares the shell context the app layout gives its screens, and exposes the chat
 * store and navigation to the test (always mounted, so never stale).
 */
function Shell({ refreshWallet }: { refreshWallet: () => void }) {
  const chatValue = useChat();
  const navigate = useNavigate();
  const { state } = useAuth();
  useEffect(() => {
    chat.current = chatValue;
    nav.current = navigate;
  });
  return (
    <>
      <p>{state.status}</p>
      <Outlet context={{ refreshWallet }} />
    </>
  );
}

function renderApp(api: CareLayerApi, initialPath: string) {
  const refreshWallet = vi.fn();
  render(
    <ApiProvider api={api}>
      <AuthProvider>
        <ChatProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route element={<Shell refreshWallet={refreshWallet} />}>
                <Route path={paths.ask} element={<ChatProbe />} />
                <Route path={paths.askConsent} element={<ConsentPage />} />
                <Route path={paths.askChoose} element={<ChooseAnswererPage />} />
                <Route path={paths.askConfirm} element={<ConfirmPayPage />} />
                <Route path={paths.consultationWaiting} element={<WaitingPage />} />
                <Route path={paths.consultation} element={<NurseResponsePage />} />
                <Route path={paths.account} element={<ClaudeConnections />} />
                <Route path={paths.emergency} element={<p>Emergency screen</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ChatProvider>
      </AuthProvider>
    </ApiProvider>,
  );
  return { refreshWallet };
}

describe('Send to a nurse (W07-W10)', () => {
  it('sends the reviewed draft with consent and lands on Waiting', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    const create = vi.spyOn(api.questions, 'create');
    renderApp(api, paths.ask);
    await screen.findByText('authenticated');
    await act(() => chat.current!.send('My period is two weeks late. Could I be pregnant?'));

    act(() => nav.current!(paths.askConsent));
    expect(await screen.findByText(/exactly what the nurse will see/i)).toBeTruthy();
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I agree to share this/));
    fireEvent.click(continueButton);

    expect(await screen.findByText('Who should answer?')).toBeTruthy();
    expect((screen.getByLabelText(/First available/) as HTMLInputElement).checked).toBe(true);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Confirm and send' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));

    expect(await screen.findByText(/Waiting for a verified nurse/)).toBeTruthy();
    const body = create.mock.calls[0]![0];
    expect(body).toMatchObject({
      source: 'web',
      nurseSelection: 'first_available',
      femaleOnly: false,
      consent: { consentVersion: 'w07-v1' },
    });
    expect(body.draftToken).toBeTruthy();
    expect(body.consent.sharedFields).toEqual(expect.arrayContaining(['cleaned_text', 'category']));
    // The draft is used up: the flow cannot send it twice.
    expect(chat.current!.request).toBeNull();
  });

  it('sends her back to the chat when there is no question yet', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    renderApp(api, paths.askConsent);
    expect(await screen.findByText('Chat')).toBeTruthy();
  });

  it('opens the confirm step only after consent', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    renderApp(api, paths.ask);
    await screen.findByText('authenticated');
    await act(() => chat.current!.send('Is spotting normal on the pill?'));
    act(() => nav.current!(paths.askConfirm));
    expect(await screen.findByText(/exactly what the nurse will see/i)).toBeTruthy();
  });
});

describe('Nurse response (W11)', () => {
  it('collects the answer, shows it and saves her rating', async () => {
    const api = createMockApi({
      latencyMs: 0,
      startSignedIn: true,
      claimAfterMs: 0,
      answerAfterMs: 0,
    });
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
    const collect = vi.spyOn(api.questions, 'collectAnswer');

    const { refreshWallet } = renderApp(api, `/consultations/${created.id}`);
    expect(await screen.findByText('Licence verified')).toBeTruthy();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(refreshWallet).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText(/Your rating helps/)).toBeTruthy();
    expect((await api.questions.getMine(created.id)).feedback).toEqual({ helpful: true });
  });

  it('asks her to approve an answer above her limit, then pays', async () => {
    const api = createMockApi({
      latencyMs: 0,
      startSignedIn: true,
      claimAfterMs: 0,
      answerAfterMs: 0,
    });
    await api.me.updateSettings({ spendingLimitPerAnswerKobo: 0 });
    const draft = await api.chat.draft({
      messages: [{ role: 'user', text: 'Can I take ibuprofen for period pain?' }],
    });
    if (draft.kind !== 'draft') throw new Error('expected a draft');
    const ask = () =>
      api.questions.create({
        originalText: draft.draft.originalText,
        source: 'web',
        consent: { sharedFields: ['cleaned_text', 'category'], consentVersion: 'w07-v1' },
        approvedAboveLimit: true,
        draftToken: draft.draftToken,
      });
    // Free answers never need approval: use them up so this one is paid.
    let created = await ask();
    for (let i = 0; i < 5 && created.kind === 'question' && created.isFree; i += 1) {
      await api.questions.collectAnswer(created.id);
      created = await ask();
    }
    if (created.kind !== 'question') throw new Error('expected a question');
    expect(created.isFree).toBe(false);

    renderApp(api, `/consultations/${created.id}`);
    fireEvent.click(await screen.findByRole('button', { name: /Pay ₦500 and open it/ }));
    expect(await screen.findByText('Licence verified')).toBeTruthy();
    expect(screen.getByText(/View receipt on Stellar/)).toBeTruthy();
  });
});

describe('Use CareLayer in Claude (Account connections)', () => {
  it('creates a connection, shows the token once and removes it', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    renderApp(api, paths.account);

    fireEvent.change(await screen.findByLabelText('Name this connection'), {
      target: { value: 'Claude on my laptop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText(/is ready/)).toBeTruthy();
    expect(screen.getByText(/^clat_/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved it' }));
    await waitFor(() => expect(screen.queryByText(/^clat_/)).toBeNull());

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Claude on my laptop' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Claude on my laptop' })).toBeNull(),
    );
    expect(await api.agentTokens.list()).toEqual([]);
  });
});
