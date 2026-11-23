import type { ProxyOptions } from 'vite';

/*
 * Optional same-origin proxy to apps/api, for testing on phones (H10).
 *
 * Why: a phone reaches the dev or preview server through an HTTPS tunnel (needed
 * for the service worker and "Add to Home Screen"). The app and the API then sit on
 * different sites, so the SameSite=Lax refresh cookie is not sent, and iPhone Safari
 * blocks cross-site cookies anyway. Sending API calls to `/api` on the app's own
 * origin keeps the cookie first-party with no backend change.
 *
 * Use: set VITE_API_URL=/api in .env.local. API_PROXY_TARGET (default
 * http://localhost:4000) is where the proxy forwards. The refresh cookie's
 * Path=/auth is rewritten to /api/auth so the browser sends it back.
 * Unused unless VITE_API_URL is /api: requests to other URLs never pass through it.
 */
export function apiProxy(): Record<string, ProxyOptions> {
  const target = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';
  return {
    '/api': {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api(?=\/|$)/, '') || '/',
      cookiePathRewrite: { '/auth': '/api/auth' },
    },
  };
}

/**
 * Extra Host names the dev/preview server accepts (e.g. a tunnel's
 * `abc.trycloudflare.com`), from DEV_ALLOWED_HOSTS (comma-separated). Vite
 * refuses unknown hosts by default.
 */
export function allowedHosts(): string[] | undefined {
  const hosts = process.env.DEV_ALLOWED_HOSTS?.split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return hosts?.length ? hosts : undefined;
}
