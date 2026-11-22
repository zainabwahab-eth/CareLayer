// Questions, consent, claims, answers and feedback (x402 pay on delivery). See docs/API_CONTRACT.md §8-9.
import type { Id, IsoDateTime, Money } from './common.js';
import type { EmergencyResponse } from './emergency.js';
import type { NurseRole } from './nurses.js';

/** Assigned by the AI. Women never choose. */
export const QUESTION_CATEGORIES = [
  'pregnancy',
  'periods',
  'contraception',
  'sexual_health',
  'general',
] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

/**
 * open      waiting for a claim (may still be inside a chosen nurse's 10-minute window)
 * claimed   a nurse holds the 10-minute lock
 * answered  answer written (she may not have collected it yet)
 * expired   no nurse answered in time; she pays nothing
 * cancelled she withdrew it before it was answered
 */
export const QUESTION_STATUSES = ['open', 'claimed', 'answered', 'expired', 'cancelled'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export type QuestionSource = 'web' | 'mcp' | 'agent';

/** "First available" is the default. A chosen nurse has CHOSEN_NURSE_WINDOW_MINUTES to claim. */
export type NurseSelection = 'first_available' | 'chosen_nurse';

export const AGE_RANGES = [
  'under_18',
  'age_18_24',
  'age_25_34',
  'age_35_44',
  'age_45_plus',
] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

/** What she agrees to share with the nurse (recorded per question). Never name, email, phone or location. */
export const SHARED_FIELDS = [
  'cleaned_text',
  'original_text',
  'assistant_notes',
  'category',
  'age_range',
  'pregnancy_weeks',
] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];

export const CLAIM_LOCK_MINUTES = 10;
export const CHOSEN_NURSE_WINDOW_MINUTES = 10;
/** No new claims after this. An active claim may finish its lock (max wait 40 minutes). */
export const QUESTION_CLAIMS_CLOSE_MINUTES = 30;

export interface ConsentInput {
  sharedFields: SharedField[];
  /** Version of the consent text she saw (W07). */
  consentVersion: string;
}

// POST /questions  (free)
export interface CreateQuestionBody {
  /** Her exact words. Stored verbatim. */
  originalText: string;
  source: QuestionSource;
  /** Required. No consent, no question. */
  consent: ConsentInput;
  /** Default "first_available". */
  nurseSelection?: NurseSelection;
  /** Required when nurseSelection = "chosen_nurse". Must be an approved, available nurse. */
  chosenNurseId?: Id;
  /** "Only female health workers". Default false. */
  femaleOnly?: boolean;
  /** Must be true if price exceeds her spending limit. */
  approvedAboveLimit?: boolean;
  /**
   * From POST /chat/draft. The question is stored exactly as that draft (what she saw on W07);
   * `originalText` must match the draft's. Without it the server prepares the question itself.
   */
  draftToken?: string;
}

/** Sharing these is required: a nurse cannot answer without the question and its topic. */
export const REQUIRED_SHARED_FIELDS: readonly SharedField[] = ['cleaned_text', 'category'];

/** GET /me/questions?status=. "active" = open or claimed (W05 Home). */
export type MyQuestionsStatusFilter = QuestionStatus | 'active';

export interface CreatedQuestion {
  kind: 'question';
  id: Id;
  status: 'open';
  category: QuestionCategory;
  price: Money;
  isFree: boolean;
  nurseSelection: NurseSelection;
  /** End of the chosen nurse's window. Null for first available. */
  chosenUntil: IsoDateTime | null;
  /** No new claims after this (created + 30 min). */
  claimsCloseAt: IsoDateTime;
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
  claimsCloseAt: IsoDateTime;
  answeredAt: IsoDateTime | null;
  expiredAt: IsoDateTime | null;
}

/** What a woman (or her agent) sees about who answered. Never contact details. */
export interface PublicNurse {
  id: Id;
  displayName: string;
  role: NurseRole;
  verified: true;
}

export interface Answer {
  questionId: Id;
  text: string;
  nurse: PublicNurse;
  /** The nurse ticked "Recommend she sees someone today". */
  recommendSeeSomeoneToday: boolean;
  answeredAt: IsoDateTime;
}

