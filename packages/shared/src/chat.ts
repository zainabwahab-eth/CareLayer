// AI assistant chat (free) and question drafts. See docs/API_CONTRACT.md §7.
// Chat history is saved to her account (decision changed 2026-11-24): POST /chat stores her new
// message and the reply in a conversation, and History lists them. The client still sends the
// thread it shows, so the assistant always answers what she sees.
import type { Id, IsoDateTime, Money } from './common.js';
import type { EmergencyResponse } from './emergency.js';
import type { AgeRange, QuestionCategory } from './questions.js';

export type ChatRole = 'user' | 'assistant';

/** One turn of the thread the client sends. */
export interface ChatTurn {
  role: ChatRole;
  text: string;
}

export const CHAT_LIMITS = {
  /** Turns per request. Older turns can be dropped by the client; the server uses the last 20. */
  maxTurns: 40,
  /** Characters per turn (the web app caps her message at the same length). */
  maxTextLength: 4000,
  /** Characters in a question sent to a nurse (her messages joined). */
  maxQuestionLength: 8000,
  /** Chat + draft requests per woman per minute. */
  requestsPerMinute: 12,
} as const;

/** A message in a conversation (the assistant's reply, or a stored turn). */
export interface ChatMessage {
  id: Id;
  role: ChatRole;
  text: string;
  createdAt: IsoDateTime;
}

/** Shown when the assistant thinks a health worker should answer. She must consent. */
export interface EscalationOffer {
  price: Money;
  isFree: boolean;
  freeAnswersRemaining: number;
  suggestedCategory: QuestionCategory;
  /** True if price is above her per-answer spending limit (needs explicit approval). */
  exceedsSpendingLimit: boolean;
}

// POST /chat
export interface ChatRequestBody {
  /** The whole thread so far, oldest first. The last turn is her new message (role "user"). */
  messages: ChatTurn[];
  /**
   * The conversation to add to (from an earlier POST /chat). Omit for a new chat: the server
   * creates one and returns its id. Another woman's id is 404.
   */
  conversationId?: Id;
}

export type ChatResponse =
  | {
      kind: 'reply';
      message: ChatMessage;
      escalationOffer: EscalationOffer | null;
      /** The conversation her message and this reply were saved in (null if saving failed). */
      conversationId: Id | null;
    }
  | (EmergencyResponse & {
      /** The conversation her message was saved in (null if saving failed). No reply follows. */
      conversationId: Id | null;
    });

// GET /chat/conversations (paged, most recently active first)
export interface ConversationSummary {
  id: Id;
  /** The start of her first message. */
  title: string;
  /** The start of the last message in it. */
  preview: string;
  messageCount: number;
  createdAt: IsoDateTime;
  /** When the last message was added. */
  updatedAt: IsoDateTime;
}

/** A stored message. `emergency`: her message raised an emergency (no reply follows it). */
export interface ConversationMessage {
  id: Id;
  role: ChatRole;
  text: string;
  emergency: boolean;
  createdAt: IsoDateTime;
}

// GET /chat/conversations/:id
export interface Conversation {
  id: Id;
  title: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Oldest first. */
  messages: ConversationMessage[];
}

/**
 * Exactly what a nurse would receive (W07 Consent shows it). `originalText` is her question:
 * the message(s) of hers that ask it, verbatim (not the whole chat). `cleanedText` fixes spelling
 * and grammar only, never shortened. `assistantNotes` summarises relevant details from the rest
 * of the chat.
 */
export interface QuestionDraft {
  originalText: string;
  cleanedText: string;
  assistantNotes: string | null;
  category: QuestionCategory;
  /** Only when she stated her age. */
  ageRange: AgeRange | null;
  /** Only when she stated how many weeks pregnant she is. */
  pregnancyWeeks: number | null;
}

// POST /chat/draft  (W07 Consent, and "Ask a nurse directly")
export interface DraftRequestBody {
  /** The chat so far, oldest first. Only her chosen message(s) become the question. */
  messages: ChatTurn[];
  /**
   * Index in `messages` of her message the assistant offered a nurse for, when known. A hint:
   * the model still picks the question (e.g. she later wrote "I'm ready to ask now").
   */
  focusIndex?: number;
}

export type DraftResponse =
  | {
      kind: 'draft';
      draft: QuestionDraft;
      /** Send back as CreateQuestionBody.draftToken so the question is exactly this draft. */
      draftToken: string;
      /** After this, POST /questions refuses the token: ask for a new draft. */
      draftExpiresAt: IsoDateTime;
      offer: EscalationOffer;
    }
  | EmergencyResponse;
