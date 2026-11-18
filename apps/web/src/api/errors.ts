import type { ApiErrorBody, ApiErrorCode } from '@carelayer/shared';

/**
 * Every failed API call rejects with this, from both the mock and the HTTP client.
 * `code` is the contract's ApiErrorCode, so screens can branch on it
 * (e.g. CODE_INVALID -> show attemptsRemaining) without caring which client is active.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static fromBody(status: number, body: ApiErrorBody): ApiError {
    return new ApiError(status, body.error.code, body.error.message, body.error.details);
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Narrow an unknown rejection to a specific contract error code. */
export function hasErrorCode(error: unknown, code: ApiErrorCode): error is ApiError {
  return isApiError(error) && error.code === code;
}
