import { Navigate } from 'react-router';
import { SessionLoading } from '../auth/SessionLoading';
import { readSessionHint } from '../auth/session-hint';
import { useAuth } from '../auth/useAuth';
import { WelcomePage } from '../pages/public/WelcomePage';
import { paths } from './paths';

/*
 * "/": the landing page for visitors, Home for anyone signed in.
 *   signed in                    -> Home (W05)
 *   restoring, was signed in     -> brief "Loading" (no flash of the landing page)
 *   restoring, no sign of a session, or signed out -> the landing page at once
 */
export function LandingRoute() {
  const { state } = useAuth();
  if (state.status === 'authenticated') return <Navigate to={paths.home} replace />;
  if (state.status === 'loading' && readSessionHint()) return <SessionLoading />;
  return <WelcomePage />;
}
