import type { AuthTokensResponse } from '@carelayer/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isApiError } from '../api/errors';
import { useApi } from '../api/useApi';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';

/*
 * Holds who is signed in.
 *
 * On start it asks the API to restore the session (POST /auth/refresh, which
 * uses the httpOnly refresh cookie; the mock uses sessionStorage instead).
 * The access token itself stays inside the API client, never in React state
 * or storage. Screens read the state through useAuth().
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, reason: 'none' });
  const signedIn = useRef(false);
  useEffect(() => {
    signedIn.current = state.status === 'authenticated';
  }, [state.status]);

  useEffect(() => {
    let cancelled = false;
    const restore = () => {
      // Signed in meanwhile (e.g. on Log in): nothing to restore, and a second
      // refresh would only rotate the cookie again.
      if (signedIn.current) {
        window.removeEventListener('online', restore);
        return Promise.resolve();
      }
      return api.auth.refresh().then(
        ({ user }) => {
          if (cancelled) return;
          window.removeEventListener('online', restore);
          // Only while she is still waiting to be let in: never after she signed
          // in another way, chose Log out (possibly offline), or was signed out.
          setState((current) =>
            current.status === 'loading' ||
            (current.status === 'unauthenticated' && current.reason === 'none')
              ? { status: 'authenticated', user, reason: 'none' }
              : current,
          );
        },
        (error: unknown) => {
          if (cancelled) return;
          // Unreachable (offline, opened from the home screen): keep the
          // session cookie and try again when the connection comes back.
          if (!(isApiError(error) && error.status === 0)) {
            window.removeEventListener('online', restore);
          }
          // Either way she is signed out for now.
          setState((current) =>
            current.status === 'loading'
              ? { status: 'unauthenticated', user: null, reason: 'none' }
              : current,
          );
        },
      );
    };
    window.addEventListener('online', restore);
    void restore();
    return () => {
      cancelled = true;
      window.removeEventListener('online', restore);
    };
  }, [api]);

  const completeSignIn = useCallback((tokens: AuthTokensResponse) => {
    setState({ status: 'authenticated', user: tokens.user, reason: 'none' });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Already signed out on the server, or offline. Sign out locally regardless.
    } finally {
      setState({ status: 'unauthenticated', user: null, reason: 'logout' });
    }
  }, [api]);

  const sessionExpired = useCallback(() => {
    setState((current) =>
      current.status === 'authenticated'
        ? { status: 'unauthenticated', user: null, reason: 'expired' }
        : current,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, completeSignIn, logout, sessionExpired }),
    [state, completeSignIn, logout, sessionExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
