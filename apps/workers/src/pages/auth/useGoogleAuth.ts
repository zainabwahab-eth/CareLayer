import { describeDevice } from '@web/auth/auth-flow';
import { googleSignIn } from '@web/auth/google';
import { useState } from 'react';
import { useNurseApi } from '../../api/api-context';
import { APP } from '../../auth/nurse-auth';
import { useAuth } from '../../auth/useAuth';

/**
 * "Continue with Google" (POST /auth/google, app "nurses"). Only offered where
 * apps/web's googleSignIn is available (mock builds until Google Identity
 * Services is wired up). On success GuestOnly sends her on.
 */
export function useGoogleAuth(mode: 'signup' | 'login') {
  const api = useNurseApi();
  const { completeSignIn } = useAuth();
  const [pending, setPending] = useState(false);

  const start = async (name?: string): Promise<{ error?: unknown }> => {
    setPending(true);
    try {
      const idToken = await googleSignIn.getIdToken();
      const tokens = await api.auth.signInWithGoogle({
        idToken,
        mode,
        app: APP,
        name: name?.trim() || undefined,
        deviceName: describeDevice(),
      });
      completeSignIn(tokens);
      return {};
    } catch (error) {
      setPending(false);
      return { error };
    }
  };

  return { available: googleSignIn.available, pending, start };
}
