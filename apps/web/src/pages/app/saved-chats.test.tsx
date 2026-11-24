import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { NEW_CHAT_STATE } from '../../chat/ask-route-state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiProvider';
import { createMockApi } from '../../api/mock/mock-api';
import type { CareLayerApi } from '../../api/types';
import { AuthProvider } from '../../auth/AuthProvider';
import { useAuth } from '../../auth/useAuth';
import { ChatProvider } from '../../chat/ChatProvider';
import { chatPath, paths } from '../../routes/paths';
import { AskPage } from './AskPage';
import { HistoryPage } from './HistoryPage';

/*
 * Saved chats against the mock API (same contract as apps/api): a sent chat is
 * saved and put in the URL, a reload (fresh app) reopens it, History lists and
 * deletes it.
 */

beforeEach(() => {
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
  // jsdom has no layout: AskPage scrolls the newest message into view.
  Element.prototype.scrollIntoView = vi.fn();
});

const location: { current: string } = { current: '' };
function LocationProbe() {
  const { pathname, search } = useLocation();
  const { state } = useAuth();
  useEffect(() => {
    location.current = `${pathname}${search}`;
  });
  return <p hidden>{state.status}</p>;
}

/**
 * One app instance. Rendering again with the same api = a reload (memory is fresh).
 * Resolves once signed in: the chat store (and this test router) remounts when she is.
 */
async function renderApp(api: CareLayerApi, path: string) {
  const view = render(
    <ApiProvider api={api}>
      <AuthProvider>
        <ChatProvider>
          <MemoryRouter initialEntries={[path]}>
            <LocationProbe />
            <Link to={paths.ask} state={NEW_CHAT_STATE}>
              Sidebar ask
            </Link>
            <Link to={paths.ask}>Ask tab</Link>
            <Routes>
              <Route path={paths.ask} element={<AskPage />} />
              <Route path={paths.history} element={<HistoryPage />} />
              <Route path={paths.emergency} element={<p>Emergency screen</p>} />
              <Route path={paths.askConsent} element={<p>Consent</p>} />
            </Routes>
          </MemoryRouter>
        </ChatProvider>
      </AuthProvider>
    </ApiProvider>,
  );
  await screen.findByText('authenticated', { ignore: false });
  return view;
}

async function sendMessage(text: string) {
  const field = await screen.findByRole('textbox');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
}

describe('Saved chats', () => {
  it('saves the chat, puts it in the URL, and reopens it after a reload', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });
    const first = await renderApp(api, paths.ask);
    await sendMessage('Is spotting normal on the pill?');
    await waitFor(() => expect(location.current).toMatch(/^\/ask\?c=/));
    const url = location.current;
    const [saved] = (await api.chat.listConversations()).items;
    const assistantReply = (await api.chat.getConversation(saved!.id)).messages[1]!.text;

    first.unmount();
    await renderApp(api, url);
    expect(await screen.findByText('Is spotting normal on the pill?')).toBeTruthy();
    expect(screen.getByText(assistantReply)).toBeTruthy();

    // The next message goes to the same saved chat.
    await sendMessage('And if it lasts a week?');
    await waitFor(async () =>
      expect((await api.chat.listConversations()).items[0]!.messageCount).toBe(4),
    );
    expect((await api.chat.listConversations()).items).toHaveLength(1);
  });

  it('starts a blank chat with New chat', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });
    await renderApp(api, paths.ask);
    await sendMessage('Is spotting normal on the pill?');
    // The mobile top bar and the desktop header each have one (CSS shows one).
    fireEvent.click((await screen.findAllByRole('button', { name: 'New chat' }))[0]!);
    await waitFor(() => expect(location.current).toBe(paths.ask));
    expect(screen.queryByText('Is spotting normal on the pill?')).toBeNull();
  });

  it('says so when a saved chat cannot be found', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });
    await renderApp(api, chatPath('missing'));
    expect(await screen.findByText(/deleted or is not yours/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    await waitFor(() => expect(location.current).toBe(paths.ask));
  });
});

