import { Navigate, Outlet, useLocation } from 'react-router';
import type { AuthEntryState } from '../auth/auth-flow';
import { SessionLoading } from '../auth/SessionLoading';
import { useAuth } from '../auth/useAuth';
import { paths } from './paths';

/*
 * Guard for the authenticated area.
 *   loading         -> brief "Loading" screen while the session is restored
 *   signed out      -> Log in, remembering where she was going
 *   just logged out -> Welcome (she chose to leave; don't ask her to log in again)
 * Do not move the emergency screen behind this guard: emergencies never wait.
 */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <SessionLoading />;

  if (state.status === 'unauthenticated') {
    if (state.reason === 'logout') return <Navigate to={paths.welcome} replace />;
    const entry: AuthEntryState = {
      from: `${location.pathname}${location.search}${location.hash}`,
      notice: state.reason === 'expired' ? 'session-expired' : undefined,
    };
    return <Navigate to={paths.logIn} replace state={entry} />;
  }

  return <Outlet />;
}
