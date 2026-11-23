import type { NurseProfile } from '@carelayer/shared';
import { isSessionError } from '@web/auth/auth-flow';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNurseApi } from '../api/api-context';
import { useAuth } from '../auth/useAuth';
import { ProfileContext, type ProfileContextValue, type ProfileState } from './profile-context';

/** Loads her own profile (GET /nurse/profile) once she is signed in. */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const api = useNurseApi();
  const { sessionExpired } = useAuth();
  const [state, setState] = useState<ProfileState>({
    status: 'loading',
    profile: null,
    error: null,
  });

  const load = useCallback(async () => {
    try {
      const profile = await api.nurse.getProfile();
      setState({ status: 'ready', profile, error: null });
    } catch (error) {
      if (isSessionError(error)) sessionExpired();
      setState((current) =>
        // Keep showing what she had if a background refresh fails.
        current.status === 'ready' ? current : { status: 'error', profile: null, error },
      );
    }
  }, [api, sessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const setProfile = useCallback(
    (next: NurseProfile | ((current: NurseProfile) => NurseProfile)) => {
      setState((current) => {
        if (typeof next !== 'function') return { status: 'ready', profile: next, error: null };
        return current.status === 'ready'
          ? { status: 'ready', profile: next(current.profile), error: null }
          : current;
      });
    },
    [],
  );

  const reload = useCallback(async () => {
    setState((current) =>
      current.status === 'error' ? { status: 'loading', profile: null, error: null } : current,
    );
    await load();
  }, [load]);

  const value = useMemo<ProfileContextValue>(
    () => ({ state, reload, setProfile }),
    [state, reload, setProfile],
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
