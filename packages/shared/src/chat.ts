// AI assistant chat (free) and question drafts. See docs/API_CONTRACT.md §7.
// Chat history is NOT stored on the server: the client keeps the thread in memory and sends it
// with every message (decisions log, docs/TASKS.md §2).
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

/** A message the assistant wrote. `id` is generated per reply; nothing is stored. */
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
}

export type ChatResponse =
  | { kind: 'reply'; message: ChatMessage; escalationOffer: EscalationOffer | null }
  | EmergencyResponse;

/**
 * Exactly what a nurse would receive (W07 Consent shows it). `originalText` is her messages
 * joined verbatim; `cleanedText` fixes spelling and grammar only, never shortened.
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
export type DraftRequestBody = ChatRequestBody;

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

// ---- Deprecated (contract v0 §7, replaced in Z6 by POST /chat). Kept so apps/web compiles until
// it switches. The routes no longer exist. ----

/** @deprecated Conversations are not stored. Use ChatRequestBody with POST /chat. */
export interface Conversation {
  id: Id;
  createdAt: IsoDateTime;
  messages: ChatMessage[];
}

/** @deprecated Use ChatRequestBody with POST /chat. */
export interface SendMessageBody {
  text: string;
}

/** @deprecated Same shape as ChatResponse. */
export type SendMessageResponse = ChatResponse;
