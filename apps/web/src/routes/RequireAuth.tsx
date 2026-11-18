import { Outlet } from 'react-router';

/*
 * Guard for the authenticated area.
 *
 * Placeholder for Phase 0: authentication is not implemented yet, so every
 * visitor is let through. When the auth phase lands, read the session here and
 * redirect to paths.welcome (keeping the intended URL) when there is none.
 * Do not move the emergency screen behind this guard: emergencies never wait.
 */
export function RequireAuth() {
  return <Outlet />;
}
