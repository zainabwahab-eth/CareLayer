import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuthTokensResponse, ChatRequestBody, ChatResponse } from '@carelayer/shared';
import { ApiProvider } from '../api/ApiProvider';
import { ApiError } from '../api/errors';
import type { CareLayerApi } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { useAuth } from '../auth/useAuth';
import { ChatProvider } from './ChatProvider';
import { threadFor, type ChatContextValue } from './chat-context';
import { useChat } from './useChat';

const tokens = {
  accessToken: 'token',
  user: { id: 'u1', role: 'woman', displayName: 'Tolu' },
} as unknown as AuthTokensResponse;

const reply = (text: string): ChatResponse => ({
  kind: 'reply',
  message: { id: `m_${text}`, role: 'assistant', text, createdAt: '2026-11-23T00:00:00Z' },
  escalationOffer: null,
});

function setup(send: (body: ChatRequestBody) => Promise<ChatResponse>) {
  const api = {
    mode: 'http',
    auth: { refresh: vi.fn(async () => tokens), logout: vi.fn(async () => {}) },
    chat: { send: vi.fn(send), draft: vi.fn() },
  } as unknown as CareLayerApi & { chat: { send: ReturnType<typeof vi.fn> } };
  const chat: { current: ChatContextValue | null } = { current: null };
  function Probe() {
    chat.current = useChat();
    const { state } = useAuth();
    return <p>{state.status}</p>;
  }
  render(
    <ApiProvider api={api}>
      <AuthProvider>
        <ChatProvider>
          <Probe />
        </ChatProvider>
      </AuthProvider>
    </ApiProvider>,
  );
  return { api, chat };
}

const sentThreads = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([body]) => (body as ChatRequestBody).messages);

describe('ChatProvider on POST /chat', () => {
  it('sends the whole delivered thread with each new message', async () => {
    const { api, chat } = setup(async ({ messages }) => reply(`re:${messages.at(-1)!.text}`));
    await screen.findByText('authenticated');

    await act(() => chat.current!.send('first'));
    await act(() => chat.current!.send('second'));

    expect(sentThreads(api.chat.send)).toEqual([
      [{ role: 'user', text: 'first' }],
      [
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 're:first' },
        { role: 'user', text: 'second' },
      ],
    ]);
    expect(chat.current!.entries.map((e) => e.kind)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('leaves a failed message out of the thread until it is retried', async () => {
    const send = vi
      .fn<(body: ChatRequestBody) => Promise<ChatResponse>>()
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Assistant down.'))
      .mockImplementation(async ({ messages }) => reply(`re:${messages.at(-1)!.text}`));
    const { api, chat } = setup(send);
    await screen.findByText('authenticated');

    await act(() => chat.current!.send('lost'));
    const failed = chat.current!.entries[0]!;
    expect(failed).toMatchObject({ status: 'failed', error: 'Assistant down.' });

    await act(() => chat.current!.retry(failed.id));
    expect(sentThreads(api.chat.send)[1]).toEqual([{ role: 'user', text: 'lost' }]);
    expect(chat.current!.entries[0]).toMatchObject({ status: 'sent', outcome: 'reply' });
  });

  it('starts an empty thread after reset', async () => {
    const { api, chat } = setup(async () => reply('ok'));
    await screen.findByText('authenticated');
    await act(() => chat.current!.send('before'));
    act(() => chat.current!.reset());
    await act(() => chat.current!.send('after'));
    expect(sentThreads(api.chat.send)[1]).toEqual([{ role: 'user', text: 'after' }]);
  });

  it('signs her out when the session cannot be refreshed', async () => {
    const { chat } = setup(async () => {
      throw new ApiError(401, 'REFRESH_INVALID', 'Your session has ended.');
    });
    await screen.findByText('authenticated');
    await act(() => chat.current!.send('hello'));
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeTruthy());
  });
});

describe('threadFor', () => {
  it('keeps the most recent CHAT_LIMITS.maxTurns turns, ending with her new message', () => {
    const delivered = Array.from({ length: 45 }, (_, i) => ({
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      text: `t${i}`,
    }));
    const thread = threadFor(delivered, 'new');
    expect(thread).toHaveLength(40);
    expect(thread.at(-1)).toEqual({ role: 'user', text: 'new' });
    expect(thread[0]).toEqual(delivered[6]);
  });
});

describe('ChatProvider send flow (W07-W09)', () => {
  it('exposes the delivered thread and clears the draft when she sends again', async () => {
    const { chat } = setup(async ({ messages }) => reply(`re:${messages.at(-1)!.text}`));
    await screen.findByText('authenticated');
    await act(() => chat.current!.send('first'));
    expect(chat.current!.thread()).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 're:first' },
    ]);

    act(() =>
      chat.current!.setRequest({
        draft: {
          originalText: 'first',
          cleanedText: 'First.',
          assistantNotes: null,
          category: 'general',
          ageRange: null,
          pregnancyWeeks: null,
        },
        draftToken: 'draft',
        draftExpiresAt: '2099-01-01T00:00:00Z',
        offer: {
          price: { kobo: 50_000, usdc: '0.31' },
          isFree: false,
          freeAnswersRemaining: 0,
          suggestedCategory: 'general',
          exceedsSpendingLimit: false,
        },
        consented: true,
        nurseSelection: 'first_available',
        chosenNurse: null,
        femaleOnly: false,
      }),
    );
    expect(chat.current!.request?.draftToken).toBe('draft');

    await act(() => chat.current!.send('second'));
    expect(chat.current!.request).toBeNull();
  });
});
