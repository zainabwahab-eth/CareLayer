import { isApiError } from '../../../api/errors';

const UNREACHABLE = 'Could not reach CareLayer. Check your connection and try again.';

/**
 * Plain-language message for a failed step in the send flow. The API's 4xx messages
 * are written for her (contract §0), so they are shown as is; anything else gets the
 * screen's own fallback. Never shows internals.
 */
export function flowErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback;
  if (error.status === 0) return error.message || UNREACHABLE;
  if (error.status === 503 && error.message) return error.message;
  if (error.status >= 400 && error.status < 500 && error.code !== 'UNAUTHENTICATED') {
    return error.message || fallback;
  }
  return fallback;
}
