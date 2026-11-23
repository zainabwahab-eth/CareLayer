import type { AuthTokensResponse } from '@carelayer/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNurseApi } from '../api/api-context';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';

/*
 * Who is signed in. On start it restores the session (POST /auth/refresh with
 * the httpOnly cookie). The access token stays inside the API client, never in
 * React state or storage. Same shape as apps/web's AuthProvider.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useNurseApi();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, reason: 'none' });

  useEffect(() => {
    let cancelled = false;
    api.auth.refresh().then(
      ({ user }) => {
        if (cancelled) return;
        setState(
          user.role === 'nurse'
            ? { status: 'authenticated', user, reason: 'none' }
            : { status: 'unauthenticated', user: null, reason: 'none' },
        );
      },
      () => {
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
      // Already signed out on the server, or offline. Sign out here regardless.
    } finally {
      setState({ status: 'unauthenticated', user: null, reason: 'logout' });
    }
  }, [api]);

  const logoutAll = useCallback(async () => {
    await api.auth.logoutAll();
    try {
      // Clears the refresh cookie; the session itself is already revoked.
      await api.auth.logout();
    } catch {
      // Expected once the session is gone.
    }
    setState({ status: 'unauthenticated', user: null, reason: 'logout' });
  }, [api]);

  const sessionExpired = useCallback(() => {
    setState((current) =>
      current.status === 'authenticated'
        ? { status: 'unauthenticated', user: null, reason: 'expired' }
        : current,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, completeSignIn, logout, logoutAll, sessionExpired }),
    [state, completeSignIn, logout, logoutAll, sessionExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
