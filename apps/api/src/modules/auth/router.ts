// Auth module (Z3). Contract: docs/API_CONTRACT.md §2.
//   POST   /auth/code/request   send a 6-digit code (signup | login | step_up)
//   POST   /auth/code/verify    verify a code -> access token + refresh cookie
//   POST   /auth/google         Google ID token -> access token + refresh cookie
//   POST   /auth/refresh        rotate the refresh cookie -> new access token
//   POST   /auth/logout         end this session (bearer OR refresh cookie; always clears the cookie)
//   POST   /auth/logout-all     end every session of this user
//   GET    /auth/sessions       this user's live sessions
//   DELETE /auth/sessions/:id   end one of them
//   POST   /auth/step-up        confirm a step_up code -> this session is fresh for 5 minutes
import { AUTH_RULES } from '@carelayer/shared';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookies.js';
import { createEmailSender } from './email.js';
import { createGoogleVerifier } from './google.js';
import { getAuth, requireAuth, resolveAuth } from './middleware.js';
import {
  googleSignIn,
  listSessions,
  requestCode,
  revokeAllSessions,
  revokeOwnSession,
  revokeSession,
  rotateRefreshToken,
  sessionIdForRefreshToken,
  stepUp,
  toAuthTokensResponse,
  verifyCodeAndSignIn,
  type AuthDeps,
  type SignInResult,
} from './service.js';

const email = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .max(254, 'That email is too long.')
  .pipe(z.email({ error: 'Enter a valid email address, like name@example.com.' }));
const app = z.enum(['women', 'nurses', 'admin'], { error: 'app must be women, nurses or admin.' });
const code = z
  .string({ error: 'Enter the 6-digit code.' })
  .trim()
  .regex(new RegExp(`^\\d{${AUTH_RULES.codeLength}}$`), 'Enter the 6-digit code.');
const name = z.string().max(200).optional();
const deviceName = z.string().max(200).optional();

const RequestCodeSchema = z.object({
  email,
  purpose: z.enum(['signup', 'login', 'step_up'], {
    error: 'purpose must be signup, login or step_up.',
  }),
  app,
  name,
});
const VerifyCodeSchema = z.object({
  email,
  code,
  purpose: z.enum(['signup', 'login'], { error: 'purpose must be signup or login.' }),
  app,
  name,
  deviceName,
});
const GoogleSchema = z.object({
  idToken: z.string({ error: 'idToken is required.' }).min(1, 'idToken is required.'),
  mode: z.enum(['signup', 'login'], { error: 'mode must be signup or login.' }),
  app,
  name,
  deviceName,
});
const StepUpSchema = z.object({ code });

export function createAuthRouter(deps: AppDeps): Router {
  const router = Router();
  const now = deps.clock ?? (() => new Date());
  const auth: AuthDeps = {
    db: deps.db,
    config: deps.config.auth,
    email: deps.emailSender ?? createEmailSender(deps.config.auth, deps.logger),
    google:
      deps.googleVerifier ??
      (deps.config.auth.googleClientId
        ? createGoogleVerifier(deps.config.auth.googleClientId)
        : undefined),
    logger: deps.logger,
    now,
  };
  const guard = { db: deps.db, jwtAccessSecret: deps.config.auth.jwtAccessSecret, now };
  const cookie = deps.config.auth.cookie;

  const signedIn = (res: Response, result: SignInResult) => {
    setRefreshCookie(res, cookie, result.refreshToken, result.refreshExpiresAt, now());
    res.setHeader('Cache-Control', 'no-store');
    res.json(toAuthTokensResponse(result));
  };

  router.post('/auth/code/request', async (req, res) => {
    const body = RequestCodeSchema.parse(req.body);
    const caller = body.purpose === 'step_up' ? await resolveAuth(req, guard) : null;
    const { resendAvailableAt } = await requestCode(auth, body, caller);
    res.status(202).json({ sent: true, resendAvailableAt: resendAvailableAt.toISOString() });
  });

  router.post('/auth/code/verify', async (req, res) => {
    signedIn(res, await verifyCodeAndSignIn(auth, VerifyCodeSchema.parse(req.body)));
  });

  router.post('/auth/google', async (req, res) => {
    signedIn(res, await googleSignIn(auth, GoogleSchema.parse(req.body)));
  });

  router.post('/auth/refresh', async (req, res) => {
    try {
      signedIn(res, await rotateRefreshToken(auth, readRefreshCookie(req)));
    } catch (err) {
      clearRefreshCookie(res, cookie);
      throw err;
    }
  });

  // Lenient on purpose: works with an expired access token (via the cookie), and always clears it.
  router.post('/auth/logout', async (req, res) => {
    const caller = await resolveAuth(req, guard);
    const sessionId =
      caller?.sessionId ?? (await sessionIdForRefreshToken(auth, readRefreshCookie(req)));
    if (sessionId) await revokeSession(auth, sessionId, 'logout');
    clearRefreshCookie(res, cookie);
    res.status(204).end();
  });

  router.post('/auth/logout-all', requireAuth(guard), async (_req, res) => {
    await revokeAllSessions(auth, getAuth(res).userId);
    clearRefreshCookie(res, cookie);
    res.status(204).end();
  });

  router.get('/auth/sessions', requireAuth(guard), async (_req, res) => {
    const { userId, sessionId } = getAuth(res);
    res.json(await listSessions(auth, userId, sessionId));
  });

  router.delete('/auth/sessions/:id', requireAuth(guard), async (req, res) => {
    const { userId, sessionId } = getAuth(res);
    await revokeOwnSession(auth, userId, String(req.params.id));
    if (req.params.id === sessionId) clearRefreshCookie(res, cookie);
    res.status(204).end();
  });

  router.post('/auth/step-up', requireAuth(guard), async (req, res) => {
    const { userId, sessionId } = getAuth(res);
    const { freshUntil } = await stepUp(auth, userId, sessionId, StepUpSchema.parse(req.body).code);
    res.json({ freshUntil: freshUntil.toISOString() });
  });

  return router;
}
