// The refresh cookie: cl_refresh, HttpOnly, Path=/auth (only sent to auth routes), SameSite=Lax by
// default (survives the Google redirect), Secure in production.
import type { CookieOptions, Request, Response } from 'express';
import type { AuthConfig } from '../../config.js';

export const REFRESH_COOKIE = 'cl_refresh';

function options(cfg: AuthConfig['cookie']): CookieOptions {
  return { httpOnly: true, secure: cfg.secure, sameSite: cfg.sameSite, path: '/auth' };
}

export function setRefreshCookie(
  res: Response,
  cfg: AuthConfig['cookie'],
  token: string,
  expiresAt: Date,
  now: Date,
) {
  res.cookie(REFRESH_COOKIE, token, {
    ...options(cfg),
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
}

export function clearRefreshCookie(res: Response, cfg: AuthConfig['cookie']) {
  res.clearCookie(REFRESH_COOKIE, options(cfg));
}

/** Reads one cookie from the Cookie header (no cookie-parser dependency needed for one value). */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
