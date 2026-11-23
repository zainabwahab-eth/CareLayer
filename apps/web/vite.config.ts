import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { allowedHosts, apiProxy } from './vite.api-proxy';

export default defineConfig({
  // proxy + allowedHosts: phone testing through a tunnel (see vite.api-proxy.ts, README).
  server: { port: 5173, strictPort: true, proxy: apiProxy(), allowedHosts: allowedHosts() },
  preview: { port: 5173, strictPort: true, proxy: apiProxy(), allowedHosts: allowedHosts() },
  plugins: [
    react(),
    VitePWA({
      /*
       * Updates (src/pwa/UpdatePrompt.tsx): a new version waits until she taps
       * "Update now" or closes every CareLayer tab. Never reloads by itself,
       * so a chat in progress is not wiped. Registered by useRegisterSW there.
       */
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'CareLayer',
        short_name: 'CareLayer',
        description: 'Ask health questions privately. Get answers from verified health workers.',
        lang: 'en',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        categories: ['health', 'medical'],
        theme_color: '#0f4a43', // --color-primary
        background_color: '#f3f5f2', // --color-canvas
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      /*
       * Offline: the app shell (HTML, JS, CSS, icons) is precached, so CareLayer
       * opens with no connection and Quick exit always works. Every route falls
       * back to index.html and the router takes it from there.
       *
       * Privacy: API responses are NOT cached (questions, answers, wallet,
       * account stay out of Cache Storage on a shared phone). The one exception
       * is GET /emergency: public, the same for everyone, and most useful offline.
       */
      workbox: {
        // Icons and the manifest are added by the plugin (manifest icons + includeAssets).
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallback: '/index.html',
        // Dev gallery and real files (anything with an extension) are not app routes.
        navigateFallbackDenylist: [/^\/dev\//, /\/[^/?]+\.[^/]+$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'carelayer-font-styles' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'carelayer-fonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            // GET /emergency on the API (not the /emergency screen itself).
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              request.mode !== 'navigate' &&
              url.pathname.endsWith('/emergency'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'carelayer-emergency',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 2, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
      // Service worker is off in dev to avoid stale caches. Test PWA with build + preview.
      devOptions: { enabled: false },
    }),
  ],
});
