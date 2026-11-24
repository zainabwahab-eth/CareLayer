import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
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
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    await renderApp(api, paths.ask);
    await sendMessage('Is spotting normal on the pill?');
    // The mobile top bar and the desktop header each have one (CSS shows one).
    fireEvent.click((await screen.findAllByRole('button', { name: 'New chat' }))[0]!);
    await waitFor(() => expect(location.current).toBe(paths.ask));
    expect(screen.queryByText('Is spotting normal on the pill?')).toBeNull();
  });

  it('says so when a saved chat cannot be found', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    await renderApp(api, chatPath('missing'));
    expect(await screen.findByText(/deleted or is not yours/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    await waitFor(() => expect(location.current).toBe(paths.ask));
  });
});

describe('History → Assistant chats', () => {
  it('lists saved chats, opens one and deletes one', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    const sent = await api.chat.send({ messages: [{ role: 'user', text: 'Period pain help' }] });
    await renderApp(api, `${paths.history}?tab=chats`);

    const link = await screen.findByRole('link', { name: /Period pain help/ });
    expect(link.getAttribute('href')).toBe(chatPath(sent.conversationId!));

    fireEvent.click(screen.getByRole('button', { name: 'Delete chat: Period pain help' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });
    expect(await screen.findByText('No chats yet')).toBeTruthy();
    expect((await api.chat.listConversations()).items).toEqual([]);
  });

  it('switches between the two tabs', async () => {
    const api = createMockApi({ latencyMs: 0, startSignedIn: true });
    await renderApp(api, paths.history);
    fireEvent.click(await screen.findByRole('button', { name: 'Assistant chats' }));
    await waitFor(() => expect(location.current).toBe(`${paths.history}?tab=chats`));
    expect(await screen.findByText('No chats yet')).toBeTruthy();
  });
});