// GET /questions/:id/answer  (x402-protected)
export interface AnswerResponse {
  answer: Answer;
  payment: {
    amount: Money;
    /** Null when the answer was free to her (the treasury pays the nurse). */
    stellarTxHash: string | null;
    paidFromTreasury: boolean;
  };
}

// POST /me/questions/:id/collect  (woman; the API's own agent pays from her custodial wallet)
export interface CollectAnswerBody {
  /** She approved paying above her per-answer spending limit (W11). Default false. */
  approvedAboveLimit?: boolean;
  /**
   * Claude only (agent token): she confirmed this payment in the conversation. Required for a paid
   * answer when her setting mcpAskBeforeEachPayment is on (else 409 PAYMENT_CONFIRMATION_REQUIRED).
   */
  confirmPayment?: boolean;
}

/**
 * `details` of a 503 SERVICE_UNAVAILABLE from GET /questions/:id/answer or collect. Always
 * retryable; nothing was charged. `paymentPending: true` = a payment was sent and is still being
 * confirmed: retry after `retryAfterSeconds` (she will not be asked to pay again meanwhile).
 */
export interface AnswerUnavailableDetails {
  retryable: true;
  paymentPending?: boolean;
  retryAfterSeconds?: number;
}

// POST /questions/:id/feedback  (woman, answered + collected)
export interface FeedbackBody {
  helpful: boolean;
}
export interface FeedbackResponse {
  questionId: Id;
  helpful: boolean;
  updatedAt: IsoDateTime;
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
  nurseSelection: NurseSelection;
  /** The nurse she chose, if any. */
  chosenNurse: PublicNurse | null;
  femaleOnly: boolean;
  claimsCloseAt: IsoDateTime;
  /** Present once answered AND collected. */
  answer: Answer | null;
  /** Her helpful / not helpful, if given. */
  feedback: { helpful: boolean } | null;
  createdAt: IsoDateTime;
}

/** What a nurse sees. The woman is anonymous: no name, email, wallet, location or chat history. */
export interface NurseQuestionView {
  id: Id;
  status: QuestionStatus;
  category: QuestionCategory;
  /** Spelling and grammar cleaned, never summarised. */
  cleanedText: string;
  /** Her exact words, so nothing is lost in clean-up (if she consented to share it). */
  originalText: string | null;
  /** Separate notes added by the assistant (context, not a summary). */
  assistantNotes: string | null;
  ageRange: AgeRange | null;
  pregnancyWeeks: number | null;
  femaleOnly: boolean;
  /** True while this question is reserved for you (chosen nurse window). */
  chosenForYou: boolean;
  claimsCloseAt: IsoDateTime;
  createdAt: IsoDateTime;
  /** Set when this nurse holds the claim. */
  claimExpiresAt: IsoDateTime | null;
}

// POST /nurse/questions/:id/claim
export interface Claim {
  questionId: Id;
  expiresAt: IsoDateTime;
}

// POST /nurse/questions/:id/answer
export interface SubmitAnswerBody {
  /** 1 to ANSWER_TEXT_MAX_LENGTH characters. */
  text: string;
  /** "Recommend she sees someone today". Default false. */
  recommendSeeSomeoneToday?: boolean;
}

export const ANSWER_TEXT_MAX_LENGTH = 5000;

/**
 * GET /nurse/questions?tab=
 *   waiting    open questions she may claim now (chosen-for-you first, then oldest first)
 *   active     her current claim (0 or 1)
 *   completed  questions she answered, newest first (cursor pages)
 */
export const NURSE_QUESTION_TABS = ['waiting', 'active', 'completed'] as const;
export type NurseQuestionTab = (typeof NURSE_QUESTION_TABS)[number];

/** GET /nurse/dashboard (N05 Today). Days and weeks are Lagos time (UTC+1); weeks start Monday. */
export interface NurseDashboard {
  verificationStatus: 'draft' | 'pending_review' | 'approved' | 'rejected';
  available: boolean;
  topics: QuestionCategory[];
  /** Her current claim, with claimExpiresAt for the countdown. */
  activeClaim: NurseQuestionView | null;
  /** Open questions she could claim now (0 until approved). */
  waitingCount: number;
  /** Of those, reserved for her (she was chosen). */
  chosenForYouCount: number;
  answeredToday: number;
  answeredThisWeek: number;
  avgResponseMinutes: number | null;
  helpful: { percent: number | null; count: number };
}
