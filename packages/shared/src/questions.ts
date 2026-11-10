// Questions, claims and answers (x402 pay on delivery). See docs/API_CONTRACT.md §8-9.
import type { Id, IsoDateTime, Money } from './common.js';
import type { EmergencyResponse } from './emergency.js';
import type { WorkerRole } from './workers.js';

/** Assigned by the AI. Women never choose. */
export const QUESTION_CATEGORIES = [
  'pregnancy',
  'periods',
  'contraception',
  'sexual_health',
  'general',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export type QuestionStatus = 'open' | 'claimed' | 'answered';

export type QuestionSource = 'web' | 'mcp' | 'agent';

export const CLAIM_LOCK_MINUTES = 10;

// POST /questions  (free)
export interface CreateQuestionBody {
  /** Her exact words. Stored verbatim. */
  originalText: string;
  conversationId?: Id;
  preferFemaleWorker?: boolean;
  source: QuestionSource;
  /** Must be true if price exceeds her spending limit. */
  approvedAboveLimit?: boolean;
}

export interface CreatedQuestion {
  kind: 'question';
  id: Id;
  status: 'open';
  category: QuestionCategory;
  price: Money;
  isFree: boolean;
  /**
   * Capability secret for callers without a CareLayer session (third-party agents).
   * Send as header `X-Question-Key` on status/answer calls. Null for signed-in callers.
   */
  questionKey: string | null;
  createdAt: IsoDateTime;
}

export type CreateQuestionResponse = CreatedQuestion | EmergencyResponse;

// GET /questions/:id/status  (free)
export interface QuestionStatusResponse {
  id: Id;
  status: QuestionStatus;
  category: QuestionCategory;
  answeredAt: IsoDateTime | null;
}

/** What a woman (or her agent) sees about who answered. Never contact details. */
export interface PublicWorker {
  displayName: string;
  role: WorkerRole;
  verified: true;
}

export interface Answer {
  questionId: Id;
  text: string;
  worker: PublicWorker;
  answeredAt: IsoDateTime;
}

// GET /questions/:id/answer  (x402-protected)
export interface AnswerResponse {
  answer: Answer;
  payment: {
    amount: Money;
    /** Null when the answer was free (paid from treasury). */
    stellarTxHash: string | null;
    paidFromTreasury: boolean;
  };
}

/** A woman's own question, as listed in her app. */
export interface MyQuestion {
  id: Id;
  status: QuestionStatus;
  category: QuestionCategory;
  originalText: string;
  cleanedText: string;
  price: Money;
  isFree: boolean;
  /** Present once answered AND paid/collected. */
  answer: Answer | null;
  createdAt: IsoDateTime;
}

/** What a health worker sees. The woman is anonymous. */
export interface WorkerQuestionView {
  id: Id;
  status: QuestionStatus;
  category: QuestionCategory;
  /** Spelling and grammar cleaned, never summarised. */
  cleanedText: string;
  /** Her exact words, so nothing is lost in clean-up. */
  originalText: string;
  /** Separate notes added by the assistant (context, not a summary). */
  assistantNotes: string | null;
  preferFemaleWorker: boolean;
  createdAt: IsoDateTime;
  /** Set when this worker holds the claim. */
  claimExpiresAt: IsoDateTime | null;
}

// POST /worker/questions/:id/claim
export interface Claim {
  questionId: Id;
  expiresAt: IsoDateTime;
}

// POST /worker/questions/:id/answer
export interface SubmitAnswerBody {
  text: string;
}
