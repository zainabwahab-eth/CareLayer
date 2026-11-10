// Auth: passwordless (Google or email + 6-digit code). See docs/API_CONTRACT.md §2.
import type { Id, IsoDateTime } from './common.js';
import type { User } from './users.js';

/** Which app the person is signing into. Accounts are per app. */
export type AppAudience = 'women' | 'workers';

export type CodePurpose = 'signup' | 'login' | 'step_up';

export const AUTH_RULES = {
  codeLength: 6,
  codeTtlMinutes: 10,
  codeMaxAttempts: 5,
  accessTokenTtlMinutes: 15,
  refreshTtlDays: { women: 90, workers: 30 },
  stepUpTtlMinutes: 5,
} as const;

// POST /auth/code/request
export interface RequestCodeBody {
  email: string;
  purpose: CodePurpose;
  app: AppAudience;
  /** Required when purpose = "signup". Women: "What should we call you?". Workers: full name as on licence. */
  name?: string;
}
export interface RequestCodeResponse {
  sent: true;
  /** Earliest time the client may ask for a resend. */
  resendAvailableAt: IsoDateTime;
}

// POST /auth/code/verify
export interface VerifyCodeBody {
  email: string;
  code: string;
  purpose: Exclude<CodePurpose, 'step_up'>;
  app: AppAudience;
  name?: string;
  /** Human label for the sessions list, e.g. "iPhone Safari". */
  deviceName?: string;
}

// POST /auth/google
export interface GoogleAuthBody {
  idToken: string;
  mode: 'signup' | 'login';
  app: AppAudience;
  name?: string;
  deviceName?: string;
}

/** Returned by verify, google and refresh. The refresh token is ONLY in the httpOnly cookie. */
export interface AuthTokensResponse {
  accessToken: string;
  accessTokenExpiresAt: IsoDateTime;
  user: User;
}

// POST /auth/step-up
export interface StepUpBody {
  code: string;
}
export interface StepUpResponse {
  /** Send as header `X-Step-Up-Token` on withdrawals and payout address changes. */
  stepUpToken: string;
  expiresAt: IsoDateTime;
}

// GET /auth/sessions
export interface SessionInfo {
  id: Id;
  deviceName: string | null;
  createdAt: IsoDateTime;
  lastUsedAt: IsoDateTime;
  current: boolean;
}

// POST /auth/agent-tokens  (women only)
// A revocable token the MCP server (Claude) uses to act for her, bound by her MCP spending
// settings. Shown once. OPEN QUESTION (v0): token vs OAuth for MCP; token is simplest.
export interface CreateAgentTokenBody {
  label: string;
}
export interface CreateAgentTokenResponse {
  id: Id;
  label: string;
  /** Shown once. Stored hashed server-side. */
  token: string;
  createdAt: IsoDateTime;
}
