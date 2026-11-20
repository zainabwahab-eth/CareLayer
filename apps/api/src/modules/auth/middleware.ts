// Route guards.
//   requireAuth       Bearer access token AND a live session (not revoked, not expired). 401 otherwise.
//   requireRole(...)  403 FORBIDDEN for other roles (e.g. a woman calling /nurse/*).
//   requireFreshCode  403 STEP_UP_REQUIRED unless this session verified a code in the last 5 min.
import { AUTH_RULES, type UserRole as ApiRole } from '@carelayer/shared';
import type { Request, RequestHandler, Response } from 'express';
import type { Db } from '../../db.js';
import { AppError } from '../../lib/errors.js';
import { verifyAccessToken } from './tokens.js';

export interface AuthState {
  userId: string;
  role: ApiRole;
  sessionId: string;
  stepUpAt: Date | null;
}

export function bearerToken(req: Request): string | undefined {
  const header = req.get('authorization');
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1];
}

/** The authenticated caller. Only valid after requireAuth. */
export function getAuth(res: Response): AuthState {
  const auth = res.locals.auth as AuthState | undefined;
  if (!auth) throw new Error('getAuth called on a route without requireAuth');
  return auth;
}

/** Resolves the caller from the bearer token, or null. Never throws for bad tokens. */
export async function resolveAuth(
  req: Request,
  deps: { db: Db; jwtAccessSecret: string; now: () => Date },
): Promise<AuthState | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const now = deps.now();
  const claims = await verifyAccessToken(token, deps.jwtAccessSecret, now);
  if (!claims) return null;
  const session = await deps.db.session.findUnique({ where: { id: claims.sessionId } });
  if (
    !session ||
    session.userId !== claims.userId ||
    session.revokedAt ||
    session.expiresAt <= now
  ) {
    return null;
  }
  return {
    userId: claims.userId,
    role: claims.role,
    sessionId: session.id,
    stepUpAt: session.stepUpAt,
  };
}

export function requireAuth(deps: {
  db: Db;
  jwtAccessSecret: string;
  now: () => Date;
}): RequestHandler {
  return async (req, res, next) => {
    try {
      const auth = await resolveAuth(req, deps);
      if (!auth) {
        next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in.'));
        return;
      }
      res.locals.auth = auth;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: ApiRole[]): RequestHandler {
  return (_req, res, next) => {
    const auth = res.locals.auth as AuthState | undefined;
    if (!auth) next(new AppError(401, 'UNAUTHENTICATED', 'Please sign in.'));
    else if (!roles.includes(auth.role)) {
      next(new AppError(403, 'FORBIDDEN', 'This is not available for your account.'));
    } else next();
  };
}

export function requireFreshCode(now: () => Date): RequestHandler {
  return (_req, res, next) => {
    const { stepUpAt } = getAuth(res);
    const fresh =
      stepUpAt !== null &&
      now().getTime() - stepUpAt.getTime() <= AUTH_RULES.stepUpTtlMinutes * 60_000;
    if (fresh) next();
    else {
      next(
        new AppError(403, 'STEP_UP_REQUIRED', 'Confirm it is you with a new code first.', {
          stepUpTtlMinutes: AUTH_RULES.stepUpTtlMinutes,
        }),
      );
    }
  };
}
