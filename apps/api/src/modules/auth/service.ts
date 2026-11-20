// Passwordless auth: email codes, Google, sessions with rotating refresh tokens.
// Rules: docs/TASKS.md section 2 "Accounts and auth" and AUTH_RULES in packages/shared.
//
// Concurrency: every "check then change" on a code or token is a conditional updateMany
// (WHERE ... AND attempts < max / usedAt IS NULL), so two parallel requests cannot both get past
// the attempt limit or both consume the same code.
import { AUTH_RULES, type AppAudience, type CodePurpose } from '@carelayer/shared';
import type { AuthConfig } from '../../config.js';
import type { Db } from '../../db.js';
import {
  Prisma,
  type CodePurpose as DbCodePurpose,
  type User,
  type UserRole,
} from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { toUserDto } from '../users/dto.js';
import { generateCode, generateOpaqueToken, keyedHash, safeEqualHex } from './crypto.js';
import type { EmailSender } from './email.js';
import type { GoogleVerifier } from './google.js';
import { API_ROLE, APP_BY_ROLE, ROLE_BY_APP } from './roles.js';
import { signAccessToken } from './tokens.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface AuthDeps {
  db: Db;
  config: AuthConfig;
  email: EmailSender;
  google: GoogleVerifier | undefined;
  logger: Logger;
  now: () => Date;
}

/** Signed in: the access token goes in the body, the refresh token in the httpOnly cookie. */
export interface SignInResult {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: User;
  sessionId: string;
}

/** API purpose -> database enum. */
const DB_PURPOSE = {
  signup: 'SIGNUP',
  login: 'LOGIN',
  step_up: 'STEP_UP',
} as const satisfies Record<CodePurpose, DbCodePurpose>;

const NAME_MAX: Record<UserRole, number> = { WOMAN: 50, NURSE: 100, ADMIN: 100 };

const sessionTtlMs = (role: UserRole) => AUTH_RULES.refreshTtlDays[APP_BY_ROLE[role]] * DAY;

const codeHash = (d: AuthDeps, email: string, role: UserRole, purpose: CodePurpose, code: string) =>
  keyedHash(d.config.pepper, 'code', email, role, purpose, code);

export const refreshTokenHash = (pepper: string, token: string) =>
  keyedHash(pepper, 'refresh', token);

function validName(role: UserRole, name: string | undefined): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) {
    const message =
      role === 'NURSE' ? 'Enter your full name, as on your licence.' : 'Tell us what to call you.';
    throw new AppError(400, 'VALIDATION_FAILED', message, { field: 'name' });
  }
  if (trimmed.length > NAME_MAX[role]) {
    throw new AppError(400, 'VALIDATION_FAILED', `Use ${NAME_MAX[role]} characters or fewer.`, {
      field: 'name',
      max: NAME_MAX[role],
    });
  }
  return trimmed;
}

