import { isApiError } from '../api/errors';

/** Plain-language message for a failed chat send. Never shows internals. */
export function chatErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'Your message was not sent. Please try again.';
  if (error.status === 0) return 'Could not reach CareLayer. Check your connection and try again.';
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'You are sending messages quickly. Wait a moment, then try again.';
    case 'VALIDATION_FAILED':
      return error.message || 'This message could not be sent. Try shortening it.';
    case 'NOT_FOUND':
      return 'This chat has ended. Try again to continue in a new chat.';
    default:
      return 'Your message was not sent. Please try again.';
  }
}
