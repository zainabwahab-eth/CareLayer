import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/apple-touch-icon-180x180.png'],
      manifest: {
        name: 'CareLayer',
        short_name: 'CareLayer',
        description: 'Ask health questions privately. Get answers from verified health workers.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#7c3aed',
        background_color: '#ffffff',
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
