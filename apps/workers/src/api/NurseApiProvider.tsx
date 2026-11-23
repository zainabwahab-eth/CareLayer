import type { ReactNode } from 'react';
import { NurseApiContext } from './api-context';
import type { NurseApi } from './types';

/** Makes the API available to the tree. Tests pass createMockNurseApi({ latencyMs: 0 }). */
export function NurseApiProvider({ api, children }: { api: NurseApi; children: ReactNode }) {
  return <NurseApiContext.Provider value={api}>{children}</NurseApiContext.Provider>;
}
