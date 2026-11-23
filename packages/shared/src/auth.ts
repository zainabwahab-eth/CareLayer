// Auth: passwordless (Google or email + 6-digit code). See docs/API_CONTRACT.md §2.
import type { Id, IsoDateTime } from './common.js';
import type { User } from './users.js';

/**
 * Which app the person is signing into. Accounts are per app (unique on email + role).
 * `admin` can only log in (admins are created by the seed, never by sign-up).
 */
export type AppAudience = 'women' | 'nurses' | 'admin';

export type CodePurpose = 'signup' | 'login' | 'step_up';

export const AUTH_RULES = {
  codeLength: 6,
  codeTtlMinutes: 10,
  codeMaxAttempts: 5,
  /** A new code can be requested 45 s after the last one... */
  resendAfterSeconds: 45,
  /** ...and at most 5 times per hour (per email, app and purpose). */
  maxCodesPerHour: 5,
  accessTokenTtlMinutes: 15,
  /** Sliding refresh-session lifetime. */
  refreshTtlDays: { women: 90, nurses: 30, admin: 1 },
  /**
   * A refresh token presented again within this many seconds of its first use is treated as a
   * concurrent refresh (e.g. two tabs), not theft: the session is kept. After it, reuse revokes
   * the whole session.
   */
  refreshReuseGraceSeconds: 10,
  /** Withdrawals and payout address changes need a code verified this recently. */
  stepUpTtlMinutes: 5,
} as const;

// POST /auth/code/request
export interface RequestCodeBody {
  email: string;
  purpose: CodePurpose;
  app: AppAudience;
  /** Required when purpose = "signup". Women: "What should we call you?". Nurses: full name as on licence. */
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

// POST /auth/step-up  (bearer; the code comes from /auth/code/request with purpose "step_up")
export interface StepUpBody {
  code: string;
}
/**
 * The current session is marked as freshly verified. Withdrawals and payout address changes on
 * this session are allowed until `freshUntil` (5 minutes). No separate token to send.
 */
export interface StepUpResponse {
  freshUntil: IsoDateTime;
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
  /** Shown once. Stored hashed server-side. Starts with AGENT_TOKEN_PREFIX. */
  token: string;
  createdAt: IsoDateTime;
}

/** Agent tokens (Claude via apps/mcp). Every token starts with this, so it is recognisable. */
export const AGENT_TOKEN_PREFIX = 'clat_';
/** Active (not revoked) agent tokens per woman. */
export const MAX_AGENT_TOKENS = 5;

// GET /auth/agent-tokens  (woman, signed in: an agent token cannot list or create tokens)
export interface AgentTokenSummary {
  id: Id;
  label: string;
  createdAt: IsoDateTime;
  /** Last time Claude used it (updated at most once a minute). */
  lastUsedAt: IsoDateTime | null;
}
