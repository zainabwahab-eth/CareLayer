// Draft tokens: POST /chat/draft returns the exact question a nurse would receive (W07 shows it),
// signed. POST /questions stores that draft, not a second LLM run, so what she consented to is
// exactly what is stored, and nothing about the draft is kept on the server in between.
//
// HS256 JWT (jose) with a key derived from JWT_ACCESS_SECRET for this one purpose: an access token
// can never be used as a draft token or the other way round. Bound to her user id, valid 2 hours.
// The payload is readable by her (it is her own question); it is signed, not encrypted.
import { createHmac } from 'node:crypto';
import { AGE_RANGES, QUESTION_CATEGORIES, type QuestionDraft } from '@carelayer/shared';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

export const DRAFT_TOKEN_TTL_MINUTES = 120;
const AUDIENCE = 'carelayer:question-draft';

const keyFor = (jwtAccessSecret: string) =>
  createHmac('sha256', jwtAccessSecret).update('carelayer/question-draft/v1').digest();

const DraftSchema = z.object({
  originalText: z.string(),
  cleanedText: z.string(),
  assistantNotes: z.string().nullable(),
  category: z.enum(QUESTION_CATEGORIES),
  ageRange: z.enum(AGE_RANGES).nullable(),
  pregnancyWeeks: z.number().int().nullable(),
});

export async function signDraftToken(
  draft: QuestionDraft,
  userId: string,
  secret: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + DRAFT_TOKEN_TTL_MINUTES * 60;
  const token = await new SignJWT({ draft })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setAudience(AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(keyFor(secret));
  return { token, expiresAt: new Date(exp * 1000) };
}

/** The draft, or null if the token is forged, expired, or someone else's. */
export async function verifyDraftToken(
  token: string,
  userId: string,
  secret: string,
  now: Date,
): Promise<QuestionDraft | null> {
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), {
      audience: AUDIENCE,
      subject: userId,
      algorithms: ['HS256'],
      currentDate: now,
    });
    const parsed = DraftSchema.safeParse(payload.draft);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
