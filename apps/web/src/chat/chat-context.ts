import {
  CHAT_LIMITS,
  type ChatTurn,
  type EmergencyResponse,
  type EscalationOffer,
  type Id,
  type IsoDateTime,
} from '@carelayer/shared';
import { createContext } from 'react';
import type { AskRequest } from './ask-request';

/*
 * W06 assistant chat state.
 *
 * Decisions log (docs/TASKS.md §2): chat history is not stored by CareLayer;
 * it lives in the client session. It is kept in memory only, so a reload,
 * logging out or quick exit always opens a blank new chat.
 */

/** Longest message accepted (contract §7, CHAT_LIMITS.maxTextLength). */
export const CHAT_MESSAGE_MAX_LENGTH = CHAT_LIMITS.maxTextLength;

export type ChatEntry =
  | {
      kind: 'user';
      /** Local id: the server never returns her message back. */
      id: Id;
      text: string;
      createdAt: IsoDateTime;
      status: 'sending' | 'sent' | 'failed';
      /** What the API returned for it, once sent. */
      outcome?: 'reply' | 'emergency';
      /** Plain-language reason, set when status is "failed". */
      error?: string;
    }
  | { kind: 'assistant'; id: Id; text: string; createdAt: IsoDateTime }
  /**
   * Red-flag check matched (contract §6). Shown in the thread after her
   * message so she can reopen the emergency screen. Free, nothing queued.
   */
  | { kind: 'emergency'; id: Id; response: EmergencyResponse; createdAt: IsoDateTime };

export interface ChatState {
  entries: ChatEntry[];
  /** True while waiting for the assistant's reply. One message at a time. */
  pending: boolean;
  /**
   * The assistant's latest offer to send her question to a nurse.
   * Cleared when she dismisses it, sends another message, or an emergency is detected
   * (emergencies never go through payment or the nurse queue).
   */
  offer: EscalationOffer | null;
  /**
   * The W07-W09 send flow (draft, consent, who answers). Cleared when she sends
   * another message (the draft no longer matches her chat) or starts a new chat.
   */
  request: AskRequest | null;
}

export type SendResult =
  | { kind: 'reply' }
  | { kind: 'emergency'; response: EmergencyResponse }
  | { kind: 'error' }
  /** Nothing was sent (empty, too long, or a reply is still pending). */
  | { kind: 'ignored' };

export interface ChatContextValue extends ChatState {
  /**
   * She has a question a nurse could answer: at least one of her messages was
   * sent and answered by the assistant. A message that triggered an emergency
   * does not count (emergencies never go to the nurse queue). Gates
   * "Ask a nurse directly" and the W07 consent route.
   */
  canAskNurse: boolean;
  /** Send a new message. Resolves when the assistant replies or the send fails. */
  send(text: string): Promise<SendResult>;
  /** Re-send a message that failed. */
  retry(entryId: Id): Promise<SendResult>;
  dismissOffer(): void;
  /** The turns the API has seen, oldest first (sent with POST /chat/draft). */
  thread(): ChatTurn[];
  /** Start, update or clear the send flow. */
  setRequest(update: AskRequest | null | ((current: AskRequest | null) => AskRequest | null)): void;
  /** Start a blank new chat. */
  reset(): void;
}

/** See ChatContextValue.canAskNurse. */
export function hasAnsweredQuestion(entries: readonly ChatEntry[]): boolean {
  return entries.some((entry) => entry.kind === 'user' && entry.outcome === 'reply');
}

/**
 * The turns to send with her new message: everything delivered so far plus the
 * new one, trimmed to the API's limit (it uses the most recent turns anyway).
 */
export function threadFor(delivered: readonly ChatTurn[], text: string): ChatTurn[] {
  return [...delivered, { role: 'user' as const, text }].slice(-CHAT_LIMITS.maxTurns);
}

export const ChatContext = createContext<ChatContextValue | null>(null);
