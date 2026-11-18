import { useContext } from 'react';
import { ApiContext } from './api-context';
import type { CareLayerApi } from './types';

/** The active CareLayerApi (mock or HTTP). Screens should only talk to the API through this. */
export function useApi(): CareLayerApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
