import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
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
        theme_color: '#0d9488',
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
