// Z6 questions + nurse directory against the real test database (scripted LLM, memory email).
import type { QuestionDraft } from '@carelayer/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { signDraftToken } from '../src/modules/questions/draft-token.js';
import { buildTestApp, fakeClock, fakeLlm, memoryEmailSender } from './helpers/app.js';
import { testConfig, testDatabaseUrl } from './helpers/env.js';
import { createNurse, ensureTopics, hideExistingNurses, signUpWoman } from './helpers/people.js';

const db = createDb(testDatabaseUrl());
beforeAll(() => ensureTopics(db));
afterAll(() => db.$disconnect());

const JWT_SECRET = testConfig().auth.jwtAccessSecret;
const MINUTE = 60_000;
const CONSENT_ALL = {
  sharedFields: [
    'cleaned_text',
    'original_text',
    'assistant_notes',
    'category',
    'age_range',
    'pregnancy_weeks',
  ],
  consentVersion: 'consent-v1',
};

const DRAFT: QuestionDraft = {
  originalText: 'my feet dey swell small small, im 30 weeks pregnant and i am 24 is it normal',
  cleanedText: 'My feet are swelling a little. I am 30 weeks pregnant and I am 24. Is it normal?',
  assistantNotes: 'Worse in the evening.',
  category: 'pregnancy',
  ageRange: 'age_18_24',
  pregnancyWeeks: 30,
};

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;

function setup(...replies: (object | string | Error)[]) {
  const llm = fakeLlm(...replies);
  const app = buildTestApp(db, { clock, emailSender: mail, llm });
  return { app, llm };
}

beforeEach(async () => {
  clock = fakeClock(new Date());
  mail = memoryEmailSender();
  await hideExistingNurses(db);
});

const tokenFor = async (userId: string, draft = DRAFT) =>
  (await signDraftToken(draft, userId, JWT_SECRET, clock())).token;

function send(app: ReturnType<typeof setup>['app'], token: string, body: object) {
  return request(app).post('/questions').set('Authorization', `Bearer ${token}`).send(body);
}

const waitForAlerts = async (n: number) => {
  for (let i = 0; i < 100 && mail.alerts.length < n; i++)
    await new Promise((r) => setTimeout(r, 20));
};

