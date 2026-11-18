import { apiConfig } from './config';
import { createHttpApi } from './http/http-api';
import { createMockApi } from './mock/mock-api';
import type { CareLayerApi } from './types';

/*
 * The one place that decides which API implementation the app uses.
 * VITE_USE_MOCK_API=true -> in-browser mock; otherwise -> apps/api at VITE_API_URL.
 * The flag is replaced at build time, so the unused implementation is dropped
 * from the bundle. Components get the instance through <ApiProvider> / useApi().
 */
function createApi(): CareLayerApi {
  // Read the env var inline (not via apiConfig) so the bundler can fold the
  // condition and drop the unused implementation.
  if (import.meta.env.VITE_USE_MOCK_API === 'true') {
    console.info('[CareLayer] Using the MOCK API (VITE_USE_MOCK_API=true). Data is sample data.');
    return createMockApi();
  }
  return createHttpApi(apiConfig.baseUrl);
}

export const api: CareLayerApi = createApi();

export { ApiError, hasErrorCode, isApiError } from './errors';
export type { CareLayerApi } from './types';
