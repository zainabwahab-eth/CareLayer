import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/* Unit and component tests (jsdom). Kept apart from vite.config.ts so the PWA plugin never runs. */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@web': fileURLToPath(new URL('../web/src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
