/**
 * Runtime API configuration from Vite env (see apps/web/.env.example).
 * VITE_USE_MOCK_API is read directly in api/index.ts so the unused client is tree-shaken.
 */
export const apiConfig = {
  baseUrl: (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, ''),
} as const;
