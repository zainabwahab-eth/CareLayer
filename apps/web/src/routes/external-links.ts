/*
 * Links that leave the women's app. Internal routes live in paths.ts.
 */
export const externalLinks = {
  /** Health workers' app (apps/workers). "For nurses and midwives" on W01. */
  workersApp: import.meta.env.VITE_WORKERS_APP_URL ?? 'http://localhost:5174',
} as const;
