import type { EmergencyResponse, EscalationOffer, Id, IsoDateTime } from '@carelayer/shared';
import { createContext } from 'react';

/*
 * W06 assistant chat state.
 *
 * Decisions log (docs/TASKS.md §2): chat history is not stored by CareLayer;
 * it lives in the client session. It is kept in memory only, so a reload,
 * logging out or quick exit always opens a blank new chat.
 */

/** Longest message accepted. The API rejects larger bodies (contract §0, 100 kB). */
export const CHAT_MESSAGE_MAX_LENGTH = 4_000;

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
  /** Start a blank new chat. */
  reset(): void;
}

/** See ChatContextValue.canAskNurse. */
export function hasAnsweredQuestion(entries: readonly ChatEntry[]): boolean {
  return entries.some((entry) => entry.kind === 'user' && entry.outcome === 'reply');
}

export const ChatContext = createContext<ChatContextValue | null>(null);
