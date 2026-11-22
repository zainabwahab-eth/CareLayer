// Z3 passwordless auth, against the real (throwaway) test database. Time is injected (fakeClock),
// emails are captured (memoryEmailSender), Google is faked. Each test uses its own email address.
import { randomUUID } from 'node:crypto';
import { AUTH_RULES } from '@carelayer/shared';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { errorHandler } from '../src/lib/errors.js';
import { createLogger } from '../src/lib/logger.js';
import { requireAuth, requireFreshCode } from '../src/modules/auth/middleware.js';
import { buildTestApp, fakeClock, fakeGoogleVerifier, memoryEmailSender } from './helpers/app.js';
import { testConfig, testDatabaseUrl } from './helpers/env.js';

const db = createDb(testDatabaseUrl());
afterAll(() => db.$disconnect());

const SECOND = 1000;
const MINUTE = 60 * SECOND;

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
let app: ReturnType<typeof buildTestApp>;

beforeEach(() => {
  clock = fakeClock();
  mail = memoryEmailSender();
  app = buildTestApp(db, { clock, emailSender: mail, googleVerifier: fakeGoogleVerifier() });
});

const newEmail = (tag = 'u') => `${tag}-${randomUUID().slice(0, 8)}@example.com`;

const requestCode = (body: Record<string, unknown>, token?: string) => {
  const r = request(app).post('/auth/code/request').send(body);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const verify = (body: Record<string, unknown>) => request(app).post('/auth/code/verify').send(body);

/** Reads the cl_refresh cookie value and its attributes from a response. */
function refreshCookie(res: request.Response) {
  const raw = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('cl_refresh='));
  if (!raw) return null;
  const value = raw.split(';')[0]!.slice('cl_refresh='.length);
  return { raw, value };
}

async function signUp(app_: 'women' | 'nurses' = 'women', email = newEmail(), name = 'Tolu') {
  const r1 = await requestCode({ email, purpose: 'signup', app: app_, name });
  expect(r1.status).toBe(202);
  const res = await verify({
    email,
    code: mail.lastCode(email),
    purpose: 'signup',
    app: app_,
    name,
    deviceName: 'Test phone',
  });
  expect(res.status).toBe(200);
  return {
    email,
    res,
    accessToken: res.body.accessToken as string,
    refresh: refreshCookie(res)!.value,
  };
}

const refresh = (cookieValue?: string) => {
  const r = request(app).post('/auth/refresh');
  return cookieValue ? r.set('Cookie', `cl_refresh=${cookieValue}`) : r;
};

describe('POST /auth/code/request', () => {
  it('sends a 6-digit code for sign-up and says when a resend is allowed', async () => {
    const email = newEmail();
    const res = await requestCode({
      email: `  ${email.toUpperCase()} `,
      purpose: 'signup',
      app: 'women',
      name: 'Tolu',
    });
    expect(res.status).toBe(202);
    expect(res.body.sent).toBe(true);
    expect(res.body.resendAvailableAt).toBe(
      new Date(clock().getTime() + 45 * SECOND).toISOString(),
    );
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: email, purpose: 'signup', expiresInMinutes: 10 });
    expect(mail.lastCode(email)).toMatch(/^\d{6}$/);
  });

  it('stores only a hash of the code, never the code', async () => {
    const email = newEmail();
    await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    const row = await db.emailCode.findFirstOrThrow({ where: { email } });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(mail.lastCode(email));
  });

  it('validates fields and names the first bad one (details.field)', async () => {
    const bad = await requestCode({
      email: 'not-an-email',
      purpose: 'signup',
      app: 'women',
      name: 'Tolu',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'email' },
    });

    const noName = await requestCode({ email: newEmail(), purpose: 'signup', app: 'women' });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'name' },
    });
  });

  it('sign-up for an existing account is 409; log-in for an unknown one is 404', async () => {
    const { email } = await signUp();
    clock.advance(MINUTE);
    expect(
      (await requestCode({ email, purpose: 'signup', app: 'women', name: 'X' })).body.error.code,
    ).toBe('ACCOUNT_EXISTS');
    expect((await requestCode({ email: newEmail(), purpose: 'login', app: 'women' })).status).toBe(
      404,
    );
  });

  it('admins cannot sign up', async () => {
    const res = await requestCode({
      email: newEmail(),
      purpose: 'signup',
      app: 'admin',
      name: 'Me',
    });
    expect(res.status).toBe(403);
  });

  it('a resend within 45 s is refused; after 45 s it works and replaces the old code', async () => {
    const email = newEmail();
    await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    const firstCode = mail.lastCode(email);

    clock.advance(30 * SECOND);
    const early = await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    expect(early.status).toBe(429);
    expect(early.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 15 },
    });

    clock.advance(15 * SECOND);
    expect(
      (await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' })).status,
    ).toBe(202);
    const secondCode = mail.lastCode(email);

    // The first code no longer works (unless the random codes collide).
    if (firstCode !== secondCode) {
      const old = await verify({
        email,
        code: firstCode,
        purpose: 'signup',
        app: 'women',
        name: 'Tolu',
      });
      expect(old.status).toBe(400);
    }
    const ok = await verify({
      email,
      code: secondCode,
      purpose: 'signup',
      app: 'women',
      name: 'Tolu',
    });
    expect(ok.status).toBe(200);
  });

  it('allows at most 5 codes per hour', async () => {
    const email = newEmail();
    for (let i = 0; i < AUTH_RULES.maxCodesPerHour; i++) {
      expect(
        (await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' })).status,
      ).toBe(202);
      clock.advance(46 * SECOND);
    }
    const sixth = await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');

    clock.advance(60 * MINUTE);
    expect(
      (await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' })).status,
    ).toBe(202);
  });
});

