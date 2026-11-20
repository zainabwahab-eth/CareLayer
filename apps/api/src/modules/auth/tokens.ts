// Access tokens: short-lived HS256 JWTs. They carry the session id so every request can check the
// session is still live (logout and logout-all take effect immediately, not after 15 minutes).
import { AUTH_RULES, type UserRole as ApiRole } from '@carelayer/shared';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'carelayer-api';
const AUDIENCE = 'carelayer';

export interface AccessClaims {
  userId: string;
  role: ApiRole;
  sessionId: string;
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(claims: AccessClaims, secret: string, now: Date) {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + AUTH_RULES.accessTokenTtlMinutes * 60;
  const token = await new SignJWT({ role: claims.role, sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key(secret));
  return { token, expiresAt: new Date(exp * 1000) };
}

/** Returns the claims, or null for anything invalid (bad signature, expired, wrong alg/aud/iss). */
export async function verifyAccessToken(
  token: string,
  secret: string,
  now: Date,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
    });
    const role = payload.role;
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      (role !== 'woman' && role !== 'nurse' && role !== 'admin')
    ) {
      return null;
    }
    return { userId: payload.sub, role, sessionId: payload.sid };
  } catch {
    return null;
  }
}