describe('POST /questions', () => {
  it('stores exactly the draft she reviewed: original verbatim, cleaned separately, consent, 30-min expiry', async () => {
    const { app, llm } = setup();
    const w = await signUpWoman(app, mail);
    const res = await send(app, w.token, {
      originalText: DRAFT.originalText,
      source: 'web',
      consent: CONSENT_ALL,
      draftToken: await tokenFor(w.userId),
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'question',
      status: 'open',
      category: 'pregnancy',
      price: { kobo: 50_000, usdc: '0.3125000' },
      isFree: true,
      nurseSelection: 'first_available',
      chosenUntil: null,
      questionKey: null,
    });
    expect(new Date(res.body.claimsCloseAt).getTime() - clock().getTime()).toBe(30 * MINUTE);
    expect(llm.calls).toHaveLength(0); // the draft is used, not a second LLM run

    const q = await db.question.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { consent: true },
    });
    expect(q).toMatchObject({
      womanId: w.userId,
      source: 'WEB',
      status: 'OPEN',
      originalText: DRAFT.originalText,
      cleanedText: DRAFT.cleanedText,
      assistantNotes: 'Worse in the evening.',
      topicSlug: 'pregnancy',
      ageRange: 'AGE_18_24',
      pregnancyWeeks: 30,
      priceKobo: 50_000,
      priceStroops: 3_125_000n,
      isFree: true,
    });
    expect(q.cleanedText).not.toBe(q.originalText);
    expect(q.consent).toMatchObject({ consentVersion: 'consent-v1' });
    expect(q.consent!.sharedFields.sort()).toEqual(
      [
        'AGE_RANGE',
        'ASSISTANT_NOTES',
        'CATEGORY',
        'CLEANED_TEXT',
        'ORIGINAL_TEXT',
        'PREGNANCY_WEEKS',
      ].sort(),
    );
  });

  it('what she did not agree to share is not stored', async () => {
    const { app } = setup();
    const w = await signUpWoman(app, mail);
    const res = await send(app, w.token, {
      originalText: DRAFT.originalText,
      source: 'web',
      consent: { sharedFields: ['cleaned_text', 'category'], consentVersion: 'consent-v1' },
      draftToken: await tokenFor(w.userId),
    });
    expect(res.status).toBe(201);
    const q = await db.question.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(q).toMatchObject({ assistantNotes: null, ageRange: null, pregnancyWeeks: null });
    // Her original words are always kept for her; nurses see them only if shared (Z7).
    expect(q.originalText).toBe(DRAFT.originalText);
  });

  it('without a draft token (other agents) the server prepares the question itself', async () => {
    const { app, llm } = setup({
      cleanedText: 'My period is two weeks late. Could I be pregnant?',
      assistantNotes: null,
      category: 'pregnancy',
      redFlagSuspected: false,
      statedAge: null,
      pregnancyWeeks: null,
    });
    const w = await signUpWoman(app, mail);
    const res = await send(app, w.token, {
      originalText: 'my period is two weeks late could i be pregnant',
      source: 'web',
      consent: CONSENT_ALL,
    });
    expect(res.status).toBe(201);
    expect(llm.calls).toHaveLength(1);
    const q = await db.question.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(q.cleanedText).toBe('My period is two weeks late. Could I be pregnant?');
    expect(q.originalText).toBe('my period is two weeks late could i be pregnant');
  });

  describe('draft token', () => {
    it('refuses another woman’s token, a forged one, and an expired one', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const other = await signUpWoman(app, mail);
      const base = { originalText: DRAFT.originalText, source: 'web', consent: CONSENT_ALL };

      const theirs = await send(app, w.token, {
        ...base,
        draftToken: await tokenFor(other.userId),
      });
      expect(theirs.status).toBe(400);
      expect(theirs.body.error.details.field).toBe('draftToken');

      const forged = (await signDraftToken(DRAFT, w.userId, 'x'.repeat(40), clock())).token;
      expect((await send(app, w.token, { ...base, draftToken: forged })).status).toBe(400);

      // Signed 121 minutes ago (her access token stays fresh: it only lives 15 minutes).
      const old = (
        await signDraftToken(
          DRAFT,
          w.userId,
          JWT_SECRET,
          new Date(clock().getTime() - 121 * MINUTE),
        )
      ).token;
      const expired = await send(app, w.token, { ...base, draftToken: old });
      expect(expired.status).toBe(400);
      expect(expired.body.error.message).toMatch(/expired/);
    });

    it('refuses an originalText that differs from the draft', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const res = await send(app, w.token, {
        originalText: `${DRAFT.originalText} and also my back`,
        source: 'web',
        consent: CONSENT_ALL,
        draftToken: await tokenFor(w.userId),
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe('originalText');
    });

    it('an access token is not a draft token', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const res = await send(app, w.token, {
        originalText: DRAFT.originalText,
        source: 'web',
        consent: CONSENT_ALL,
        draftToken: w.token,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('consent', () => {
    it('no consent: 400 CONSENT_REQUIRED, nothing created', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const before = await db.question.count();
      const res = await send(app, w.token, { originalText: DRAFT.originalText, source: 'web' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CONSENT_REQUIRED');
      expect(await db.question.count()).toBe(before);
    });

    it('consent that does not share the question or its topic: CONSENT_REQUIRED with what is missing', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const res = await send(app, w.token, {
        originalText: DRAFT.originalText,
        source: 'web',
        consent: { sharedFields: ['original_text'], consentVersion: 'consent-v1' },
        draftToken: await tokenFor(w.userId),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'CONSENT_REQUIRED',
        details: { missing: ['cleaned_text', 'category'] },
      });
    });

    it('unknown shared fields and a missing consent version are rejected', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const bad = await send(app, w.token, {
        originalText: DRAFT.originalText,
        source: 'web',
        consent: { sharedFields: ['cleaned_text', 'category', 'name'], consentVersion: '' },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('emergencies', () => {
    it('fixed red flag: emergency (200), no question, EmergencyEvent source QUESTION', async () => {
      const { app, llm } = setup();
      const w = await signUpWoman(app, mail);
      const before = { q: await db.question.count(), e: await db.emergencyEvent.count() };
      const res = await send(app, w.token, {
        originalText: 'I am pregnant and I just had a seizure while pregnant, what now',
        source: 'web',
        consent: CONSENT_ALL,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        kind: 'emergency',
        triggeredBy: ['seizure_pregnancy_or_postpartum'],
      });
      expect(llm.calls).toHaveLength(0);
      expect(await db.question.count()).toBe(before.q);
      expect(await db.emergencyEvent.count()).toBe(before.e + 1);
      const ev = await db.emergencyEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      expect(ev.source).toBe('QUESTION');
      expect(mail.alerts).toHaveLength(0);
    });

    it('the LLM’s red flag (no draft token): emergency, no question', async () => {
      const { app } = setup({
        cleanedText: 'I am 6 months pregnant and bleeding heavily. What should I do?',
        assistantNotes: null,
        category: 'pregnancy',
        redFlagSuspected: true,
      });
      const w = await signUpWoman(app, mail);
      const before = await db.question.count();
      const res = await send(app, w.token, {
        originalText: 'I am 6 months pregnant and bleeding heavily, what should I do?',
        source: 'web',
        consent: CONSENT_ALL,
      });
      expect(res.body).toMatchObject({ kind: 'emergency', triggeredBy: ['llm'] });
      expect(await db.question.count()).toBe(before);
    });

    it('the red-flag list runs even with a valid draft token', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const draft = {
        ...DRAFT,
        originalText: 'i want to kill myself',
        cleanedText: 'I want to kill myself.',
      };
      const res = await send(app, w.token, {
        originalText: draft.originalText,
        source: 'web',
        consent: CONSENT_ALL,
        draftToken: await tokenFor(w.userId, draft),
      });
      expect(res.body.kind).toBe('emergency');
    });
  });

  describe('price, free answers and spending limit', () => {
    it('3 free answers: in-flight free questions are reserved, the 4th is paid', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const results: boolean[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await send(app, w.token, {
          originalText: DRAFT.originalText,
          source: 'web',
          consent: CONSENT_ALL,
          draftToken: await tokenFor(w.userId),
        });
        expect(res.status).toBe(201);
        results.push(res.body.isFree);
      }
      expect(results).toEqual([true, true, true, false]);
      // An expired free question gives its free answer back.
      const first = await db.question.findFirstOrThrow({
        where: { womanId: w.userId, isFree: true },
        orderBy: { createdAt: 'asc' },
      });
      await db.question.update({ where: { id: first.id }, data: { status: 'EXPIRED' } });
      const wallet = await request(app).get('/wallet').set('Authorization', `Bearer ${w.token}`);
      expect(wallet.body.freeAnswersRemaining).toBe(1);
    });

    it('paid answer above her limit: 409 SPENDING_LIMIT_EXCEEDED unless she approves it', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      await db.user.update({ where: { id: w.userId }, data: { freeAnswersUsed: 3 } });
      await db.userSettings.update({
        where: { userId: w.userId },
        data: { spendingLimitPerAnswerKobo: 30_000 },
      });
      const body = {
        originalText: DRAFT.originalText,
        source: 'web',
        consent: CONSENT_ALL,
        draftToken: await tokenFor(w.userId),
      };
      const refused = await send(app, w.token, body);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({
        code: 'SPENDING_LIMIT_EXCEEDED',
        details: { priceKobo: 50_000, spendingLimitKobo: 30_000 },
      });
      const approved = await send(app, w.token, { ...body, approvedAboveLimit: true });
      expect(approved.status).toBe(201);
      expect(approved.body.isFree).toBe(false);
    });

    it('a free answer is never blocked by her limit', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      await db.userSettings.update({
        where: { userId: w.userId },
        data: { spendingLimitPerAnswerKobo: 0 },
      });
      const res = await send(app, w.token, {
        originalText: DRAFT.originalText,
        source: 'web',
        consent: CONSENT_ALL,
        draftToken: await tokenFor(w.userId),
      });
      expect(res.status).toBe(201);
    });
  });

  describe('chosen nurse and female only', () => {
    it('a chosen nurse gets a 10-minute window and the only alert', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const chosen = await createNurse(db, { name: 'Amaka Chosen' });
      const other = await createNurse(db, { name: 'Other Nurse' });
      const res = await send(app, w.token, {
        originalText: DRAFT.originalText,
        source: 'web',
        consent: CONSENT_ALL,
        draftToken: await tokenFor(w.userId),
        nurseSelection: 'chosen_nurse',
        chosenNurseId: chosen.userId,
      });
      expect(res.status).toBe(201);
      expect(res.body.nurseSelection).toBe('chosen_nurse');
      expect(new Date(res.body.chosenUntil).getTime() - clock().getTime()).toBe(10 * MINUTE);
      const q = await db.question.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(q).toMatchObject({ selection: 'CHOSEN_NURSE', chosenNurseId: chosen.userId });

      await waitForAlerts(1);
      await new Promise((r) => setTimeout(r, 100));
      expect(mail.alerts.map((a) => a.to)).toEqual([chosen.email]);
      expect(mail.alerts.map((a) => a.to)).not.toContain(other.email);
      expect(mail.alerts[0]).toMatchObject({ chosenForYou: true, topicLabel: 'Pregnancy' });
    });

    it.each([
      ['unavailable', { available: false }, {}],
      ['not approved', { status: 'PENDING_REVIEW' as const }, {}],
      ['male, with femaleOnly', { gender: 'MALE' as const }, { femaleOnly: true }],
    ])(
      'refuses a chosen nurse who is %s (409 CHOSEN_NURSE_UNAVAILABLE)',
      async (_, nurseOpts, extra) => {
        const { app } = setup();
        const w = await signUpWoman(app, mail);
        const nurse = await createNurse(db, nurseOpts);
        const res = await send(app, w.token, {
          originalText: DRAFT.originalText,
          source: 'web',
          consent: CONSENT_ALL,
          draftToken: await tokenFor(w.userId),
          nurseSelection: 'chosen_nurse',
          chosenNurseId: nurse.userId,
          ...extra,
        });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CHOSEN_NURSE_UNAVAILABLE');
      },
    );

    it('chosen_nurse needs a nurse id; first_available must not send one', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const base = { originalText: DRAFT.originalText, source: 'web', consent: CONSENT_ALL };
      const a = await send(app, w.token, { ...base, nurseSelection: 'chosen_nurse' });
      expect(a.status).toBe(400);
      expect(a.body.error.details.field).toBe('chosenNurseId');
      const b = await send(app, w.token, { ...base, chosenNurseId: 'abc' });
      expect(b.status).toBe(400);
    });

    it('first available alerts approved, available nurses for that topic (female only when asked); topic only, never her question', async () => {
      const { app } = setup();
      const w = await signUpWoman(app, mail);
      const pregnancyF = await createNurse(db, { topics: ['pregnancy'] });
      const pregnancyM = await createNurse(db, { topics: ['pregnancy'], gender: 'MALE' });
      const periodsOnly = await createNurse(db, { topics: ['periods'] });
      const away = await createNurse(db, { topics: ['pregnancy'], available: false });
      const pending = await createNurse(db, { topics: ['pregnancy'], status: 'PENDING_REVIEW' });

      const res = await send(app, w.token, {
        originalText: DRAFT.originalText,
        source: 'web',
        consent: CONSENT_ALL,
        draftToken: await tokenFor(w.userId),
        femaleOnly: true,
      });
      expect(res.status).toBe(201);
      await waitForAlerts(1);
      await new Promise((r) => setTimeout(r, 100));
      const to = mail.alerts.map((a) => a.to);
      expect(to).toEqual([pregnancyF.email]);
      for (const n of [pregnancyM, periodsOnly, away, pending]) expect(to).not.toContain(n.email);
      const alert = mail.alerts[0]!;
      expect(alert).toMatchObject({ chosenForYou: false, url: 'http://localhost:5174/cases' });
      expect(JSON.stringify(alert)).not.toContain('swell');
    });
  });

  it('source must be "web" for a signed-in woman', async () => {
    const { app } = setup();
    const w = await signUpWoman(app, mail);
    const res = await send(app, w.token, {
      originalText: DRAFT.originalText,
      source: 'mcp',
      consent: CONSENT_ALL,
      draftToken: await tokenFor(w.userId),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('source');
  });
});

describe('GET /questions/:id/status and her list', () => {
  async function ask(app: ReturnType<typeof setup>['app'], w: { token: string; userId: string }) {
    const res = await send(app, w.token, {
      originalText: DRAFT.originalText,
      source: 'web',
      consent: CONSENT_ALL,
      draftToken: await tokenFor(w.userId),
    });
    clock.advance(1000);
    return res.body.id as string;
  }

  it('status for her own question; 404 for anyone else’s', async () => {
    const { app } = setup();
    const w = await signUpWoman(app, mail);
    const other = await signUpWoman(app, mail);
    const id = await ask(app, w);
    const res = await request(app)
      .get(`/questions/${id}/status`)
      .set('Authorization', `Bearer ${w.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      status: 'open',
      category: 'pregnancy',
      answeredAt: null,
      expiredAt: null,
    });
    const theirs = await request(app)
      .get(`/questions/${id}/status`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(theirs.status).toBe(404);
  });

  it('GET /me/questions: newest first, cursor pages, status filters incl. "active"', async () => {
    const { app } = setup();
    const w = await signUpWoman(app, mail);
    const ids = [await ask(app, w), await ask(app, w), await ask(app, w)];
    await db.question.update({
      where: { id: ids[0] },
      data: { status: 'EXPIRED', expiredAt: clock() },
    });

    const page1 = await request(app)
      .get('/me/questions?limit=2')
      .set('Authorization', `Bearer ${w.token}`);
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((q: { id: string }) => q.id)).toEqual([ids[2], ids[1]]);
    const page2 = await request(app)
      .get(`/me/questions?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set('Authorization', `Bearer ${w.token}`);
    expect(page2.body).toMatchObject({ nextCursor: null });
    expect(page2.body.items.map((q: { id: string }) => q.id)).toEqual([ids[0]]);

    const active = await request(app)
      .get('/me/questions?status=active')
      .set('Authorization', `Bearer ${w.token}`);
    expect(active.body.items).toHaveLength(2);
    const expired = await request(app)
      .get('/me/questions?status=expired')
      .set('Authorization', `Bearer ${w.token}`);
    expect(expired.body.items.map((q: { id: string }) => q.id)).toEqual([ids[0]]);

    expect(
      (
        await request(app)
          .get('/me/questions?status=nope')
          .set('Authorization', `Bearer ${w.token}`)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get('/me/questions?cursor=garbage')
          .set('Authorization', `Bearer ${w.token}`)
      ).status,
    ).toBe(400);
  });

  it('GET /me/questions/:id shows both texts; the answer stays hidden until collected', async () => {
    const { app } = setup();
    const w = await signUpWoman(app, mail);
    const id = await ask(app, w);
    const res = await request(app)
      .get(`/me/questions/${id}`)
      .set('Authorization', `Bearer ${w.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      status: 'open',
      originalText: DRAFT.originalText,
      cleanedText: DRAFT.cleanedText,
      isFree: true,
      chosenNurse: null,
      femaleOnly: false,
      answer: null,
      feedback: null,
    });
  });
});

describe('GET /nurses', () => {
  it('lists approved, available nurses with public fields only; filters by topic and femaleOnly', async () => {
    const { app } = setup();
    const w = await signUpWoman(app, mail);
    const fast = await createNurse(db, {
      name: 'Zainab Fast',
      topics: ['pregnancy'],
      avgResponseSeconds: 300,
    });
    const slow = await createNurse(db, {
      name: 'Bisi Slow',
      topics: ['pregnancy', 'general'],
      avgResponseSeconds: 1800,
    });
    const male = await createNurse(db, {
      name: 'Musa Male',
      gender: 'MALE',
      role: 'NURSE',
      topics: ['general'],
    });
    await createNurse(db, { name: 'Away', available: false });
    await createNurse(db, { name: 'Pending', status: 'PENDING_REVIEW' });

    const all = await request(app).get('/nurses').set('Authorization', `Bearer ${w.token}`);
    expect(all.status).toBe(200);
    expect(all.body.map((n: { id: string }) => n.id)).toEqual([
      fast.userId,
      slow.userId,
      male.userId,
    ]);
    expect(all.body[0]).toEqual({
      id: fast.userId,
      fullName: 'Zainab Fast',
      role: 'midwife',
      gender: 'female',
      yearsOfPractice: 5,
      bio: 'Midwife in Lagos.',
      languages: ['english', 'yoruba'],
      topics: ['pregnancy'],
      available: true,
      verified: true,
      avgResponseMinutes: 5,
      helpful: { percent: null, count: 0 },
    });
    const body = JSON.stringify(all.body);
    expect(body).not.toMatch(/@example\.com|RM-|licence|stellar|email/i);

    const general = await request(app)
      .get('/nurses?topic=general')
      .set('Authorization', `Bearer ${w.token}`);
    expect(general.body.map((n: { id: string }) => n.id)).toEqual([slow.userId, male.userId]);
    const female = await request(app)
      .get('/nurses?topic=general&femaleOnly=true')
      .set('Authorization', `Bearer ${w.token}`);
    expect(female.body.map((n: { id: string }) => n.id)).toEqual([slow.userId]);

    expect(
      (await request(app).get('/nurses?topic=dentistry').set('Authorization', `Bearer ${w.token}`))
        .status,
    ).toBe(400);
    expect((await request(app).get('/nurses')).status).toBe(401);
  });
});
