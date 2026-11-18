import { Outlet, ScrollRestoration } from 'react-router';
import { useQuickExitShortcut } from '../components/QuickExit/useQuickExitShortcut';

/** Wraps every route: skip link, quick-exit shortcut (Esc Esc) and scroll restoration. */
export function RootLayout() {
  useQuickExitShortcut();
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
