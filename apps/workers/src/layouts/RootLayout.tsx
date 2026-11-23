import { Outlet, ScrollRestoration } from 'react-router';

/** Wraps every route: skip link and scroll restoration. */
export function RootLayout() {
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
