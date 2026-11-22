// LLM outages become one clear, retryable API error. The red-flag list has already run by the
// time the LLM is called, so an outage never hides a fixed-list emergency.
import { AppError } from '../../lib/errors.js';
import { LlmUnavailableError } from './client.js';

export function llmToAppError(err: unknown): unknown {
  if (!(err instanceof LlmUnavailableError)) return err;
  return new AppError(
    503,
    'SERVICE_UNAVAILABLE',
    'The assistant is not available right now. Please try again in a moment. If this is urgent, ' +
      'go to the nearest hospital or clinic.',
    {
      retryable: err.kind !== 'not_configured' && err.kind !== 'auth',
      reason: err.kind,
    },
  );
}
