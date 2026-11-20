import { isApiError } from './errors';

/**
 * Plain-language message for a failed load or save. Never shows internals:
 * network failures get a connection hint, everything else the screen's own fallback.
 */
export function loadErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.status === 0) {
    return 'Could not reach CareLayer. Check your connection and try again.';
  }
  return fallback;
}
