import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * Unit and component tests (jsdom). Kept apart from vite.config.ts so the
 * PWA plugin never runs in tests; its virtual module is stubbed instead.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwa-register-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
