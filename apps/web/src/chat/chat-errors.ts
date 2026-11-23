import { isApiError } from '../api/errors';

const NOT_SENT = 'Your message was not sent. Please try again.';
const UNREACHABLE = 'Could not reach CareLayer. Check your connection and try again.';

/** Plain-language message for a failed chat send. Never shows internals. */
export function chatErrorMessage(error: unknown): string {
  if (!isApiError(error)) return NOT_SENT;
  // Status 0: offline, unreachable or timed out. The client's message says which.
  if (error.status === 0) return error.message || UNREACHABLE;
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'You are sending messages quickly. Wait a moment, then try again.';
    case 'VALIDATION_FAILED':
      return error.message || 'This message could not be sent. Try shortening it.';
    case 'SERVICE_UNAVAILABLE':
      // The API's message includes what to do if it is urgent (contract §7, 503).
      return error.message || 'The assistant is not available right now. Please try again.';
    default:
      return NOT_SENT;
  }
}
