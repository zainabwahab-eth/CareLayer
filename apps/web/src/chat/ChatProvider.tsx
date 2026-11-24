import type { ChatTurn, Id } from '@carelayer/shared';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../api/useApi';
import { isSessionError } from '../auth/auth-flow';
import { useAuth } from '../auth/useAuth';
import { chatErrorMessage } from './chat-errors';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ChatContext,
  type ChatContextValue,
  type ChatEntry,
  type ChatState,
  type SendResult,
  hasAnsweredQuestion,
  threadFor,
} from './chat-context';

const EMPTY: ChatState = { entries: [], pending: false, offer: null, request: null };

/**
 * Holds the current W06 chat above the router, so it survives moving to the
 * consent and emergency screens and back. Memory only (never storage), and
 * reset whenever the signed-in user changes.
 *
 * POST /chat is stateless (contract §7): the server stores nothing, so every
 * message is sent with the thread so far.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  return <ChatStore key={state.user?.id ?? 'signed-out'}>{children}</ChatStore>;
}

let localIdCounter = 0;
/** Local ids for her messages and emergency notices (not crypto.randomUUID: needs HTTPS). */
function localId(prefix: string): Id {
  localIdCounter += 1;
  return `local_${prefix}_${Date.now().toString(36)}_${localIdCounter}`;
}

function ChatStore({ children }: { children: ReactNode }) {
  const api = useApi();
  const { sessionExpired } = useAuth();
  const [chat, setChat] = useState<ChatState>(EMPTY);
  /**
   * Turns the API has seen, oldest first: her delivered messages (including one
   * that raised an emergency) and the assistant's replies. Failed sends are left out.
   */
  const delivered = useRef<ChatTurn[]>([]);
  const pendingRef = useRef(false);
  /** Bumped by reset() so replies to an abandoned chat are dropped. */
  const generation = useRef(0);

  const updateEntry = (id: Id, patch: Partial<Extract<ChatEntry, { kind: 'user' }>>) =>
    setChat((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.kind === 'user' && entry.id === id ? { ...entry, ...patch } : entry,
      ),
    }));

  const deliver = useCallback(
    async (entryId: Id, text: string): Promise<SendResult> => {
      const startedIn = generation.current;
      const isCurrent = () => generation.current === startedIn;
      pendingRef.current = true;
      // A new message replaces any earlier offer (and any draft made before it); the reply
      // decides whether to offer again.
      setChat((current) => ({ ...current, pending: true, offer: null, request: null }));

      try {
        const messages = threadFor(delivered.current, text);
        const response = await api.chat.send({ messages });
        if (!isCurrent()) return { kind: 'ignored' };

        if (response.kind === 'emergency') {
          // Kept in the thread: POST /chat only checks the newest message, and a
          // later draft re-checks the whole question, so it stays out of the nurse queue.
          delivered.current = messages;
          // Emergency: free, nothing queued, and no nurse offer or payment (contract §6).
          setChat((current) => ({
            ...current,
            pending: false,
            offer: null,
            entries: [
              ...current.entries.map((entry) =>
                entry.kind === 'user' && entry.id === entryId
                  ? {
                      ...entry,
                      status: 'sent' as const,
                      outcome: 'emergency' as const,
                      error: undefined,
                    }
                  : entry,
              ),
              {
                kind: 'emergency',
                id: localId('emergency'),
                response,
                createdAt: new Date().toISOString(),
              },
            ],
          }));
          return { kind: 'emergency', response };
        }

        delivered.current = [...messages, { role: 'assistant', text: response.message.text }];
        setChat((current) => ({
          ...current,
          pending: false,
          offer: response.escalationOffer,
          entries: [
            ...current.entries.map((entry) =>
              entry.kind === 'user' && entry.id === entryId
                ? { ...entry, status: 'sent' as const, outcome: 'reply' as const, error: undefined }
                : entry,
            ),
            {
              kind: 'assistant',
              id: response.message.id,
              text: response.message.text,
              createdAt: response.message.createdAt,
            },
          ],
        }));
        return { kind: 'reply' };
      } catch (error) {
        if (!isCurrent()) return { kind: 'ignored' };
        if (isSessionError(error)) sessionExpired();
        setChat((current) => ({ ...current, pending: false }));
        updateEntry(entryId, { status: 'failed', error: chatErrorMessage(error) });
        return { kind: 'error' };
      } finally {
        if (isCurrent()) pendingRef.current = false;
      }
    },
    [api, sessionExpired],
  );

  const send = useCallback(
    async (rawText: string): Promise<SendResult> => {
      const text = rawText.trim();
      if (!text || text.length > CHAT_MESSAGE_MAX_LENGTH || pendingRef.current) {
        return { kind: 'ignored' };
      }
      const id = localId('msg');
      setChat((current) => ({
        ...current,
        entries: [
          ...current.entries,
          { kind: 'user', id, text, createdAt: new Date().toISOString(), status: 'sending' },
        ],
      }));
      return deliver(id, text);
    },
    [deliver],
  );

  const retry = useCallback(
    async (entryId: Id): Promise<SendResult> => {
      if (pendingRef.current) return { kind: 'ignored' };
      const entry = chat.entries.find((e) => e.kind === 'user' && e.id === entryId);
      if (!entry || entry.kind !== 'user' || entry.status !== 'failed') return { kind: 'ignored' };
      updateEntry(entryId, { status: 'sending', error: undefined });
      return deliver(entryId, entry.text);
    },
    [chat.entries, deliver],
  );

  const dismissOffer = useCallback(() => setChat((current) => ({ ...current, offer: null })), []);

  const thread = useCallback(() => [...delivered.current], []);

  const setRequest = useCallback<ChatContextValue['setRequest']>(
    (update) =>
      setChat((current) => ({
        ...current,
        request: typeof update === 'function' ? update(current.request) : update,
      })),
    [],
  );

  const reset = useCallback(() => {
    generation.current += 1;
    delivered.current = [];
    pendingRef.current = false;
    setChat(EMPTY);
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({
      ...chat,
      canAskNurse: hasAnsweredQuestion(chat.entries),
      send,
      retry,
      dismissOffer,
      thread,
      setRequest,
      reset,
    }),
    [chat, send, retry, dismissOffer, thread, setRequest, reset],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
