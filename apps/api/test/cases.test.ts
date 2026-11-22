// Z7: claiming and answering, the sweeper, and the nurse dashboard (real test database).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServices } from '../src/app.js';
import { createDb } from '../src/db.js';
import { createLogger } from '../src/lib/logger.js';
import { lagosDayStart, lagosWeekStart } from '../src/modules/nurses/cases.js';
import { buildTestApp, fakeClock, memoryEmailSender } from './helpers/app.js';
import { testConfig, testDatabaseUrl } from './helpers/env.js';
import { createNurse, ensureTopics, hideExistingNurses } from './helpers/people.js';

const db = createDb(testDatabaseUrl());
beforeAll(() => ensureTopics(db));
afterAll(() => db.$disconnect());

const MINUTE = 60_000;
let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
let app: ReturnType<typeof buildTestApp>;

beforeEach(async () => {
  clock = fakeClock(new Date());
  mail = memoryEmailSender();
  app = buildTestApp(db, { clock, emailSender: mail });
  await hideExistingNurses(db);
  // Other files leave open questions behind; keep the waiting lists about this file's questions.
  await db.question.updateMany({
    where: { status: { in: ['OPEN', 'CLAIMED'] } },
    data: { status: 'CANCELLED' },
  });
  await db.claim.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'RELEASED' } });
});

/** The same services the app uses (same clock), for calling the sweeper directly. */
const sweeper = () =>
  buildServices({
    config: testConfig(),
    db,
    logger: createLogger('silent'),
    clock,
    emailSender: mail,
  }).cases;

async function signIn(email: string) {
  await request(app).post('/auth/code/request').send({ email, purpose: 'login', app: 'nurses' });
  const res = await request(app)
    .post('/auth/code/verify')
    .send({ email, code: mail.lastCode(email), purpose: 'login', app: 'nurses' });
  return res.body.accessToken as string;
}

async function nurse(opts: Parameters<typeof createNurse>[1] = {}) {
  const n = await createNurse(db, opts);
  const token = await signIn(n.email);
  const api = {
    get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
    post: (p: string, b?: object) =>
      request(app)
        .post(p)
        .set('Authorization', `Bearer ${token}`)
        .send(b ?? {}),
  };
  return { ...n, token, api };
}

async function woman(notify = true) {
  return db.user.create({
    data: {
      role: 'WOMAN',
      email: `w-${randomUUID().slice(0, 8)}@example.com`,
      displayName: 'Tolu',
      notificationPreference: { create: { notifyWhenAnswered: notify } },
    },
  });
}

async function question(
  opts: {
    womanId?: string;
    femaleOnly?: boolean;
    chosenNurseId?: string;
    createdAt?: Date;
    shareOriginal?: boolean;
    topic?: string;
  } = {},
) {
  const createdAt = opts.createdAt ?? clock();
  const womanId = opts.womanId ?? (await woman()).id;
  return db.question.create({
    data: {
      womanId,
      source: 'WEB',
      originalText: 'my feet dey swell small small, im 30 weeks',
      cleanedText: 'My feet are swelling a little. I am 30 weeks pregnant.',
      assistantNotes: 'Worse in the evening.',
      topicSlug: opts.topic ?? 'pregnancy',
      pregnancyWeeks: 30,
      femaleOnly: opts.femaleOnly ?? false,
      selection: opts.chosenNurseId ? 'CHOSEN_NURSE' : 'FIRST_AVAILABLE',
      chosenNurseId: opts.chosenNurseId ?? null,
      chosenUntil: opts.chosenNurseId ? new Date(createdAt.getTime() + 10 * MINUTE) : null,
      expiresAt: new Date(createdAt.getTime() + 30 * MINUTE),
      priceKobo: 50_000,
      priceStroops: 3_125_000n,
      isFree: true,
      createdAt,
      consent: {
        create: {
          sharedFields:
            opts.shareOriginal === false
              ? ['CLEANED_TEXT', 'CATEGORY', 'ASSISTANT_NOTES', 'PREGNANCY_WEEKS']
              : ['CLEANED_TEXT', 'ORIGINAL_TEXT', 'CATEGORY', 'ASSISTANT_NOTES', 'PREGNANCY_WEEKS'],
          consentVersion: 'v1',
          agreedAt: createdAt,
        },
      },
    },
  });
}

