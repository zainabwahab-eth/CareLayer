import { Navigate, Outlet, useLocation } from 'react-router';
import { readEntryState } from '../auth/auth-flow';
import { useAuth } from '../auth/useAuth';
import { paths } from './paths';

/*
 * Guard for the sign-up / log-in screens (W02-W04 + Log in).
 * Once she is signed in (already, or by finishing W04) she goes to where she
 * was heading, or Home. While the session is still being restored the screen
 * is shown straight away so there is no loading flash on public pages.
 */
export function GuestOnly() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'authenticated') {
    return <Navigate to={readEntryState(location.state).from ?? paths.home} replace />;
  }
  return <Outlet />;
}
