import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { allowedHosts, apiProxy } from '../web/vite.api-proxy';

/*
 * `@web/*` = apps/web/src: the nurse app reuses the women's app's design-system
 * components, auth helpers and API error type rather than copying them
 * (decided in H9; a later move to packages/ui is a search-and-replace).
 */
const webSrc = fileURLToPath(new URL('../web/src', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@web': webSrc } },
  // proxy + allowedHosts: phone testing through a tunnel (see apps/web/vite.api-proxy.ts).
  server: { port: 5174, strictPort: true, proxy: apiProxy(), allowedHosts: allowedHosts() },
  preview: { port: 5174, strictPort: true, proxy: apiProxy(), allowedHosts: allowedHosts() },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/apple-touch-icon-180x180.png'],
      manifest: {
        name: 'CareLayer for Health Workers',
        short_name: 'CareLayer HW',
        description: "Answer women's health questions and earn per answer.",
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0f4a43', // --color-primary
        background_color: '#f3f5f2', // --color-canvas
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Service worker is off in dev to avoid stale caches. Test PWA with build + preview.
      devOptions: { enabled: false },
    }),
  ],
});
