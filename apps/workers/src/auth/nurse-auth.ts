import type { AppAudience } from '@carelayer/shared';
import { hasErrorCode } from '@web/api/errors';
import { authErrorMessage } from '@web/auth/auth-flow';

/*
 * Nurse-app specifics on top of apps/web's auth helpers (auth-flow.ts):
 * validateEmail, normaliseEmail, readEntryState, readVerifyEmailState,
 * describeDevice and isSessionError are reused as they are.
 */

/** Accounts are per app; this is the health workers' app. */
export const APP: AppAudience = 'nurses';

/** Contract §2: nurse names are at most 100 characters. */
export const FULL_NAME_MAX_LENGTH = 100;

/** "Full name, as on your licence". The profile needs at least 2 characters. */
export function validateFullName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Enter your full name, as on your licence.';
  if (name.length < 2) return 'Enter your full name, as on your licence.';
  if (name.length > FULL_NAME_MAX_LENGTH) {
    return `Use ${FULL_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

/** apps/web's messages, with the one that names the other app turned round. */
export function nurseAuthErrorMessage(error: unknown): string {
  if (hasErrorCode(error, 'WRONG_APP')) {
    return 'This email is registered on the CareLayer app for women. Use a different email here.';
  }
  return authErrorMessage(error);
}
