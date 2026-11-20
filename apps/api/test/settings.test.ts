// GET/PATCH /me/settings and /me/notifications against the real test database.
import { randomUUID } from 'node:crypto';
import { DEFAULT_USER_SETTINGS } from '@carelayer/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { buildTestApp, memoryEmailSender } from './helpers/app.js';
import { testDatabaseUrl } from './helpers/env.js';

const db = createDb(testDatabaseUrl());
afterAll(() => db.$disconnect());

let mail: ReturnType<typeof memoryEmailSender>;
let app: ReturnType<typeof buildTestApp>;
beforeEach(() => {
  mail = memoryEmailSender();
  app = buildTestApp(db, { emailSender: mail });
});

async function signUp(appName: 'women' | 'nurses' = 'women') {
  const email = `s-${randomUUID().slice(0, 8)}@example.com`;
  await request(app)
    .post('/auth/code/request')
    .send({ email, purpose: 'signup', app: appName, name: 'Tolu' });
  const res = await request(app)
    .post('/auth/code/verify')
    .send({ email, code: mail.lastCode(email), purpose: 'signup', app: appName, name: 'Tolu' });
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

const get = (path: string, token: string) =>
  request(app).get(path).set('Authorization', `Bearer ${token}`);
const patch = (path: string, token: string, body: unknown) =>
  request(app)
    .patch(path)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);

describe('/me/settings', () => {
  it('a new woman gets the defaults', async () => {
    const w = await signUp();
    const res = await get('/me/settings', w.token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('PATCH changes only what she sends, and it sticks', async () => {
    const w = await signUp();
    const res = await patch('/me/settings', w.token, {
      appearance: 'dark',
      quickExitTarget: 'weather',
      spendingLimitPerAnswerKobo: 30_000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...DEFAULT_USER_SETTINGS,
      appearance: 'dark',
      quickExitTarget: 'weather',
      spendingLimitPerAnswerKobo: 30_000,
    });
    const again = await patch('/me/settings', w.token, {
      mcpAskBeforeEachPayment: false,
      mcpSpendingLimitPerAnswerKobo: 0,
    });
    expect(again.body).toMatchObject({
      appearance: 'dark',
      spendingLimitPerAnswerKobo: 30_000,
      mcpAskBeforeEachPayment: false,
      mcpSpendingLimitPerAnswerKobo: 0,
    });
    expect((await get('/me/settings', w.token)).body).toEqual(again.body);
    const row = await db.userSettings.findUniqueOrThrow({ where: { userId: w.userId } });
    expect(row).toMatchObject({ appearance: 'DARK', quickExitTarget: 'WEATHER' });
  });

  it.each([
    [{}, undefined],
    [{ appearance: 'purple' }, 'appearance'],
    [{ quickExitTarget: 'facebook' }, 'quickExitTarget'],
    [{ spendingLimitPerAnswerKobo: -1 }, 'spendingLimitPerAnswerKobo'],
    [{ spendingLimitPerAnswerKobo: 10_000_001 }, 'spendingLimitPerAnswerKobo'],
    [{ spendingLimitPerAnswerKobo: 500.5 }, 'spendingLimitPerAnswerKobo'],
    [{ spendingLimitPerAnswerKobo: '50000' }, 'spendingLimitPerAnswerKobo'],
    [{ mcpAskBeforeEachPayment: 'yes' }, 'mcpAskBeforeEachPayment'],
    [{ theme: 'dark' }, undefined],
  ])('rejects a bad body %#', async (body, field) => {
    const w = await signUp();
    const res = await patch('/me/settings', w.token, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    if (field) expect(res.body.error.details.field).toBe(field);
  });

  it('a nurse can change appearance only', async () => {
    const n = await signUp('nurses');
    expect((await get('/me/settings', n.token)).body.appearance).toBe('system');
    const ok = await patch('/me/settings', n.token, { appearance: 'light' });
    expect(ok.status).toBe(200);
    expect(ok.body.appearance).toBe('light');
    const refused = await patch('/me/settings', n.token, {
      appearance: 'dark',
      spendingLimitPerAnswerKobo: 0,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.details.field).toBe('spendingLimitPerAnswerKobo');
    expect((await get('/me/settings', n.token)).body.appearance).toBe('light'); // nothing applied
  });

  it('an account without a settings row gets the defaults instead of an error', async () => {
    const w = await signUp();
    await db.userSettings.delete({ where: { userId: w.userId } });
    expect((await get('/me/settings', w.token)).body).toEqual(DEFAULT_USER_SETTINGS);
    await db.userSettings.delete({ where: { userId: w.userId } });
    const res = await patch('/me/settings', w.token, { appearance: 'dark' });
    expect(res.body).toEqual({ ...DEFAULT_USER_SETTINGS, appearance: 'dark' });
  });

  it('needs sign-in', async () => {
    expect((await request(app).get('/me/settings')).status).toBe(401);
    expect((await request(app).patch('/me/settings').send({ appearance: 'dark' })).status).toBe(
      401,
    );
  });
});

describe('/me/notifications', () => {
  it('women: on by default, can turn it off and on', async () => {
    const w = await signUp();
    expect((await get('/me/notifications', w.token)).body).toEqual({ notifyWhenAnswered: true });
    const off = await patch('/me/notifications', w.token, { notifyWhenAnswered: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ notifyWhenAnswered: false });
    expect((await get('/me/notifications', w.token)).body).toEqual({ notifyWhenAnswered: false });
  });

  it('rejects an empty or bad body', async () => {
    const w = await signUp();
    expect((await patch('/me/notifications', w.token, {})).status).toBe(400);
    const bad = await patch('/me/notifications', w.token, { notifyWhenAnswered: 'no' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('notifyWhenAnswered');
  });

  it('women only', async () => {
    const n = await signUp('nurses');
    expect((await get('/me/notifications', n.token)).status).toBe(403);
    expect((await patch('/me/notifications', n.token, { notifyWhenAnswered: false })).status).toBe(
      403,
    );
  });
});
