import type { ChatTurn, Id } from '@carelayer/shared';
import { hasErrorCode } from '../api/errors';
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
  type OpenResult,
  type SendResult,
  fromConversation,
  hasAnsweredQuestion,
  historyText,
  threadFor,
} from './chat-context';

const EMPTY: ChatState = {
  entries: [],
  pending: false,
  offer: null,
  request: null,
  conversationId: null,
  offeredFor: null,
};

/**
 * Holds the current W06 chat above the router, so it survives moving to the
 * consent and emergency screens and back. Reset whenever the signed-in user changes.
 *
 * Every message is sent with the thread so far (contract §7); POST /chat saves it
 * to her conversation and returns its id, which later messages are added to.
 * openConversation() reloads a saved chat (reload, or opened from History).
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
  /** The saved conversation new messages go to (a ref: read inside async sends). */
  const conversationRef = useRef<Id | null>(null);
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
        const response = await api.chat.send({
          messages,
          conversationId: conversationRef.current ?? undefined,
        });
        if (!isCurrent()) return { kind: 'ignored' };
        // Saved (null only if the server could not save it: keep the chat she sees).
        if (response.conversationId) conversationRef.current = response.conversationId;
        const conversationId = conversationRef.current;

        if (response.kind === 'emergency') {
          // Kept in the thread: POST /chat only checks the newest message, and a
          // later draft re-checks the whole question, so it stays out of the nurse queue.
          delivered.current = messages;
          // Emergency: free, nothing queued, and no nurse offer or payment (contract §6).
          setChat((current) => ({
            ...current,
            pending: false,
            offer: null,
            conversationId,
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

        const turns: ChatTurn[] = [
          ...messages,
          { role: 'assistant', text: historyText(response.message.text) },
        ];
        delivered.current = turns;
        setChat((current) => ({
          ...current,
          pending: false,
          offer: response.escalationOffer,
          offeredFor: response.escalationOffer ? text : current.offeredFor,
          conversationId,
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

  const noteQuestionSent = useCallback(
    (questionId: Id) =>
      setChat((current) => ({
        ...current,
        entries: [
          ...current.entries,
          {
            kind: 'question',
            id: `question_${questionId}`,
            questionId,
            createdAt: new Date().toISOString(),
          },
        ],
      })),
    [],
  );

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
    conversationRef.current = null;
    pendingRef.current = false;
    setChat(EMPTY);
  }, []);

  const openConversation = useCallback(
    async (id: Id): Promise<OpenResult> => {
      if (conversationRef.current === id) return 'opened';
      // Like reset(): replies to the chat she is leaving are dropped.
      generation.current += 1;
      const openedIn = generation.current;
      pendingRef.current = false;
      try {
        const conversation = await api.chat.getConversation(id);
        // Only fetched when needed: emergency notices are shown again under her message.
        const emergency = conversation.messages.some((m) => m.emergency)
          ? await api.emergency.get().catch(() => null)
          : null;
        if (generation.current !== openedIn) return 'error';
        const { turns, entries } = fromConversation(conversation, emergency);
        delivered.current = turns;
        conversationRef.current = conversation.id;
        setChat({ ...EMPTY, entries, conversationId: conversation.id });
        return 'opened';
      } catch (error) {
        if (isSessionError(error)) sessionExpired();
        return hasErrorCode(error, 'NOT_FOUND') ? 'not_found' : 'error';
      }
    },
    [api, sessionExpired],
  );

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
      openConversation,
      noteQuestionSent,
    }),
    [
      chat,
      send,
      retry,
      dismissOffer,
      thread,
      setRequest,
      reset,
      openConversation,
      noteQuestionSent,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
