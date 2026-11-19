import type { AuthTokensResponse } from '@carelayer/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    api.auth.refresh().then(
      ({ user }) => {
        if (!cancelled) setState({ status: 'authenticated', user, reason: 'none' });
      },
      () => {
        // No session (or the API is unreachable): treat as signed out.
        if (!cancelled) setState({ status: 'unauthenticated', user: null, reason: 'none' });
      },
    );
    return () => {
      cancelled = true;
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
