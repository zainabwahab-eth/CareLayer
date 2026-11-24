import { isApiError } from '../../../api/errors';

/*
 * Plain-language messages for the ask-a-nurse screens. Never shows internals.
 * Status 0 = offline, unreachable or timed out (the HTTP client's message says which).
 */

const UNREACHABLE = 'Could not reach CareLayer. Check your connection and try again.';

/** POST /chat/draft (W07). */
export function draftErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'We could not prepare your question. Please try again.';
  if (error.status === 0) return error.message || UNREACHABLE;
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'Too many requests in a short time. Wait a moment, then try again.';
    case 'VALIDATION_FAILED':
      // e.g. "Your messages are too long to send as one question."
      return error.message || 'This question could not be prepared. Try shortening it in the chat.';
    case 'SERVICE_UNAVAILABLE':
      // The API's message says what to do if it is urgent (contract §7, 503).
      return error.message || 'The assistant is not available right now. Please try again.';
    default:
      return 'We could not prepare your question. Please try again.';
  }
}

/**
 * POST /questions (W09) failed in a way where it may still have been created: the
 * request timed out or the connection dropped after sending. Retrying blindly could
 * send it twice, so she is asked to check History first.
 */
export function isUncertainSend(error: unknown): boolean {
  return isApiError(error) && error.status === 0;
}

/** POST /questions (W09), for errors without their own screen state. */
export function createErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'Your question was not sent. Please try again.';
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'Too many requests in a short time. Wait a moment, then try again.';
    case 'SERVICE_UNAVAILABLE':
      return error.message || 'CareLayer is busy right now. Your question was not sent. Try again.';
    case 'VALIDATION_FAILED':
      return error.message || 'Your question could not be sent. Please try again.';
    default:
      return 'Your question was not sent. Please try again.';
  }
}
