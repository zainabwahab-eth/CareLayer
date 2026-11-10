// Users and settings. See docs/API_CONTRACT.md §3.
import type { Id, IsoDateTime } from './common.js';

export type UserRole = 'woman' | 'worker' | 'admin';

export interface User {
  id: Id;
  role: UserRole;
  /** Women: what we call her. Workers: full name as on licence. */
  displayName: string;
  email: string;
  createdAt: IsoDateTime;
}

export type Appearance = 'system' | 'light' | 'dark';

export type QuickExitTarget = 'google' | 'weather' | 'news';

export const QUICK_EXIT_URLS: Record<QuickExitTarget, string> = {
  google: 'https://www.google.com',
  weather: 'https://weather.com',
  news: 'https://www.bbc.com/news',
};

export interface UserSettings {
  appearance: Appearance;
  /** Women only. */
  quickExitTarget: QuickExitTarget;
  /** Women only. Max price per answer without asking her first. Naira minor units. */
  spendingLimitPerAnswerKobo: number;
  /** Women only. Separate limit for payments made through Claude (MCP). */
  mcpSpendingLimitPerAnswerKobo: number;
  /** Women only. If true, the MCP server asks before every payment. */
  mcpAskBeforeEachPayment: boolean;
}

// PATCH /me
export interface UpdateMeBody {
  displayName?: string;
}

// PATCH /me/settings
export type UpdateSettingsBody = Partial<UserSettings>;
