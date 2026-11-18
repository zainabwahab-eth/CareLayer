import type { ReactNode } from 'react';
import { ApiContext } from './api-context';
import type { CareLayerApi } from './types';

/**
 * Makes the API available to the component tree. Pass a different `api`
 * (e.g. createMockApi({ latencyMs: 0 })) in tests or stories.
 */
export function ApiProvider({ api, children }: { api: CareLayerApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}
