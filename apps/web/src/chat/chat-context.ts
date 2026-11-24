import {
  CHAT_LIMITS,
  type ChatTurn,
  type Conversation,
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
 * Chats are saved to her account (decision changed 2026-11-24): POST /chat stores
 * each message and reply in a conversation. The open chat's id is in the URL
 * (/ask?c=…), so a reload reopens it; History lists every saved chat. Quick exit
 * and logging out still open a blank new chat.
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
  /** The saved conversation this chat belongs to. Null until her first message is saved. */
  conversationId: Id | null;
}

/** Result of reopening a saved chat. */
export type OpenResult = 'opened' | 'not_found' | 'error';

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
  /** Load a saved chat (GET /chat/conversations/:id) and continue it. */
  openConversation(id: Id): Promise<OpenResult>;
}

/** See ChatContextValue.canAskNurse. */
export function hasAnsweredQuestion(entries: readonly ChatEntry[]): boolean {
  return entries.some((entry) => entry.kind === 'user' && entry.outcome === 'reply');
}

/**
 * An assistant reply as it is sent back in the thread. POST /chat accepts at most
 * CHAT_LIMITS.maxTextLength characters per turn, assistant turns included, but a reply
 * itself may be longer: sent whole, one long reply would make every later message fail
 * with 400. She still sees the full reply; only the context sent back is clipped.
 */
export function historyText(text: string): string {
  const max = CHAT_LIMITS.maxTextLength;
  if (text.length <= max) return text;
  let clipped = text.slice(0, max - 1);
  // Never leave half of a surrogate pair (emoji) at the end.
  if (/[\uD800-\uDBFF]$/.test(clipped)) clipped = clipped.slice(0, -1);
  return `${clipped}…`;
}

/**
 * The turns to send with her new message: everything delivered so far plus the
 * new one, trimmed to the API's limit (it uses the most recent turns anyway).
 */
export function threadFor(delivered: readonly ChatTurn[], text: string): ChatTurn[] {
  return [...delivered, { role: 'user' as const, text }].slice(-CHAT_LIMITS.maxTurns);
}

export const ChatContext = createContext<ChatContextValue | null>(null);

/** A saved chat as the thread the API sees and the entries the screen shows. */
export function fromConversation(
  conversation: Conversation,
  emergency: EmergencyResponse | null,
): { turns: ChatTurn[]; entries: ChatEntry[] } {
  const turns: ChatTurn[] = [];
  const entries: ChatEntry[] = [];
  for (const m of conversation.messages) {
    turns.push({ role: m.role, text: m.text });
    if (m.role === 'assistant') {
      entries.push({ kind: 'assistant', id: m.id, text: m.text, createdAt: m.createdAt });
      continue;
    }
    entries.push({
      kind: 'user',
      id: m.id,
      text: m.text,
      createdAt: m.createdAt,
      status: 'sent',
      outcome: m.emergency ? 'emergency' : 'reply',
    });
    if (m.emergency && emergency) {
      entries.push({
        kind: 'emergency',
        id: `${m.id}_emergency`,
        response: emergency,
        createdAt: m.createdAt,
      });
    }
  }
  return { turns, entries };
}
