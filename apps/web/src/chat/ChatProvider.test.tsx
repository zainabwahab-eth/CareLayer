import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_LIMITS,
  type AuthTokensResponse,
  type ChatRequestBody,
  type ChatResponse,
} from '@carelayer/shared';
import { ApiProvider } from '../api/ApiProvider';
import { ApiError } from '../api/errors';
import type { CareLayerApi } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';
import { useAuth } from '../auth/useAuth';
import { ChatProvider } from './ChatProvider';
import { historyText, threadFor, type ChatContextValue } from './chat-context';
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

/**
 * Stand-in for POST /chat that applies the API's request rules (apps/api chat router):
 * last turn hers, no empty turn, at most CHAT_LIMITS.maxTextLength per turn (assistant
 * turns included), at most CHAT_LIMITS.maxTurns turns. A thread the real API would
 * refuse fails here too.
 */
function contractChat(answer: (her: string, turns: number) => ChatResponse) {
  return async ({ messages }: ChatRequestBody): Promise<ChatResponse> => {
    const invalid =
      messages.length === 0 ||
      messages.length > CHAT_LIMITS.maxTurns ||
      messages.at(-1)!.role !== 'user' ||
      messages.some((m) => !m.text.trim() || m.text.length > CHAT_LIMITS.maxTextLength);
    if (invalid) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid thread.');
    return answer(messages.at(-1)!.text, messages.length);
  };
}

describe('ChatProvider: a conversation of many turns', () => {
  const SCRIPT = [
    'Is it normal for my period to be late sometimes?',
    'How late is too late?',
    'Can stress cause that?',
    'What foods have iron?',
    'Can you tell me what another woman’s health records say?',
    'okay',
    'Is it safe to exercise during my period?',
  ];

  it('answers every message, sending the whole thread each time (refusal, then "okay")', async () => {
    const { api, chat } = setup(
      contractChat((her) =>
        reply(/records/.test(her) ? 'I can’t share anyone’s health information.' : `re:${her}`),
      ),
    );
    await screen.findByText('authenticated');

    for (const text of SCRIPT) {
      const result = await act(() => chat.current!.send(text));
      expect(result).toEqual({ kind: 'reply' });
    }

    const threads = sentThreads(api.chat.send);
    expect(threads.map((t) => t.length)).toEqual([1, 3, 5, 7, 9, 11, 13]);
    // "okay" went with the refusal before it, as the assistant's turn.
    expect(threads[5]!.slice(-2)).toEqual([
      { role: 'assistant', text: 'I can’t share anyone’s health information.' },
      { role: 'user', text: 'okay' },
    ]);
    expect(chat.current!.entries.every((e) => e.kind !== 'user' || e.status === 'sent')).toBe(true);
    expect(chat.current!.turns).toHaveLength(14);
  });

  it('a reply longer than the API accepts per turn does not break the next message', async () => {
    const long = 'x'.repeat(CHAT_LIMITS.maxTextLength + 1000);
    const { api, chat } = setup(contractChat((her) => reply(her === 'first' ? long : 'ok')));
    await screen.findByText('authenticated');

    await act(() => chat.current!.send('first'));
    expect(await act(() => chat.current!.send('second'))).toEqual({ kind: 'reply' });

    // She still sees the whole reply; only the copy sent back is clipped.
    expect(chat.current!.entries[1]).toMatchObject({ kind: 'assistant', text: long });
    const sentBack = sentThreads(api.chat.send)[1]![1]!;
    expect(sentBack.role).toBe('assistant');
    expect(sentBack.text.length).toBeLessThanOrEqual(CHAT_LIMITS.maxTextLength);
  });

  it('after a provider error, the next message carries the thread without the failed one', async () => {
    let call = 0;
    const { api, chat } = setup(async (body) => {
      call += 1;
      if (call === 2) {
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'The assistant is not available right now. Please try again in a moment.',
          { retryable: true, reason: 'timeout' },
        );
      }
      return contractChat((her) => reply(`re:${her}`))(body);
    });
    await screen.findByText('authenticated');

    await act(() => chat.current!.send('one'));
    expect(await act(() => chat.current!.send('two'))).toEqual({ kind: 'error' });
    expect(chat.current!.entries[2]).toMatchObject({
      status: 'failed',
      error: 'The assistant is not available right now. Please try again in a moment.',
    });
    await act(() => chat.current!.send('three'));

    expect(sentThreads(api.chat.send)[2]).toEqual([
      { role: 'user', text: 'one' },
      { role: 'assistant', text: 're:one' },
      { role: 'user', text: 'three' },
    ]);
  });

  it('says when it cannot reach CareLayer (network failure or timeout)', async () => {
    const { chat } = setup(async () => {
      throw new ApiError(0, 'INTERNAL', 'The request took too long. Please try again.');
    });
    await screen.findByText('authenticated');
    await act(() => chat.current!.send('hello'));
    expect(chat.current!.entries[0]).toMatchObject({
      status: 'failed',
      error: 'The request took too long. Please try again.',
    });
  });

  it('ignores empty and whitespace-only messages', async () => {
    const { api, chat } = setup(async () => reply('ok'));
    await screen.findByText('authenticated');
    expect(await act(() => chat.current!.send('   '))).toEqual({ kind: 'ignored' });
    expect(await act(() => chat.current!.send(''))).toEqual({ kind: 'ignored' });
    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('after an emergency, the conversation continues and no nurse offer is kept', async () => {
    const emergency = {
      kind: 'emergency' as const,
      message: 'Get help now.',
      triggeredBy: ['llm'],
      contacts: [],
      findHospitalUrl: 'https://maps.example',
    };
    const { api, chat } = setup(async ({ messages }) =>
      messages.at(-1)!.text === 'help' ? emergency : reply('ok'),
    );
    await screen.findByText('authenticated');
    expect((await act(() => chat.current!.send('help'))).kind).toBe('emergency');
    expect(chat.current!.offer).toBeNull();
    expect(await act(() => chat.current!.send('thank you'))).toEqual({ kind: 'reply' });
    expect(sentThreads(api.chat.send)[1]).toEqual([
      { role: 'user', text: 'help' },
      { role: 'user', text: 'thank you' },
    ]);
  });
});

describe('historyText', () => {
  it('keeps short replies and clips long ones to the per-turn limit', () => {
    expect(historyText('short')).toBe('short');
    const clipped = historyText('a'.repeat(CHAT_LIMITS.maxTextLength * 2));
    expect(clipped).toHaveLength(CHAT_LIMITS.maxTextLength);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('never cuts an emoji in half', () => {
    const text = 'a'.repeat(CHAT_LIMITS.maxTextLength - 2) + '😀😀😀';
    const clipped = historyText(text);
    expect(clipped.length).toBeLessThanOrEqual(CHAT_LIMITS.maxTextLength);
    expect(/[\uD800-\uDBFF]…$/.test(clipped)).toBe(false);
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
