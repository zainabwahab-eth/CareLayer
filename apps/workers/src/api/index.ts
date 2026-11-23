import { createHttpNurseApi } from './http-api';
import { createMockNurseApi } from './mock-api';
import type { NurseApi } from './types';

/*
 * The API the nurse app uses: VITE_USE_MOCK_API=true -> in-browser mock,
 * otherwise apps/api at VITE_API_URL (see apps/workers/.env.example).
 */
function createApi(): NurseApi {
  if (import.meta.env.VITE_USE_MOCK_API === 'true') {
    console.info(
      '[CareLayer HW] Using the MOCK API (VITE_USE_MOCK_API=true). Log in as amaka@example.com ' +
        '(approved), funmi@example.com (in review) or hauwa@example.com (rejected), or sign up ' +
        'with any email; the code is always 123456.',
    );
    return createMockNurseApi();
  }
  const baseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  if (import.meta.env.DEV) {
    // Says which API is in use, so "Could not reach CareLayer" is easy to trace in development
    // (usually apps/api not running, or no apps/workers/.env.local with VITE_USE_MOCK_API=true).
    console.info(
      `[CareLayer HW] Using the REAL API at ${baseUrl}. For the mock, set ` +
        'VITE_USE_MOCK_API=true in apps/workers/.env.local (copy .env.example) and restart.',
    );
  }
  return createHttpNurseApi(baseUrl);
}

export const api: NurseApi = createApi();
