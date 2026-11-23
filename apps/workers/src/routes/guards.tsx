import type { VerificationStatus } from '@carelayer/shared';
import { readEntryState, type AuthEntryState } from '@web/auth/auth-flow';
import { loadErrorMessage } from '@web/api/error-message';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { FullScreenError, FullScreenLoading } from '../components/FullScreenStatus';
import { homePathFor } from '../onboarding/onboarding';
import { ProfileProvider } from '../onboarding/ProfileProvider';
import { useProfile } from '../onboarding/profile-context';
import { paths } from './paths';

/** Join, sign up, log in, verify: signed-in nurses are sent on. */
export function GuestOnly() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'authenticated') {
    return <Navigate to={readEntryState(location.state).from ?? paths.start} replace />;
  }
  return <Outlet />;
}

/** Signed-in area. Loads her profile for every screen inside. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <FullScreenLoading />;
  if (state.status === 'unauthenticated') {
    if (state.reason === 'logout') return <Navigate to={paths.join} replace />;
    const entry: AuthEntryState = {
      from: `${location.pathname}${location.search}`,
      notice: state.reason === 'expired' ? 'session-expired' : undefined,
    };
    return <Navigate to={paths.logIn} replace state={entry} />;
  }
  return (
    <ProfileProvider key={state.user.id}>
      <RequireProfile />
    </ProfileProvider>
  );
}

function RequireProfile() {
  const { state, reload } = useProfile();
  const { logout } = useAuth();
  if (state.status === 'loading') return <FullScreenLoading />;
  if (state.status === 'error') {
    return (
      <FullScreenError
        message={loadErrorMessage(state.error, 'We could not load your profile. Please try again.')}
        onRetry={() => void reload()}
        onLogout={() => void logout()}
      />
    );
  }
  return <Outlet />;
}

/** `/start`: the right screen for her verification status and progress. */
export function StartRedirect() {
  const { state } = useProfile();
  if (state.status !== 'ready') return null;
  return <Navigate to={homePathFor(state.profile)} replace />;
}

/** Only for these statuses; anyone else goes to where she belongs. */
export function RequireStatus({ allow }: { allow: readonly VerificationStatus[] }) {
  const { state } = useProfile();
  if (state.status !== 'ready') return null;
  if (!allow.includes(state.profile.verificationStatus)) {
    return <Navigate to={homePathFor(state.profile)} replace />;
  }
  return <Outlet />;
}
