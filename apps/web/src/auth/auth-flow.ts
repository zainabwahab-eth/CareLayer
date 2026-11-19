import { AUTH_RULES, type AppAudience } from '@carelayer/shared';
import { isApiError } from '../api/errors';

/** Accounts are per app; this is the women's app. */
export const APP: AppAudience = 'women';

export const CODE_LENGTH = AUTH_RULES.codeLength;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NAME_MAX_LENGTH = 50;

/*
 * Router location state passed between the auth screens. It lives in the
 * browser history entry, so it survives a reload but never leaves the device.
 */

/** Optional state for Log in / Sign up / Before you start. */
export interface AuthEntryState {
  /** Internal path to return to after signing in (set by RequireAuth). */
  from?: string;
  /** Prefill the email field. */
  email?: string;
  /** Why she was sent to log in. */
  notice?: 'session-expired';
}

/** Required state for W04 Verify email. */
export interface VerifyEmailState {
  email: string;
  purpose: 'signup' | 'login';
  name?: string;
  /** ISO time the API says a resend is allowed. */
  resendAvailableAt: string;
  from?: string;
}

export function readEntryState(state: unknown): AuthEntryState {
  if (!state || typeof state !== 'object') return {};
  const { from, email, notice } = state as Record<string, unknown>;
  return {
    from: safeInternalPath(from),
    email: typeof email === 'string' ? email : undefined,
    notice: notice === 'session-expired' ? notice : undefined,
  };
}

export function readVerifyEmailState(state: unknown): VerifyEmailState | null {
  if (!state || typeof state !== 'object') return null;
  const { email, purpose, name, resendAvailableAt, from } = state as Record<string, unknown>;
  if (typeof email !== 'string' || !email) return null;
  if (purpose !== 'signup' && purpose !== 'login') return null;
  if (typeof resendAvailableAt !== 'string') return null;
  return {
    email,
    purpose,
    name: typeof name === 'string' ? name : undefined,
    resendAvailableAt,
    from: safeInternalPath(from),
  };
}

/** Only same-app paths ("/history"), never "//evil.example" or full URLs. */
export function safeInternalPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : undefined;
}

// ---- validation -------------------------------------------------------------

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address, like name@example.com.';
  return undefined;
}

export function validateName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Tell us what to call you. A nickname is fine.';
  if (name.length > NAME_MAX_LENGTH) return `Keep it under ${NAME_MAX_LENGTH} characters.`;
  return undefined;
}

// ---- errors -----------------------------------------------------------------

/** Plain-language message for a failed auth call. */
export function authErrorMessage(error: unknown): string {
  if (!isApiError(error)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'ACCOUNT_EXISTS':
      return 'You already have an account with this email.';
    case 'ACCOUNT_NOT_FOUND':
      return 'We could not find an account with this email.';
    case 'WRONG_APP':
      return 'This email is registered on the CareLayer app for health workers. Use a different email here.';
    case 'RATE_LIMITED':
      return 'Please wait a moment before asking for another code.';
    case 'CODE_INVALID': {
      const remaining = error.details?.attemptsRemaining;
      return typeof remaining === 'number'
        ? `That code is not right. You have ${remaining} ${remaining === 1 ? 'try' : 'tries'} left.`
        : 'That code is not right. Check the email and try again.';
    }
    case 'CODE_EXPIRED':
      return 'That code has expired. Ask for a new one below.';
    case 'CODE_ATTEMPTS_EXCEEDED':
      return 'Too many tries. Ask for a new code below.';
    case 'GOOGLE_TOKEN_INVALID':
      return 'Google sign-in did not work. Try again, or use your email.';
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}

/** True when an authenticated request failed because the session is gone. */
export function isSessionError(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === 'UNAUTHENTICATED' ||
      error.code === 'REFRESH_INVALID' ||
      error.code === 'REFRESH_REUSED')
  );
}

/** A short label for the sessions list, e.g. "Chrome on Android". No identifiers. */
export function describeDevice(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : undefined;
  return os ? `${browser} on ${os}` : browser;
}