describe('POST /auth/code/verify', () => {
  it('signs up: creates the user with settings, returns tokens and sets the refresh cookie', async () => {
    const { email, res } = await signUp('women');
    expect(res.body.user).toMatchObject({ role: 'woman', displayName: 'Tolu', email });
    expect(Date.parse(res.body.accessTokenExpiresAt) - clock().getTime()).toBe(15 * MINUTE);
    expect(res.headers['cache-control']).toBe('no-store');

    const cookie = refreshCookie(res)!;
    expect(cookie.raw).toMatch(/HttpOnly/i);
    expect(cookie.raw).toMatch(/SameSite=Lax/i);
    expect(cookie.raw).toMatch(/Path=\/auth/);
    expect(cookie.raw).toMatch(/Max-Age=7776000/); // 90 days for women

    const user = await db.user.findUniqueOrThrow({
      where: { email_role: { email, role: 'WOMAN' } },
      include: { settings: true, notificationPreference: true, sessions: true },
    });
    expect(user.settings).not.toBeNull();
    expect(user.notificationPreference).not.toBeNull();
    expect(user.sessions[0]!.deviceName).toBe('Test phone');
    const token = await db.refreshToken.findFirstOrThrow({
      where: { sessionId: user.sessions[0]!.id },
    });
    expect(token.tokenHash).not.toBe(cookie.value);
  });

  it('nurse sign-up creates a draft nurse profile with the licence name, 30-day session', async () => {
    const { email, res } = await signUp('nurses', newEmail('n'), 'Amaka Okafor');
    expect(res.body.user.role).toBe('nurse');
    expect(refreshCookie(res)!.raw).toMatch(/Max-Age=2592000/); // 30 days
    const user = await db.user.findUniqueOrThrow({
      where: { email_role: { email, role: 'NURSE' } },
      include: { nurseProfile: true },
    });
    expect(user.nurseProfile).toMatchObject({
      fullName: 'Amaka Okafor',
      verificationStatus: 'DRAFT',
    });
  });

  it('accounts are per app: the same email can be a woman and a nurse', async () => {
    const email = newEmail('both');
    const woman = await signUp('women', email, 'Tolu');
    const nurse = await signUp('nurses', email, 'Tolu Ade');
    expect(woman.res.body.user.id).not.toBe(nurse.res.body.user.id);
    expect(await db.user.count({ where: { email } })).toBe(2);
  });

  it('wrong codes count down, and the 5th wrong try locks the code (even the right one fails)', async () => {
    const email = newEmail();
    await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    const right = mail.lastCode(email);
    const wrong = right === '000000' ? '111111' : '000000';
    const body = { email, purpose: 'signup', app: 'women', name: 'Tolu' };

    for (let remaining = 4; remaining >= 1; remaining--) {
      const res = await verify({ ...body, code: wrong });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'CODE_INVALID',
        details: { attemptsRemaining: remaining },
      });
    }
    const fifth = await verify({ ...body, code: wrong });
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('CODE_ATTEMPTS_EXCEEDED');

    const tooLate = await verify({ ...body, code: right });
    expect(tooLate.status).toBe(429);
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it('parallel wrong guesses cannot exceed 5 attempts', async () => {
    const email = newEmail();
    await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    const wrong = mail.lastCode(email) === '000000' ? '111111' : '000000';
    await Promise.all(
      Array.from({ length: 10 }, () =>
        verify({ email, code: wrong, purpose: 'signup', app: 'women', name: 'Tolu' }),
      ),
    );
    const row = await db.emailCode.findFirstOrThrow({ where: { email } });
    expect(row.attempts).toBeLessThanOrEqual(AUTH_RULES.codeMaxAttempts);
  });

  it('codes expire after 10 minutes (410)', async () => {
    const email = newEmail();
    await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    clock.advance(10 * MINUTE);
    const res = await verify({
      email,
      code: mail.lastCode(email),
      purpose: 'signup',
      app: 'women',
      name: 'Tolu',
    });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('codes are single use', async () => {
    const email = newEmail();
    await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    const code = mail.lastCode(email);
    expect(
      (await verify({ email, code, purpose: 'signup', app: 'women', name: 'Tolu' })).status,
    ).toBe(200);
    const again = await verify({ email, code, purpose: 'login', app: 'women' });
    expect(again.status).toBe(400);
  });

  it('a code for one purpose does not work for another', async () => {
    const { email } = await signUp();
    clock.advance(MINUTE);
    await requestCode({ email, purpose: 'login', app: 'women' });
    const loginCode = mail.lastCode(email);
    const asNurse = await verify({ email, code: loginCode, purpose: 'login', app: 'nurses' });
    expect(asNurse.status).toBe(404); // no nurse account with this email
    expect((await verify({ email, code: loginCode, purpose: 'login', app: 'women' })).status).toBe(
      200,
    );
  });

  it('a malformed request never burns the code', async () => {
    const email = newEmail();
    await requestCode({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    const code = mail.lastCode(email);
    const noName = await verify({ email, code, purpose: 'signup', app: 'women' });
    expect(noName.status).toBe(400);
    expect(
      (await verify({ email, code, purpose: 'signup', app: 'women', name: 'Tolu' })).status,
    ).toBe(200);
  });

  it('logs in with a code', async () => {
    const { email } = await signUp();
    clock.advance(MINUTE);
    await requestCode({ email, purpose: 'login', app: 'women' });
    const res = await verify({ email, code: mail.lastCode(email), purpose: 'login', app: 'women' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });
});

describe('sessions: refresh rotation and reuse detection', () => {
  it('rotates the refresh token on every refresh and slides the expiry', async () => {
    const s = await signUp();
    clock.advance(5 * MINUTE);
    const r1 = await refresh(s.refresh);
    expect(r1.status).toBe(200);
    const next = refreshCookie(r1)!.value;
    expect(next).not.toBe(s.refresh);
    expect(r1.body.accessToken).toBeTruthy();

    const session = await db.session.findFirstOrThrow({ where: { user: { email: s.email } } });
    expect(session.expiresAt.getTime()).toBe(clock().getTime() + 90 * 24 * 60 * MINUTE);
    expect(session.lastUsedAt.getTime()).toBe(clock().getTime());

    clock.advance(MINUTE);
    expect((await refresh(next)).status).toBe(200);
  });

  it('reusing an old refresh token revokes the whole session (and its newest token)', async () => {
    const s = await signUp();
    const r1 = await refresh(s.refresh);
    const newest = refreshCookie(r1)!.value;

    clock.advance(AUTH_RULES.refreshReuseGraceSeconds * SECOND + SECOND);
    const reuse = await refresh(s.refresh);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_REUSED');
    expect(refreshCookie(reuse)?.value).toBe(''); // cookie cleared

    const session = await db.session.findFirstOrThrow({ where: { user: { email: s.email } } });
    expect(session.revokeReason).toBe('reuse_detected');
    expect((await refresh(newest)).status).toBe(401);
    expect(
      (await request(app).get('/me').set('Authorization', `Bearer ${r1.body.accessToken}`)).status,
    ).toBe(401);
  });

  it('a concurrent refresh with the same token within the grace window keeps the session (two tabs)', async () => {
    const s = await signUp();
    const [a, b] = await Promise.all([refresh(s.refresh), refresh(s.refresh)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const session = await db.session.findFirstOrThrow({ where: { user: { email: s.email } } });
    expect(session.revokedAt).toBeNull();
  });

  it('refresh without a cookie or with garbage is 401 REFRESH_INVALID', async () => {
    expect((await refresh()).body.error.code).toBe('REFRESH_INVALID');
    expect((await refresh('garbage')).body.error.code).toBe('REFRESH_INVALID');
  });

  it('sessions end after their sliding lifetime (30 days for nurses)', async () => {
    const s = await signUp('nurses', newEmail('n'), 'Hauwa Musa');
    clock.advance(30 * 24 * 60 * MINUTE + SECOND);
    expect((await refresh(s.refresh)).status).toBe(401);
  });
});

describe('access tokens and /me', () => {
  it('GET /me returns the signed-in user; PATCH /me renames her', async () => {
    const s = await signUp();
    const me = await request(app).get('/me').set('Authorization', `Bearer ${s.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: s.email, role: 'woman', displayName: 'Tolu' });

    const renamed = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ displayName: 'Toluwani' });
    expect(renamed.body.displayName).toBe('Toluwani');
    const blank = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ displayName: ' ' });
    expect(blank.status).toBe(400);
  });

  it('no token, a tampered token or an expired token is 401', async () => {
    const s = await signUp();
    expect((await request(app).get('/me')).status).toBe(401);
    const tampered = s.accessToken.slice(0, -2) + (s.accessToken.endsWith('a') ? 'bb' : 'aa');
    expect((await request(app).get('/me').set('Authorization', `Bearer ${tampered}`)).status).toBe(
      401,
    );
    clock.advance(15 * MINUTE + SECOND);
    expect(
      (await request(app).get('/me').set('Authorization', `Bearer ${s.accessToken}`)).status,
    ).toBe(401);
  });

  it('a token signed with another secret is rejected', async () => {
    const s = await signUp();
    const other = buildTestApp(db, {
      clock,
      emailSender: mail,
      config: {
        auth: { ...testConfig().auth, jwtAccessSecret: 'another-secret-0123456789abcdefghijkl' },
      },
    });
    expect(
      (await request(other).get('/me').set('Authorization', `Bearer ${s.accessToken}`)).status,
    ).toBe(401);
  });
});

describe('logout', () => {
  it('logout revokes the current session immediately and clears the cookie', async () => {
    const s = await signUp();
    const out = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${s.accessToken}`);
    expect(out.status).toBe(204);
    expect(refreshCookie(out)?.value).toBe('');
    expect(
      (await request(app).get('/me').set('Authorization', `Bearer ${s.accessToken}`)).status,
    ).toBe(401);
    expect((await refresh(s.refresh)).status).toBe(401);
  });

  it('logout works with only the refresh cookie (expired access token)', async () => {
    const s = await signUp();
    clock.advance(20 * MINUTE);
    const out = await request(app).post('/auth/logout').set('Cookie', `cl_refresh=${s.refresh}`);
    expect(out.status).toBe(204);
    expect((await refresh(s.refresh)).status).toBe(401);
  });

  it('logout-all ends every session of this user only', async () => {
    const email = newEmail();
    const phone = await signUp('women', email);
    clock.advance(MINUTE);
    await requestCode({ email, purpose: 'login', app: 'women' });
    const laptop = await verify({
      email,
      code: mail.lastCode(email),
      purpose: 'login',
      app: 'women',
      deviceName: 'Laptop',
    });
    const someoneElse = await signUp();

    const list = await request(app)
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${phone.accessToken}`);
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((x: { current: boolean }) => x.current)).toHaveLength(1);

    expect(
      (
        await request(app)
          .post('/auth/logout-all')
          .set('Authorization', `Bearer ${phone.accessToken}`)
      ).status,
    ).toBe(204);
    expect(
      (await request(app).get('/me').set('Authorization', `Bearer ${laptop.body.accessToken}`))
        .status,
    ).toBe(401);
    expect((await refresh(refreshCookie(laptop)!.value)).status).toBe(401);
    expect(
      (await request(app).get('/me').set('Authorization', `Bearer ${someoneElse.accessToken}`))
        .status,
    ).toBe(200);
  });

  it('DELETE /auth/sessions/:id ends one of my sessions, never someone else', async () => {
    const email = newEmail();
    const phone = await signUp('women', email);
    clock.advance(MINUTE);
    await requestCode({ email, purpose: 'login', app: 'women' });
    const laptop = await verify({
      email,
      code: mail.lastCode(email),
      purpose: 'login',
      app: 'women',
    });
    const other = await signUp();
    const otherSession = await db.session.findFirstOrThrow({
      where: { user: { email: other.email } },
    });

    const sessions = await request(app)
      .get('/auth/sessions')
      .set('Authorization', `Bearer ${phone.accessToken}`);
    const laptopId = sessions.body.find((x: { current: boolean }) => !x.current).id;
    expect(
      (
        await request(app)
          .delete(`/auth/sessions/${laptopId}`)
          .set('Authorization', `Bearer ${phone.accessToken}`)
      ).status,
    ).toBe(204);
    expect(
      (await request(app).get('/me').set('Authorization', `Bearer ${laptop.body.accessToken}`))
        .status,
    ).toBe(401);

    expect(
      (
        await request(app)
          .delete(`/auth/sessions/${otherSession.id}`)
          .set('Authorization', `Bearer ${phone.accessToken}`)
      ).status,
    ).toBe(404);
  });
});

describe('role guards', () => {
  it('a woman cannot call /nurse/* or /admin/* (403); no token is 401', async () => {
    const woman = await signUp();
    expect(
      (
        await request(app)
          .get('/nurse/questions')
          .set('Authorization', `Bearer ${woman.accessToken}`)
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get('/admin/nurses').set('Authorization', `Bearer ${woman.accessToken}`))
        .status,
    ).toBe(403);
    expect((await request(app).get('/nurse/questions')).status).toBe(401);
  });

  it('a nurse passes the /nurse guard (404: no route yet) but not /admin', async () => {
    const nurse = await signUp('nurses', newEmail('n'), 'Funmilayo Bello');
    expect(
      (
        await request(app)
          .get('/nurse/earnings') // Z10: not built yet, so past the guard means 404

          .set('Authorization', `Bearer ${nurse.accessToken}`)
      ).status,
    ).toBe(404);
    expect(
      (await request(app).get('/admin/nurses').set('Authorization', `Bearer ${nurse.accessToken}`))
        .status,
    ).toBe(403);
  });

  it('an admin (seeded) can log in and passes the /admin guard', async () => {
    const email = newEmail('admin');
    await db.user.create({ data: { role: 'ADMIN', email, displayName: 'Admin' } });
    await requestCode({ email, purpose: 'login', app: 'admin' });
    const res = await verify({ email, code: mail.lastCode(email), purpose: 'login', app: 'admin' });
    expect(res.body.user.role).toBe('admin');
    expect(refreshCookie(res)!.raw).toMatch(/Max-Age=86400/); // 1 day
    expect(
      (
        await request(app)
          .get('/admin/nurses')
          .set('Authorization', `Bearer ${res.body.accessToken}`)
      ).status,
    ).toBe(200); // Z9 built the route
  });
});

describe('step-up (fresh code for withdrawals and payout address changes)', () => {
  it('requires a bearer token, sends the code to her own email, and marks the session fresh for 5 minutes', async () => {
    const s = await signUp('nurses', newEmail('n'), 'Hauwa Musa');
    clock.advance(MINUTE);

    expect((await requestCode({ email: s.email, purpose: 'step_up', app: 'nurses' })).status).toBe(
      401,
    );
    expect(
      (await requestCode({ email: newEmail(), purpose: 'step_up', app: 'nurses' }, s.accessToken))
        .status,
    ).toBe(403);
    expect(
      (await requestCode({ email: s.email, purpose: 'step_up', app: 'nurses' }, s.accessToken))
        .status,
    ).toBe(202);

    const res = await request(app)
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ code: mail.lastCode(s.email) });
    expect(res.status).toBe(200);
    expect(res.body.freshUntil).toBe(new Date(clock().getTime() + 5 * MINUTE).toISOString());

    const session = await db.session.findFirstOrThrow({
      where: { user: { email: s.email, role: 'NURSE' } },
    });
    expect(session.stepUpAt?.getTime()).toBe(clock().getTime());
  });

  it('requireFreshCode allows within 5 minutes and refuses after (403 STEP_UP_REQUIRED)', async () => {
    const s = await signUp('nurses', newEmail('n'), 'Hauwa Musa');
    const guarded = express();
    const deps = { db, jwtAccessSecret: testConfig().auth.jwtAccessSecret, now: clock };
    guarded.post(
      '/withdraw',
      requireAuth(deps),
      requireFreshCode(clock),
      (_req, res) => void res.json({ ok: true }),
    );
    guarded.use(errorHandler(createLogger('silent')));
    const withdraw = () =>
      request(guarded).post('/withdraw').set('Authorization', `Bearer ${s.accessToken}`);

    expect((await withdraw()).body.error.code).toBe('STEP_UP_REQUIRED');

    clock.advance(MINUTE);
    await requestCode({ email: s.email, purpose: 'step_up', app: 'nurses' }, s.accessToken);
    await request(app)
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ code: mail.lastCode(s.email) });
    expect((await withdraw()).status).toBe(200);

    clock.advance(5 * MINUTE + SECOND);
    expect((await withdraw()).body.error.code).toBe('STEP_UP_REQUIRED');
  });
});

describe('Google sign-in', () => {
  const google = (body: Record<string, unknown>) => request(app).post('/auth/google').send(body);

  it('signs up with a verified Google identity and logs in again by Google id', async () => {
    const email = newEmail('g');
    const token = `valid:sub-${email}:${email}`;
    const up = await google({ idToken: token, mode: 'signup', app: 'women', name: 'Ada' });
    expect(up.status).toBe(200);
    expect(up.body.user).toMatchObject({ email, displayName: 'Ada' });
    expect(refreshCookie(up)).not.toBeNull();

    const again = await google({ idToken: token, mode: 'login', app: 'women' });
    expect(again.body.user.id).toBe(up.body.user.id);
    expect((await google({ idToken: token, mode: 'signup', app: 'women' })).status).toBe(409);
  });

  it('links Google to an existing code account on first Google login', async () => {
    const { email, res } = await signUp();
    const g = await google({ idToken: `valid:sub-link:${email}`, mode: 'login', app: 'women' });
    expect(g.body.user.id).toBe(res.body.user.id);
    const user = await db.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(user.googleSub).toBe('sub-link');
    // A different Google account for the same email is refused afterwards.
    expect(
      (await google({ idToken: `valid:sub-other:${email}`, mode: 'login', app: 'women' })).status,
    ).toBe(401);
  });

  it('rejects invalid tokens and unverified emails (401); 503 when Google is not configured', async () => {
    expect((await google({ idToken: 'nope', mode: 'login', app: 'women' })).body.error.code).toBe(
      'GOOGLE_TOKEN_INVALID',
    );
    const unverified = await google({
      idToken: `valid:s:${newEmail()}:unverified`,
      mode: 'signup',
      app: 'women',
    });
    expect(unverified.status).toBe(401);

    const noGoogle = buildTestApp(db, { clock, emailSender: mail });
    const res = await request(noGoogle)
      .post('/auth/google')
      .send({ idToken: 'valid:s:x@example.com', mode: 'login', app: 'women' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('privacy', () => {
  it('never logs codes, tokens or emails in request logs', async () => {
    const lines: string[] = [];
    const logged = buildTestApp(db, {
      clock,
      emailSender: mail,
      logger: createLogger('debug', (_l, line) => lines.push(line)),
    });
    const email = newEmail('p');
    await request(logged)
      .post('/auth/code/request')
      .send({ email, purpose: 'signup', app: 'women', name: 'Tolu' });
    const code = mail.lastCode(email);
    const res = await request(logged)
      .post('/auth/code/verify')
      .send({ email, code, purpose: 'signup', app: 'women', name: 'Tolu' });
    const all = lines.join('\n');
    expect(all).not.toContain(email);
    expect(all).not.toContain(code);
    expect(all).not.toContain(res.body.accessToken);
  });
});
