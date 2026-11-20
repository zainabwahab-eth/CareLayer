import { useEffect } from 'react';
import { isSessionError } from './auth-flow';
import { useAuth } from './useAuth';

/**
 * If `error` means the session has ended on the server, sign out locally so
 * RequireAuth sends her to Log in, instead of leaving a screen stuck on an error.
 */
export function useSessionGuard(...errors: unknown[]) {
  const { sessionExpired } = useAuth();
  const ended = errors.some(isSessionError);
  useEffect(() => {
    if (ended) sessionExpired();
  }, [ended, sessionExpired]);
}
