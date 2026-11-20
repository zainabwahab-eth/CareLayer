// Auth crypto primitives. Codes and refresh tokens are never stored: only a keyed HMAC with
// AUTH_PEPPER, so a database leak alone does not reveal them.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AUTH_RULES } from '@carelayer/shared';

/** Uniform 6-digit code ("000000"-"999999"), from the CSPRNG. */
export function generateCode(): string {
  return randomInt(0, 10 ** AUTH_RULES.codeLength)
    .toString()
    .padStart(AUTH_RULES.codeLength, '0');
}

/** 256-bit opaque token, base64url. Used for refresh tokens. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** HMAC-SHA256(pepper, parts joined by \0), hex. The context parts bind a hash to its use. */
export function keyedHash(pepper: string, ...parts: string[]): string {
  return createHmac('sha256', pepper).update(parts.join('\0')).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