function findUser(d: AuthDeps, email: string, role: UserRole) {
  return d.db.user.findUnique({ where: { email_role: { email, role } } });
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

export async function requestCode(
  d: AuthDeps,
  input: { email: string; purpose: CodePurpose; app: AppAudience; name?: string },
  auth: { userId: string } | null,
): Promise<{ resendAvailableAt: Date }> {
  const now = d.now();
  const role = ROLE_BY_APP[input.app];
  const { email, purpose } = input;

  if (purpose === 'signup' && role === 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Admin accounts cannot be created by sign-up.');
  }
  const user = await findUser(d, email, role);
  if (purpose === 'signup') {
    validName(role, input.name);
    if (user)
      throw new AppError(409, 'ACCOUNT_EXISTS', 'You already have an account. Log in instead.');
  } else if (purpose === 'login') {
    if (!user)
      throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'No account with that email. Sign up instead.');
  } else {
    if (!auth) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');
    if (!user || user.id !== auth.userId) {
      throw new AppError(403, 'FORBIDDEN', 'Codes to confirm it is you go to your own email only.');
    }
  }

  // Resend after 45 s, at most 5 per hour (per email + app + purpose).
  const recent = await d.db.emailCode.findMany({
    where: {
      email,
      role,
      purpose: DB_PURPOSE[purpose],
      createdAt: { gt: new Date(now.getTime() - HOUR) },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const resendGapMs = AUTH_RULES.resendAfterSeconds * SECOND;
  const last = recent[0];
  if (last && now.getTime() - last.createdAt.getTime() < resendGapMs) {
    const resendAvailableAt = new Date(last.createdAt.getTime() + resendGapMs);
    throw new AppError(429, 'RATE_LIMITED', 'Please wait a moment before asking for a new code.', {
      resendAvailableAt: resendAvailableAt.toISOString(),
      retryAfterSeconds: Math.ceil((resendAvailableAt.getTime() - now.getTime()) / SECOND),
    });
  }
  if (recent.length >= AUTH_RULES.maxCodesPerHour) {
    const oldest = recent[AUTH_RULES.maxCodesPerHour - 1]!;
    const resendAvailableAt = new Date(oldest.createdAt.getTime() + HOUR);
    throw new AppError(429, 'RATE_LIMITED', 'Too many codes requested. Try again later.', {
      resendAvailableAt: resendAvailableAt.toISOString(),
      retryAfterSeconds: Math.ceil((resendAvailableAt.getTime() - now.getTime()) / SECOND),
    });
  }

  const code = generateCode();
  await d.db.$transaction([
    // A new code replaces any earlier unused one.
    d.db.emailCode.updateMany({
      where: { email, role, purpose: DB_PURPOSE[purpose], consumedAt: null },
      data: { consumedAt: now },
    }),
    d.db.emailCode.create({
      data: {
        email,
        role,
        purpose: DB_PURPOSE[purpose],
        codeHash: codeHash(d, email, role, purpose, code),
        expiresAt: new Date(now.getTime() + AUTH_RULES.codeTtlMinutes * MINUTE),
        createdAt: now,
      },
    }),
  ]);

  try {
    await d.email.sendCode({
      to: email,
      code,
      purpose,
      expiresInMinutes: AUTH_RULES.codeTtlMinutes,
    });
  } catch (err) {
    d.logger.error('email_send_failed', {
      purpose,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(
      503,
      'SERVICE_UNAVAILABLE',
      'We could not send the email. Please try again.',
    );
  }
  return { resendAvailableAt: new Date(now.getTime() + resendGapMs) };
}

/** Checks a code and consumes it. Throws the contract errors; returns only on success. */
async function consumeCode(
  d: AuthDeps,
  email: string,
  role: UserRole,
  purpose: CodePurpose,
  code: string,
): Promise<void> {
  const now = d.now();
  const max = AUTH_RULES.codeMaxAttempts;
  const latest = await d.db.emailCode.findFirst({
    where: { email, role, purpose: DB_PURPOSE[purpose], consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest) {
    throw new AppError(400, 'CODE_INVALID', 'That code is not right. Ask for a new one.', {
      attemptsRemaining: 0,
    });
  }
  if (latest.expiresAt <= now) {
    throw new AppError(410, 'CODE_EXPIRED', 'That code has expired. Ask for a new one.');
  }
  if (latest.attempts >= max) {
    throw new AppError(429, 'CODE_ATTEMPTS_EXCEEDED', 'Too many wrong tries. Ask for a new code.');
  }

  if (!safeEqualHex(codeHash(d, email, role, purpose, code), latest.codeHash)) {
    const bumped = await d.db.emailCode.updateMany({
      where: { id: latest.id, consumedAt: null, attempts: { lt: max } },
      data: { attempts: { increment: 1 } },
    });
    const after = await d.db.emailCode.findUniqueOrThrow({ where: { id: latest.id } });
    const attemptsRemaining = Math.max(0, max - after.attempts);
    if (bumped.count === 0 || attemptsRemaining === 0) {
      throw new AppError(
        429,
        'CODE_ATTEMPTS_EXCEEDED',
        'Too many wrong tries. Ask for a new code.',
      );
    }
    throw new AppError(400, 'CODE_INVALID', 'That code is not right.', { attemptsRemaining });
  }

  const used = await d.db.emailCode.updateMany({
    where: { id: latest.id, consumedAt: null, attempts: { lt: max }, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (used.count !== 1) {
    throw new AppError(400, 'CODE_INVALID', 'That code was already used. Ask for a new one.', {
      attemptsRemaining: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Accounts and sessions
// ---------------------------------------------------------------------------

async function createUser(
  d: AuthDeps,
  input: { role: UserRole; email: string; name: string; googleSub?: string },
): Promise<User> {
  const now = d.now();
  try {
    return await d.db.user.create({
      data: {
        role: input.role,
        email: input.email,
        displayName: input.name,
        googleSub: input.googleSub ?? null,
        createdAt: now,
        settings: { create: {} },
        notificationPreference: { create: {} },
        ...(input.role === 'NURSE' ? { nurseProfile: { create: { fullName: input.name } } } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'ACCOUNT_EXISTS', 'You already have an account. Log in instead.');
    }
    throw err;
  }
}

async function issueRefreshToken(d: AuthDeps, sessionId: string) {
  const token = generateOpaqueToken();
  await d.db.refreshToken.create({
    data: { sessionId, tokenHash: refreshTokenHash(d.config.pepper, token), createdAt: d.now() },
  });
  return token;
}

async function startSession(
  d: AuthDeps,
  user: User,
  deviceName: string | undefined,
): Promise<SignInResult> {
  const now = d.now();
  const refreshExpiresAt = new Date(now.getTime() + sessionTtlMs(user.role));
  const session = await d.db.session.create({
    data: {
      userId: user.id,
      deviceName: deviceName?.trim().slice(0, 100) || null,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: refreshExpiresAt,
    },
  });
  const refreshToken = await issueRefreshToken(d, session.id);
  const access = await signAccessToken(
    { userId: user.id, role: API_ROLE[user.role], sessionId: session.id },
    d.config.jwtAccessSecret,
    now,
  );
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken,
    refreshExpiresAt,
    user,
    sessionId: session.id,
  };
}

export async function verifyCodeAndSignIn(
  d: AuthDeps,
  input: {
    email: string;
    code: string;
    purpose: 'signup' | 'login';
    app: AppAudience;
    name?: string;
    deviceName?: string;
  },
): Promise<SignInResult> {
  const role = ROLE_BY_APP[input.app];
  if (input.purpose === 'signup' && role === 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Admin accounts cannot be created by sign-up.');
  }
  // Check everything that does not depend on the code first, so a bad request never burns it.
  const existing = await findUser(d, input.email, role);
  let name = '';
  if (input.purpose === 'signup') {
    name = validName(role, input.name);
    if (existing)
      throw new AppError(409, 'ACCOUNT_EXISTS', 'You already have an account. Log in instead.');
  } else if (!existing) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'No account with that email. Sign up instead.');
  }

  await consumeCode(d, input.email, role, input.purpose, input.code);

  const user = existing ?? (await createUser(d, { role, email: input.email, name }));
  d.logger.info('auth_signed_in', { method: 'code', purpose: input.purpose, role: API_ROLE[role] });
  return startSession(d, user, input.deviceName);
}

export async function googleSignIn(
  d: AuthDeps,
  input: {
    idToken: string;
    mode: 'signup' | 'login';
    app: AppAudience;
    name?: string;
    deviceName?: string;
  },
): Promise<SignInResult> {
  if (!d.google) {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Google sign-in is not available right now.');
  }
  const role = ROLE_BY_APP[input.app];
  if (input.mode === 'signup' && role === 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Admin accounts cannot be created by sign-up.');
  }
  const identity = await d.google.verify(input.idToken);
  if (!identity || !identity.emailVerified) {
    throw new AppError(
      401,
      'GOOGLE_TOKEN_INVALID',
      'Google sign-in did not work. Please try again.',
    );
  }

  const bySub = await d.db.user.findUnique({
    where: { googleSub_role: { googleSub: identity.sub, role } },
  });
  const byEmail = bySub ?? (await findUser(d, identity.email, role));

  if (input.mode === 'signup') {
    if (byEmail)
      throw new AppError(409, 'ACCOUNT_EXISTS', 'You already have an account. Log in instead.');
    const name = validName(
      role,
      input.name?.trim() || identity.name || identity.email.split('@')[0],
    );
    const user = await createUser(d, {
      role,
      email: identity.email,
      name,
      googleSub: identity.sub,
    });
    d.logger.info('auth_signed_in', { method: 'google', purpose: 'signup', role: API_ROLE[role] });
    return startSession(d, user, input.deviceName);
  }

  if (!byEmail) {
    throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'No account with that email. Sign up instead.');
  }
  if (byEmail.googleSub && byEmail.googleSub !== identity.sub) {
    throw new AppError(
      401,
      'GOOGLE_TOKEN_INVALID',
      'That Google account is not linked to this account.',
    );
  }
  const user = byEmail.googleSub
    ? byEmail
    : await d.db.user.update({ where: { id: byEmail.id }, data: { googleSub: identity.sub } });
  d.logger.info('auth_signed_in', { method: 'google', purpose: 'login', role: API_ROLE[role] });
  return startSession(d, user, input.deviceName);
}

/**
 * Rotates the refresh token. Presenting an already-used token:
 * - within AUTH_RULES.refreshReuseGraceSeconds of its first use: a concurrent refresh (two tabs).
 *   Allowed; a new token is issued and the session is kept.
 * - after that: treated as theft. The whole session is revoked (every token in it stops working).
 */
export async function rotateRefreshToken(
  d: AuthDeps,
  token: string | undefined,
): Promise<SignInResult> {
  const now = d.now();
  const invalid = () =>
    new AppError(401, 'REFRESH_INVALID', 'Your session has ended. Please log in again.');
  if (!token) throw invalid();

  const row = await d.db.refreshToken.findUnique({
    where: { tokenHash: refreshTokenHash(d.config.pepper, token) },
    include: { session: { include: { user: true } } },
  });
  if (!row) throw invalid();
  const { session } = row;
  if (session.revokedAt || session.expiresAt <= now) throw invalid();

  let usedAt = row.usedAt;
  if (!usedAt) {
    const marked = await d.db.refreshToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (marked.count === 0) {
      usedAt = (await d.db.refreshToken.findUniqueOrThrow({ where: { id: row.id } })).usedAt;
    }
  }
  if (usedAt && now.getTime() - usedAt.getTime() > AUTH_RULES.refreshReuseGraceSeconds * SECOND) {
    await d.db.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now, revokeReason: 'reuse_detected' },
    });
    d.logger.warn('auth_refresh_reuse_detected', { sessionId: session.id });
    throw new AppError(
      401,
      'REFRESH_REUSED',
      'Your session has ended for your safety. Please log in again.',
    );
  }

  const refreshExpiresAt = new Date(now.getTime() + sessionTtlMs(session.user.role));
  await d.db.session.update({
    where: { id: session.id },
    data: { lastUsedAt: now, expiresAt: refreshExpiresAt },
  });
  const refreshToken = await issueRefreshToken(d, session.id);
  const access = await signAccessToken(
    { userId: session.userId, role: API_ROLE[session.user.role], sessionId: session.id },
    d.config.jwtAccessSecret,
    now,
  );
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken,
    refreshExpiresAt,
    user: session.user,
    sessionId: session.id,
  };
}

/** Session id behind a refresh token, if it is known (used by lenient logout). */
export async function sessionIdForRefreshToken(d: AuthDeps, token: string | undefined) {
  if (!token) return null;
  const row = await d.db.refreshToken.findUnique({
    where: { tokenHash: refreshTokenHash(d.config.pepper, token) },
    select: { sessionId: true },
  });
  return row?.sessionId ?? null;
}

export async function revokeSession(d: AuthDeps, sessionId: string, reason: string) {
  await d.db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: d.now(), revokeReason: reason },
  });
}

export async function revokeAllSessions(d: AuthDeps, userId: string) {
  const res = await d.db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: d.now(), revokeReason: 'logout_all' },
  });
  return res.count;
}

export async function listSessions(d: AuthDeps, userId: string, currentSessionId: string) {
  const sessions = await d.db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: d.now() } },
    orderBy: { lastUsedAt: 'desc' },
  });
  return sessions.map((s) => ({
    id: s.id,
    deviceName: s.deviceName,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    current: s.id === currentSessionId,
  }));
}

export async function revokeOwnSession(d: AuthDeps, userId: string, sessionId: string) {
  const res = await d.db.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: d.now(), revokeReason: 'logout' },
  });
  if (res.count === 0) throw new AppError(404, 'NOT_FOUND', 'That session does not exist.');
}

/** Confirms a step-up code and marks the current session fresh for 5 minutes. */
export async function stepUp(d: AuthDeps, userId: string, sessionId: string, code: string) {
  const user = await d.db.user.findUniqueOrThrow({ where: { id: userId } });
  await consumeCode(d, user.email, user.role, 'step_up', code);
  const now = d.now();
  await d.db.session.update({ where: { id: sessionId }, data: { stepUpAt: now } });
  return { freshUntil: new Date(now.getTime() + AUTH_RULES.stepUpTtlMinutes * MINUTE) };
}

export const toAuthTokensResponse = (r: SignInResult) => ({
  accessToken: r.accessToken,
  accessTokenExpiresAt: r.accessTokenExpiresAt.toISOString(),
  user: toUserDto(r.user),
});