const ids = (res: request.Response) => (res.body.items as { id: string }[]).map((q) => q.id);

describe('waiting list (visibility)', () => {
  it('shows open questions regardless of her topics; she stays anonymous; original only if shared', async () => {
    const n = await nurse({ topics: ['periods'] }); // topics are for alerts only
    const q1 = await question();
    const q2 = await question({ shareOriginal: false });
    const res = await n.api.get('/nurse/questions?tab=waiting');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([q1.id, q2.id]);
    const [v1, v2] = res.body.items;
    expect(v1).toEqual({
      id: q1.id,
      status: 'open',
      category: 'pregnancy',
      cleanedText: 'My feet are swelling a little. I am 30 weeks pregnant.',
      originalText: 'my feet dey swell small small, im 30 weeks',
      assistantNotes: 'Worse in the evening.',
      ageRange: null,
      pregnancyWeeks: 30,
      femaleOnly: false,
      chosenForYou: false,
      claimsCloseAt: q1.expiresAt.toISOString(),
      createdAt: q1.createdAt.toISOString(),
      claimExpiresAt: null,
    });
    expect(v2.originalText).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/womanId|@example\.com|Tolu/);
  });

  it('female-only questions are hidden from male nurses', async () => {
    const male = await nurse({ gender: 'MALE' });
    const female = await nurse();
    const q = await question({ femaleOnly: true });
    expect(ids(await male.api.get('/nurse/questions'))).not.toContain(q.id);
    expect(ids(await female.api.get('/nurse/questions'))).toContain(q.id);
    expect((await male.api.post(`/nurse/questions/${q.id}/claim`)).status).toBe(404);
  });

  it('a chosen nurse sees it first (chosenForYou); others only after the 10-minute window', async () => {
    const chosen = await nurse();
    const other = await nurse();
    const older = await question({ createdAt: new Date(clock().getTime() - 5 * MINUTE) });
    const mine = await question({ chosenNurseId: chosen.userId });
    const list = await chosen.api.get('/nurse/questions');
    expect(ids(list)).toEqual([mine.id, older.id]); // reserved for her first
    expect(list.body.items[0].chosenForYou).toBe(true);
    expect(ids(await other.api.get('/nurse/questions'))).toEqual([older.id]);
    expect((await other.api.post(`/nurse/questions/${mine.id}/claim`)).status).toBe(404);

    clock.advance(10 * MINUTE + 1000); // no sweeper needed
    expect(ids(await other.api.get('/nurse/questions'))).toContain(mine.id);
    expect(
      (await chosen.api.get('/nurse/questions')).body.items.find(
        (q: { id: string }) => q.id === mine.id,
      ).chosenForYou,
    ).toBe(false);
  });

  it('questions past 30 minutes are not listed and cannot be claimed (CLAIMS_CLOSED)', async () => {
    const n = await nurse();
    // Asked 30 minutes ago (moving the clock instead would also expire her 15-minute sign-in).
    const q = await question({ createdAt: new Date(clock().getTime() - 30 * MINUTE - 1000) });
    expect(ids(await n.api.get('/nurse/questions'))).not.toContain(q.id);
    const res = await n.api.post(`/nurse/questions/${q.id}/claim`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLAIMS_CLOSED');
  });
});

