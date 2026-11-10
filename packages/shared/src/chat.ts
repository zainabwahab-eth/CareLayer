// AI assistant chat (free). See docs/API_CONTRACT.md §7.
import type { Id, IsoDateTime, Money } from './common.js';
import type { EmergencyResponse } from './emergency.js';
import type { QuestionCategory } from './questions.js';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: Id;
  role: ChatRole;
  text: string;
  createdAt: IsoDateTime;
}

export interface Conversation {
  id: Id;
  createdAt: IsoDateTime;
  messages: ChatMessage[];
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

// POST /chat/conversations/:id/messages
export interface SendMessageBody {
  text: string;
}

export type SendMessageResponse =
  | { kind: 'reply'; message: ChatMessage; escalationOffer: EscalationOffer | null }
  | EmergencyResponse;
