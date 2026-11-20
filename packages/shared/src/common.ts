// Common primitives used across the CareLayer API contract.
// Contract version: v1 (Z1: schema-aligned, worker -> nurse). See docs/API_CONTRACT.md.

export const API_CONTRACT_VERSION = 'v1' as const;

/** ISO 8601 timestamp string, always UTC, e.g. "2026-11-10T14:00:00.000Z". */
export type IsoDateTime = string;

/** Opaque server-generated id (cuid/uuid). Never parse it. */
export type Id = string;

/**
 * Money is shown to people in naira but settled in USDC on Stellar testnet.
 * - `kobo`: integer naira minor units (₦1 = 100 kobo). Use for display and limits.
 * - `usdc`: decimal string with up to 7 places (Stellar precision), e.g. "0.3125000".
 *   Never use JS floats for USDC.
 * The NGN/USDC rate is a fixed server config value on testnet.
 */
export interface Money {
  kobo: number;
  usdc: string;
}

/** Every error response has this shape. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiErrorCode =
  // generic
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  /** A dependency (Google sign-in, email, facilitator) is not configured or not reachable. Retry later. */
  | 'SERVICE_UNAVAILABLE'
  // auth
  | 'ACCOUNT_EXISTS'
  | 'ACCOUNT_NOT_FOUND'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'CODE_ATTEMPTS_EXCEEDED'
  | 'GOOGLE_TOKEN_INVALID'
  | 'REFRESH_INVALID'
  | 'REFRESH_REUSED'
  | 'STEP_UP_REQUIRED'
  | 'WRONG_APP'
  // wallet / payments
  | 'INSUFFICIENT_BALANCE'
  | 'SPENDING_LIMIT_EXCEEDED'
  | 'PAYSTACK_SIGNATURE_INVALID'
  | 'STELLAR_ADDRESS_INVALID'
  | 'STELLAR_SUBMIT_FAILED'
  // questions / claims
  | 'CONSENT_REQUIRED'
  | 'CHOSEN_NURSE_UNAVAILABLE'
  | 'QUESTION_NOT_ANSWERED'
  | 'QUESTION_ALREADY_CLAIMED'
  | 'QUESTION_EXPIRED'
  | 'CLAIMS_CLOSED'
  | 'ACTIVE_CLAIM_EXISTS'
  | 'CLAIM_EXPIRED'
  | 'NOT_CLAIM_OWNER'
  | 'NURSE_NOT_APPROVED'
  | 'ONBOARDING_INCOMPLETE'
  | 'TOPICS_REQUIRED';

/** Cursor pagination used by list endpoints. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageQuery {
  cursor?: string;
  /** default 20, max 100 */
  limit?: number;
}