describe('claiming', () => {
  it('claims with a 10-minute lock; shows in active, /nurse/claim and her status', async () => {
    const w = await woman();
    const n = await nurse();
    const q = await question({ womanId: w.id });
    const res = await n.api.post(`/nurse/questions/${q.id}/claim`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      questionId: q.id,
      expiresAt: new Date(clock().getTime() + 10 * MINUTE).toISOString(),
    });
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('CLAIMED');
    const current = await n.api.get('/nurse/claim');
    expect(current.body).toMatchObject({
      id: q.id,
      status: 'claimed',
      claimExpiresAt: res.body.expiresAt,
    });
    expect(ids(await n.api.get('/nurse/questions?tab=active'))).toEqual([q.id]);
    expect(ids(await n.api.get('/nurse/questions?tab=waiting'))).not.toContain(q.id);
  });

  it('two nurses claiming at the same moment: exactly one wins', async () => {
    const a = await nurse();
    const b = await nurse();
    const q = await question();
    const results = await Promise.all([
      a.api.post(`/nurse/questions/${q.id}/claim`),
      b.api.post(`/nurse/questions/${q.id}/claim`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('QUESTION_ALREADY_CLAIMED');
    expect(await db.claim.count({ where: { questionId: q.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('a second active claim is refused (ACTIVE_CLAIM_EXISTS), even when racing two claims at once', async () => {
    const n = await nurse();
    const [q1, q2, q3] = [await question(), await question(), await question()];
    expect((await n.api.post(`/nurse/questions/${q1.id}/claim`)).status).toBe(200);
    const second = await n.api.post(`/nurse/questions/${q2.id}/claim`);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'ACTIVE_CLAIM_EXISTS',
      details: { questionId: q1.id },
    });

    const m = await nurse();
    const raced = await Promise.all([
      m.api.post(`/nurse/questions/${q2.id}/claim`),
      m.api.post(`/nurse/questions/${q3.id}/claim`),
    ]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.claim.count({ where: { nurseId: m.userId, status: 'ACTIVE' } })).toBe(1);
    // The losing question is still open for others.
    const lost = raced[0]!.status === 409 ? q2 : q3;
    expect((await db.question.findUniqueOrThrow({ where: { id: lost.id } })).status).toBe('OPEN');
  });

  it('an expired lock frees her to claim again (without waiting for the sweeper)', async () => {
    const n = await nurse();
    const [q1, q2] = [await question(), await question()];
    await n.api.post(`/nurse/questions/${q1.id}/claim`);
    clock.advance(10 * MINUTE + 1000);
    expect((await n.api.post(`/nurse/questions/${q2.id}/claim`)).status).toBe(200);
    expect((await db.question.findUniqueOrThrow({ where: { id: q1.id } })).status).toBe('OPEN');
  });

  it('unknown or cancelled question: 404; expired: 410', async () => {
    const n = await nurse();
    expect((await n.api.post('/nurse/questions/nope/claim')).status).toBe(404);
    const q = await question();
    await db.question.update({ where: { id: q.id }, data: { status: 'EXPIRED' } });
    const res = await n.api.post(`/nurse/questions/${q.id}/claim`);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('QUESTION_EXPIRED');
  });
});

describe('release', () => {
  it('release reopens the question for everyone', async () => {
    const a = await nurse();
    const b = await nurse();
    const q = await question();
    await a.api.post(`/nurse/questions/${q.id}/claim`);
    expect((await b.api.post(`/nurse/questions/${q.id}/release`)).status).toBe(403);
    expect((await a.api.post(`/nurse/questions/${q.id}/release`)).status).toBe(204);
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('OPEN');
    expect((await b.api.post(`/nurse/questions/${q.id}/claim`)).status).toBe(200);
  });

  it('a chosen nurse releasing opens it to everyone at once and alerts the others', async () => {
    const chosen = await nurse({ topics: ['pregnancy'] });
    const other = await nurse({ topics: ['pregnancy'] });
    const q = await question({ chosenNurseId: chosen.userId });
    await chosen.api.post(`/nurse/questions/${q.id}/claim`);
    await chosen.api.post(`/nurse/questions/${q.id}/release`);
    const row = await db.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(row.fellBackAt).not.toBeNull();
    expect(ids(await other.api.get('/nurse/questions'))).toContain(q.id);
    await new Promise((r) => setTimeout(r, 100));
    const to = mail.alerts.map((x) => x.to);
    expect(to).toContain(other.email);
    expect(to).not.toContain(chosen.email);
  });

  it('releasing after claims closed expires the question; releasing an expired lock is 410', async () => {
    const n = await nurse();
    const q = await question({ createdAt: new Date(clock().getTime() - 25 * MINUTE) });
    await n.api.post(`/nurse/questions/${q.id}/claim`);
    clock.advance(6 * MINUTE); // claims closed at 30 min, lock still running
    expect((await n.api.post(`/nurse/questions/${q.id}/release`)).status).toBe(204);
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('EXPIRED');

    const m = await nurse(); // fresh sign-in: the clock has moved
    const q2 = await question();
    await m.api.post(`/nurse/questions/${q2.id}/claim`);
    clock.advance(10 * MINUTE + 1000);
    const late = await m.api.post(`/nurse/questions/${q2.id}/release`);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('CLAIM_EXPIRED');
  });
});

describe('answering', () => {
  it('stores the answer, closes the claim, updates her stats and emails the woman (no answer text)', async () => {
    const w = await woman(true);
    const n = await nurse();
    const q = await question({ womanId: w.id });
    await n.api.post(`/nurse/questions/${q.id}/claim`);
    clock.advance(4 * MINUTE);
    const res = await n.api.post(`/nurse/questions/${q.id}/answer`, {
      text: '  Some swelling is common at 30 weeks. Rest with your feet up.  ',
      recommendSeeSomeoneToday: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      questionId: q.id,
      text: 'Some swelling is common at 30 weeks. Rest with your feet up.',
      nurse: { id: n.userId, displayName: 'Nurse Test', role: 'midwife', verified: true },
      recommendSeeSomeoneToday: true,
    });
    const row = await db.question.findUniqueOrThrow({
      where: { id: q.id },
      include: { claims: true },
    });
    expect(row.status).toBe('ANSWERED');
    expect(row.answeredAt).toEqual(clock());
    expect(row.claims[0]!.status).toBe('ANSWERED');
    const profile = await db.nurseProfile.findUniqueOrThrow({ where: { userId: n.userId } });
    expect(profile.avgResponseSeconds).toBe(4 * 60);
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.answersReady).toEqual([
      { to: w.email, url: `http://localhost:5173/questions/${q.id}`, questionId: q.id },
    ]);
    expect(JSON.stringify(mail.answersReady)).not.toContain('swelling');
    // The woman's status shows it answered (the answer itself is shown after collection, Z8).
    expect(ids(await n.api.get('/nurse/questions?tab=completed'))).toEqual([q.id]);
    expect((await n.api.get(`/nurse/questions/${q.id}`)).body.status).toBe('answered');
  });

  it('no email when she turned notifications off', async () => {
    const w = await woman(false);
    const n = await nurse();
    const q = await question({ womanId: w.id });
    await n.api.post(`/nurse/questions/${q.id}/claim`);
    await n.api.post(`/nurse/questions/${q.id}/answer`, { text: 'Answer.' });
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.answersReady).toEqual([]);
  });

  it('only the claim holder, only before the lock ends; validates the text', async () => {
    const a = await nurse();
    const b = await nurse();
    const q = await question();
    await a.api.post(`/nurse/questions/${q.id}/claim`);
    expect((await b.api.post(`/nurse/questions/${q.id}/answer`, { text: 'x' })).status).toBe(403);
    expect((await a.api.post(`/nurse/questions/${q.id}/answer`, { text: '   ' })).status).toBe(400);
    expect(
      (await a.api.post(`/nurse/questions/${q.id}/answer`, { text: 'x'.repeat(5001) })).status,
    ).toBe(400);
    clock.advance(10 * MINUTE + 1000);
    const late = await a.api.post(`/nurse/questions/${q.id}/answer`, { text: 'Too late.' });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('CLAIM_EXPIRED');
    expect(await db.answer.count({ where: { questionId: q.id } })).toBe(0);
  });
});

describe('sweeper', () => {
  it('expires stale claims (reopens), opens chosen windows (alerts), expires old questions; idempotent', async () => {
    const holder = await nurse({ topics: ['pregnancy'] });
    const chosen = await nurse({ topics: ['pregnancy'] });
    const watcher = await nurse({ topics: ['pregnancy'] });
    const claimed = await question();
    const reserved = await question({ chosenNurseId: chosen.userId });
    const old = await question({ createdAt: new Date(clock().getTime() - 25 * MINUTE) });
    await holder.api.post(`/nurse/questions/${claimed.id}/claim`);
    mail.alerts.length = 0;

    clock.advance(10 * MINUTE + 1000);
    const result = await sweeper().sweep();
    expect(result).toEqual({ claimsExpired: 1, openedToAll: 1, questionsExpired: 1 });

    const rows = Object.fromEntries(
      (
        await db.question.findMany({ where: { id: { in: [claimed.id, reserved.id, old.id] } } })
      ).map((q) => [q.id, q]),
    );
    expect(rows[claimed.id]!.status).toBe('OPEN');
    expect(rows[reserved.id]!.fellBackAt).not.toBeNull();
    expect(rows[old.id]).toMatchObject({ status: 'EXPIRED' });
    expect(rows[old.id]!.expiredAt).not.toBeNull();
    expect((await db.claim.findFirstOrThrow({ where: { questionId: claimed.id } })).status).toBe(
      'EXPIRED',
    );

    await new Promise((r) => setTimeout(r, 100));
    const alerted = mail.alerts.filter((a) => a.questionId === reserved.id).map((a) => a.to);
    expect(alerted).toEqual(expect.arrayContaining([holder.email, watcher.email]));
    expect(alerted).not.toContain(chosen.email);

    expect(await sweeper().sweep()).toEqual({
      claimsExpired: 0,
      openedToAll: 0,
      questionsExpired: 0,
    });
  });

  it('a claim that runs out after claims closed expires the question (she pays nothing)', async () => {
    const n = await nurse();
    const q = await question({ createdAt: new Date(clock().getTime() - 25 * MINUTE) });
    await n.api.post(`/nurse/questions/${q.id}/claim`);
    clock.advance(10 * MINUTE + 1000);
    const result = await sweeper().sweep();
    expect(result.claimsExpired).toBe(1);
    expect((await db.question.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('EXPIRED');
  });
});

describe('dashboard', () => {
  it('counts what she can take and what she answered; unapproved nurses see 0 waiting', async () => {
    const n = await nurse();
    await question();
    await question({ chosenNurseId: n.userId });
    const done = await question();
    await n.api.post(`/nurse/questions/${done.id}/claim`);
    await n.api.post(`/nurse/questions/${done.id}/answer`, { text: 'Answer.' });
    const res = await n.api.get('/nurse/dashboard');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      verificationStatus: 'approved',
      available: true,
      topics: ['pregnancy', 'periods'],
      activeClaim: null,
      waitingCount: 2,
      chosenForYouCount: 1,
      answeredToday: 1,
      answeredThisWeek: 1,
      avgResponseMinutes: 0,
      helpful: { percent: null, count: 0 },
    });

    const pending = await nurse({ status: 'PENDING_REVIEW' });
    const p = await pending.api.get('/nurse/dashboard');
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ verificationStatus: 'pending_review', waitingCount: 0 });
  });

  it('Lagos day and week boundaries (UTC+1, weeks start Monday)', () => {
    // Sunday 23:30 UTC = Monday 00:30 Lagos.
    const t = new Date('2026-11-22T23:30:00Z');
    expect(lagosDayStart(t).toISOString()).toBe('2026-11-22T23:00:00.000Z');
    expect(lagosWeekStart(t).toISOString()).toBe('2026-11-22T23:00:00.000Z');
    // Wednesday 10:00 UTC: day starts 23:00 UTC Tuesday; week started Sunday 23:00 UTC.
    const w = new Date('2026-11-25T10:00:00Z');
    expect(lagosDayStart(w).toISOString()).toBe('2026-11-24T23:00:00.000Z');
    expect(lagosWeekStart(w).toISOString()).toBe('2026-11-22T23:00:00.000Z');
  });
});

describe('access', () => {
  it('cases need an approved nurse; women cannot use them', async () => {
    const pending = await nurse({ status: 'PENDING_REVIEW' });
    expect((await pending.api.get('/nurse/questions')).status).toBe(403);
    expect((await pending.api.get('/nurse/claim')).status).toBe(403);
    const n = await nurse();
    expect((await n.api.get('/nurse/questions?tab=bogus')).status).toBe(400);
    expect((await n.api.get('/nurse/questions?tab=completed&cursor=garbage')).status).toBe(400);
    expect((await n.api.get('/nurse/questions/nope')).status).toBe(404);
  });
});