describe('History (saved chats)', () => {
  it('lists saved chats, opens one and deletes one', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });
    const sent = await api.chat.send({ messages: [{ role: 'user', text: 'Period pain help' }] });
    await renderApp(api, paths.history);

    const link = await screen.findByRole('link', { name: /Period pain help/ });
    expect(link.getAttribute('href')).toBe(chatPath(sent.conversationId!));

    // No message count on the card; Delete lives in the "⋯" menu, then asks to confirm.
    expect(screen.queryByText(/messages?$/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More options for: Period pain help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete chat' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(await screen.findByText('No chats yet')).toBeTruthy();
    expect((await api.chat.listConversations()).items).toEqual([]);
  });

  it('closes the menu with Escape and Cancel keeps the chat', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });
    await api.chat.send({ messages: [{ role: 'user', text: 'Keep me' }] });
    await renderApp(api, paths.history);
    const more = await screen.findByRole('button', { name: 'More options for: Keep me' });
    fireEvent.click(more);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('link', { name: /Keep me/ })).toBeTruthy();
    expect((await api.chat.listConversations()).items).toHaveLength(1);
  });
});

describe('"Ask a question" starts a new chat', () => {
  it('leaves the open chat for a blank one; the Ask tab keeps it', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });
    const sent = await api.chat.send({ messages: [{ role: 'user', text: 'Old question' }] });
    await renderApp(api, chatPath(sent.conversationId!));
    expect(await screen.findByText('Old question')).toBeTruthy();

    // The Ask tab (no state) stays in the chat.
    fireEvent.click(screen.getByRole('link', { name: 'Ask tab' }));
    await waitFor(() => expect(location.current).toBe(chatPath(sent.conversationId!)));
    expect(screen.getByText('Old question')).toBeTruthy();

    // "Ask a question" (new-chat state) opens a blank chat and keeps it blank.
    fireEvent.click(screen.getByRole('link', { name: 'Sidebar ask' }));
    await waitFor(() => expect(location.current).toBe(paths.ask));
    await waitFor(() => expect(screen.queryByText('Old question')).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(location.current).toBe(paths.ask);
    expect(screen.queryByText('Old question')).toBeNull();
  });
});

describe('Questions sent from a chat', () => {
  async function sendFromChat(api: ReturnType<typeof createMockApi>) {
    const sent = await api.chat.send({
      messages: [{ role: 'user', text: 'Which contraceptive is best for me?' }],
    });
    const draft = await api.chat.draft({
      messages: [{ role: 'user', text: 'Which contraceptive is best for me?' }],
    });
    if (draft.kind !== 'draft') throw new Error('expected a draft');
    const created = await api.questions.create({
      originalText: draft.draft.originalText,
      source: 'web',
      consent: { sharedFields: ['cleaned_text', 'category'], consentVersion: 'w07-v1' },
      draftToken: draft.draftToken,
      conversationId: sent.conversationId!,
    });
    if (created.kind !== 'question') throw new Error('expected a question');
    return { conversationId: sent.conversationId!, questionId: created.id };
  }

  it('shows the question in its chat with its status', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true, seedChats: false });
    const { conversationId } = await sendFromChat(api);
    await renderApp(api, chatPath(conversationId));
    expect(await screen.findByText('Sent to a nurse')).toBeTruthy();
    expect(await screen.findByText('In review')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See its status' })).toBeTruthy();
  });

  it('shows the nurse’s answer in the chat once she has opened it', async () => {
    const api = createMockApi({
      latencyMs: 0,
      startSignedIn: true,
      seedChats: false,
      claimAfterMs: 0,
      answerAfterMs: 0,
    });
    const { conversationId, questionId } = await sendFromChat(api);
    const opened = await api.questions.collectAnswer(questionId);
    await renderApp(api, chatPath(conversationId));
    expect(await screen.findByText('Answered')).toBeTruthy();
    expect(await screen.findByText(opened.answer.text.slice(0, 40), { exact: false })).toBeTruthy();
  });
});
