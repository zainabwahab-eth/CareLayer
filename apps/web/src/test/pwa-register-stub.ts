import { useState } from 'react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

/*
 * Test stand-in for `virtual:pwa-register/react` (aliased in vitest.config.ts).
 * Tests replace it with vi.mock to simulate "a new version is ready".
 */
export function useRegisterSW(_options?: RegisterSWOptions) {
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async (_reloadPage?: boolean) => {},
  };
}
