// Z12: agent tokens (Claude via apps/mcp). Real test database; LLM, facilitator and Stellar faked.
import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../src/db.js';
import { signDraftToken } from '../src/modules/questions/draft-token.js';
import type { AnswerPayer } from '../src/modules/payments/x402-client.js';
import type { TopupChain } from '../src/modules/topups/chain.js';
import type { WalletChain } from '../src/modules/wallets/chain.js';
import { buildTestApp, fakeClock, fakeLlm, memoryEmailSender } from './helpers/app.js';
import { testConfig, testDatabaseUrl } from './helpers/env.js';
import { createNurse, ensureTopics, hideExistingNurses, signUpWoman } from './helpers/people.js';

const db = createDb(testDatabaseUrl());
beforeAll(() => ensureTopics(db));
afterAll(() => db.$disconnect());

const MINUTE = 60_000;
const JWT_SECRET = testConfig().auth.jwtAccessSecret;
const hash = () => randomBytes(32).toString('hex');
const CONSENT = { sharedFields: ['cleaned_text', 'category'], consentVersion: 'mcp-v1' };
const MODE_B = {
  cleanedText: 'My period is two weeks late. Could I be pregnant?',
  assistantNotes: null,
  category: 'periods',
  redFlagSuspected: false,
  statedAge: null,
  pregnancyWeeks: null,
};

// ---------------------------------------------------------------- fakes (as in answers.test.ts)

function fakeFacilitator() {
  return {
    verify: vi.fn<FacilitatorClient['verify']>(async (payload) => ({
      isValid: true,
      payer: (payload.payload as { payer?: string }).payer,
    })),
    settle: vi.fn<FacilitatorClient['settle']>(async () => ({
      success: true,
      transaction: hash(),
      network: 'stellar:testnet',
    })),
    getSupported: vi.fn<FacilitatorClient['getSupported']>(async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
      extensions: [],
      signers: {},
    })),
  };
}
const payer: AnswerPayer = {
  async createPaymentHeader(secret, requiredHeader) {
    const required = decodePaymentRequiredHeader(requiredHeader);
    return encodePaymentSignatureHeader({
      x402Version: 2,
      resource: required.resource,
      accepted: required.accepts[0]!,
      payload: { transaction: 'x', payer: Keypair.fromSecret(secret).publicKey() },
    });
  },
};
const treasury: TopupChain = {
  sendUsdc: async () => ({ txHash: hash() }),
  findTreasuryPaymentByMemo: async () => null,
};
const walletChain: WalletChain = {
  accountState: async () => ({
    exists: true,
    hasUsdcTrustline: true,
    usdcStroops: 10_000_000n,
    sponsor: null,
  }),
  activate: async () => ({ txHash: hash() }),
};

// ---------------------------------------------------------------- setup

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
let facilitator: ReturnType<typeof fakeFacilitator>;

function setup(...replies: (object | string | Error)[]) {
  const llm = fakeLlm(...replies);
  const app = buildTestApp(db, {
    clock,
    emailSender: mail,
    llm,
    facilitator,
    answerPayer: payer,
    payoutChain: treasury,
    walletChain,
    answerChain: { findTransfer: async () => null },
    config: {
      x402: {
        ...testConfig().x402,
        facilitatorApiKey: 'test',
        payToAddress: Keypair.random().publicKey(),
      },
    },
  });
  return { app, llm };
}

beforeEach(async () => {
  clock = fakeClock(new Date());
  mail = memoryEmailSender();
  facilitator = fakeFacilitator();
  await hideExistingNurses(db);
});

/** A woman, her session token and a Claude (agent) token. */
async function womanWithClaude(app: ReturnType<typeof setup>['app'], freeAnswersUsed = 3) {
  const w = await signUpWoman(app, mail);
  await db.user.update({ where: { id: w.userId }, data: { freeAnswersUsed } });
  await db.wallet.update({ where: { userId: w.userId }, data: { activatedAt: clock() } });
  const created = await request(app)
    .post('/auth/agent-tokens')
    .set('Authorization', `Bearer ${w.token}`)
    .send({ label: 'Claude Desktop' });
  expect(created.status).toBe(201);
  const as = (token: string) => ({
    get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: object = {}) =>
      request(app).post(p).set('Authorization', `Bearer ${token}`).send(b),
    patch: (p: string, b: object = {}) =>
      request(app).patch(p).set('Authorization', `Bearer ${token}`).send(b),
    delete: (p: string) => request(app).delete(p).set('Authorization', `Bearer ${token}`),
  });
  return {
    ...w,
    agentToken: created.body.token as string,
    agentTokenId: created.body.id as string,
    app: as(w.token),
    claude: as(created.body.token as string),
  };
}

/** An answered question for her (claimed and answered by a nurse). */
async function answered(womanId: string, source: 'WEB' | 'MCP' = 'MCP', isFree = false) {
  const nurse = await createNurse(db);
  const now = clock();
  const q = await db.question.create({
    data: {
      womanId,
      source,
      status: 'ANSWERED',
      originalText: 'q',
      cleanedText: 'Q?',
      topicSlug: 'periods',
      expiresAt: new Date(now.getTime() + 30 * MINUTE),
      priceKobo: 50_000,
      priceStroops: 3_125_000n,
      isFree,
      answeredAt: now,
      consent: { create: { sharedFields: ['CLEANED_TEXT', 'CATEGORY'], consentVersion: 'v1' } },
    },
  });
  const claim = await db.claim.create({
    data: {
      questionId: q.id,
      nurseId: nurse.userId,
      status: 'ANSWERED',
      expiresAt: now,
      endedAt: now,
    },
  });
  await db.answer.create({
    data: { questionId: q.id, claimId: claim.id, nurseId: nurse.userId, text: 'The answer.' },
  });
  return q;
}

// ---------------------------------------------------------------- tokens

describe('agent tokens', () => {
  it('created once (clat_...), listed without the secret, revoked immediately', async () => {
    const { app } = setup();
    const w = await womanWithClaude(app);
    expect(w.agentToken).toMatch(/^clat_[A-Za-z0-9_-]{40,}$/);

    const list = await w.app.get('/auth/agent-tokens');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([
      {
        id: w.agentTokenId,
        label: 'Claude Desktop',
        createdAt: expect.any(String),
        lastUsedAt: null,
      },
    ]);
    expect(JSON.stringify(list.body)).not.toContain(w.agentToken);
    const row = await db.agentToken.findUniqueOrThrow({ where: { id: w.agentTokenId } });
    expect(row.tokenHash).not.toContain(w.agentToken.slice(5));

    expect((await w.claude.get('/wallet')).status).toBe(200);
    expect(
      (await db.agentToken.findUniqueOrThrow({ where: { id: w.agentTokenId } })).lastUsedAt,
    ).not.toBeNull();

    expect((await w.app.delete(`/auth/agent-tokens/${w.agentTokenId}`)).status).toBe(204);
    const after = await w.claude.get('/wallet');
    expect(after.status).toBe(401);
    expect((await w.app.get('/auth/agent-tokens')).body).toEqual([]);
  });

  it('at most 5 active; a nurse cannot create one; label required', async () => {
    const { app } = setup();
    const w = await womanWithClaude(app);
    for (let i = 0; i < 4; i++) {
      expect((await w.app.post('/auth/agent-tokens', { label: `c${i}` })).status).toBe(201);
    }
    const sixth = await w.app.post('/auth/agent-tokens', { label: 'too many' });
    expect(sixth.status).toBe(409);
    expect((await w.app.post('/auth/agent-tokens', { label: '' })).status).toBe(400);

    const n = await createNurse(db);
    await request(app)
      .post('/auth/code/request')
      .send({ email: n.email, purpose: 'login', app: 'nurses' });
    const login = await request(app)
      .post('/auth/code/verify')
      .send({ email: n.email, code: mail.lastCode(n.email), purpose: 'login', app: 'nurses' });
    const res = await request(app)
      .post('/auth/agent-tokens')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ label: 'x' });
    expect(res.status).toBe(403);
  });

  it('works ONLY on the allow-listed routes: everything else is 403 for Claude', async () => {
    const { app } = setup();
    const w = await womanWithClaude(app);
    const forbidden = [
      w.claude.get('/me'),
      w.claude.get('/me/settings'),
      w.claude.patch('/me/settings', { mcpSpendingLimitPerAnswerKobo: 1_000_000 }),
      w.claude.get('/me/questions'),
      w.claude.get('/wallet/transactions'),
      w.claude.post('/topups', { amountKobo: 100_000 }),
      w.claude.post('/chat', { messages: [{ role: 'user', text: 'hi' }] }),
      w.claude.get('/auth/agent-tokens'),
      w.claude.post('/auth/agent-tokens', { label: 'more' }),
      w.claude.post('/auth/logout-all'),
      w.claude.get('/nurse/dashboard'),
      w.claude.get('/admin/nurses'),
    ];
    for (const res of await Promise.all(forbidden)) {
      expect(res.status).toBe(403);
    }
    expect((await w.claude.get('/wallet')).status).toBe(200);
  });

  it('an unknown or malformed agent token is 401 on allowed routes', async () => {
    const { app } = setup();
    const res = await request(app).get('/wallet').set('Authorization', 'Bearer clat_nope');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------- questions from Claude

describe('questions from Claude', () => {
  it('draft then send: stored with source MCP, the exact draft she confirmed', async () => {
    const { app, llm } = setup(MODE_B);
    const w = await womanWithClaude(app, 0);
    const draft = await w.claude.post('/chat/draft', {
      messages: [{ role: 'user', text: 'my period is two weeks late could i be pregnant' }],
    });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ kind: 'draft', offer: { isFree: true } });

    const sent = await w.claude.post('/questions', {
      originalText: 'my period is two weeks late could i be pregnant',
      source: 'mcp',
      consent: CONSENT,
      draftToken: draft.body.draftToken,
    });
    expect(sent.status).toBe(201);
    const q = await db.question.findUniqueOrThrow({ where: { id: sent.body.id } });
    expect(q).toMatchObject({ source: 'MCP', cleanedText: MODE_B.cleanedText });
    expect(llm.calls).toHaveLength(1); // the draft token: no second LLM run

    const status = await w.claude.get(`/questions/${sent.body.id}/status`);
    expect(status.body).toMatchObject({ id: sent.body.id, status: 'open' });
  });

  it('source must match who is asking', async () => {
    const { app } = setup();
    const w = await womanWithClaude(app);
    const token = (
      await signDraftToken(
        { originalText: 'x', ...MODE_B, ageRange: null } as never,
        w.userId,
        JWT_SECRET,
        clock(),
      )
    ).token;
    const asWeb = await w.claude.post('/questions', {
      originalText: 'x',
      source: 'web',
      consent: CONSENT,
      draftToken: token,
    });
    expect(asWeb.status).toBe(400);
    expect(asWeb.body.error.details.field).toBe('source');
    const appAsMcp = await w.app.post('/questions', {
      originalText: 'x',
      source: 'mcp',
      consent: CONSENT,
      draftToken: token,
    });
    expect(appAsMcp.status).toBe(400);
  });

  it('an emergency from Claude gets the free guidance, nothing queued, logged as MCP', async () => {
    // The LLM's red-flag judgement (the fixed list has its own tests).
    const { app } = setup({ ...MODE_B, redFlagSuspected: true });
    const w = await womanWithClaude(app);
    const before = await db.emergencyEvent.count({ where: { source: 'MCP' } });
    const questions = await db.question.count({ where: { womanId: w.userId } });
    const res = await w.claude.post('/chat/draft', {
      messages: [{ role: 'user', text: 'something feels very wrong with my pregnancy' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('emergency');
    expect(await db.emergencyEvent.count({ where: { source: 'MCP' } })).toBe(before + 1);
    expect(await db.question.count({ where: { womanId: w.userId } })).toBe(questions);
  });

  it("Claude's own spending limit applies, and Claude cannot approve past it", async () => {
    const { app } = setup(MODE_B, MODE_B);
    const w = await womanWithClaude(app, 3); // no free answers: she pays ₦500
    await db.userSettings.upsert({
      where: { userId: w.userId },
      update: { mcpSpendingLimitPerAnswerKobo: 20_000, spendingLimitPerAnswerKobo: 100_000 },
      create: { userId: w.userId, mcpSpendingLimitPerAnswerKobo: 20_000 },
    });
    const draft = await w.claude.post('/chat/draft', {
      messages: [{ role: 'user', text: 'my period is two weeks late could i be pregnant' }],
    });
    expect(draft.body.offer).toMatchObject({ isFree: false, exceedsSpendingLimit: true });

    const res = await w.claude.post('/questions', {
      originalText: 'my period is two weeks late could i be pregnant',
      source: 'mcp',
      consent: CONSENT,
      draftToken: draft.body.draftToken,
      approvedAboveLimit: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'SPENDING_LIMIT_EXCEEDED',
      details: { spendingLimitKobo: 20_000 },
    });
    // The same woman in her app: her own (higher) limit.
    const web = await w.app.post('/chat/draft', {
      messages: [{ role: 'user', text: 'my period is two weeks late could i be pregnant' }],
    });
    expect(web.body.offer.exceedsSpendingLimit).toBe(false);
  });
});

// ---------------------------------------------------------------- collecting through Claude

describe('collecting an answer through Claude', () => {
  it('"ask before each payment" (default on): 409 until she confirms, then paid over x402', async () => {
    const { app } = setup();
    const w = await womanWithClaude(app);
    const q = await answered(w.userId);

    const ask = await w.claude.post(`/me/questions/${q.id}/collect`);
    expect(ask.status).toBe(409);
    expect(ask.body.error).toMatchObject({
      code: 'PAYMENT_CONFIRMATION_REQUIRED',
      details: { price: { kobo: 50_000, usdc: '0.3125000' } },
    });
    expect(facilitator.settle).not.toHaveBeenCalled();

    const paid = await w.claude.post(`/me/questions/${q.id}/collect`, { confirmPayment: true });
    expect(paid.status).toBe(200);
    expect(paid.body.answer.text).toBe('The answer.');
    expect(paid.body.payment.paidFromTreasury).toBe(false);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it('with "ask before each payment" off, no confirmation is needed', async () => {
    const { app } = setup();
    const w = await womanWithClaude(app);
    await db.userSettings.upsert({
      where: { userId: w.userId },
      update: { mcpAskBeforeEachPayment: false },
      create: { userId: w.userId, mcpAskBeforeEachPayment: false },
    });
    const q = await answered(w.userId);
    expect((await w.claude.post(`/me/questions/${q.id}/collect`)).status).toBe(200);
  });

  it('a free answer never asks', async () => {
    const { app } = setup();
    const w = await womanWithClaude(app, 0);
    const q = await answered(w.userId, 'MCP', true);
    const res = await w.claude.post(`/me/questions/${q.id}/collect`);
    expect(res.status).toBe(200);
    expect(res.body.payment.paidFromTreasury).toBe(true);
  });

  it("above Claude's limit: refused even with confirmation and approval", async () => {
    const { app } = setup();
    const w = await womanWithClaude(app);
    await db.userSettings.upsert({
      where: { userId: w.userId },
      update: { mcpSpendingLimitPerAnswerKobo: 20_000 },
      create: { userId: w.userId, mcpSpendingLimitPerAnswerKobo: 20_000 },
    });
    const q = await answered(w.userId);
    const res = await w.claude.post(`/me/questions/${q.id}/collect`, {
      confirmPayment: true,
      approvedAboveLimit: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SPENDING_LIMIT_EXCEEDED');
    expect(facilitator.settle).not.toHaveBeenCalled();
    // In her app (her own ₦1,000 limit) it goes through.
    expect((await w.app.post(`/me/questions/${q.id}/collect`)).status).toBe(200);
  });

  it('two agents, one queue: a web question and a Claude question both reach the nurse queue and are both paid via x402', async () => {
    const { app } = setup(MODE_B);
    const w = await womanWithClaude(app);
    const nurse = await createNurse(db, { topics: ['periods'] });
    await request(app)
      .post('/auth/code/request')
      .send({ email: nurse.email, purpose: 'login', app: 'nurses' });
    const login = await request(app)
      .post('/auth/code/verify')
      .send({
        email: nurse.email,
        code: mail.lastCode(nurse.email),
        purpose: 'login',
        app: 'nurses',
      });
    const nurseApi = {
      get: (p: string) =>
        request(app).get(p).set('Authorization', `Bearer ${login.body.accessToken}`),
      post: (p: string, b: object = {}) =>
        request(app).post(p).set('Authorization', `Bearer ${login.body.accessToken}`).send(b),
    };

    const draftToken = (text: string) =>
      signDraftToken(
        { originalText: text, ...MODE_B, ageRange: null } as never,
        w.userId,
        JWT_SECRET,
        clock(),
      ).then((s) => s.token);
    const web = await w.app.post('/questions', {
      originalText: 'from the web app',
      source: 'web',
      consent: CONSENT,
      draftToken: await draftToken('from the web app'),
    });
    const fromClaude = await w.claude.post('/questions', {
      originalText: 'from claude',
      source: 'mcp',
      consent: CONSENT,
      draftToken: await draftToken('from claude'),
    });
    expect([web.status, fromClaude.status]).toEqual([201, 201]);

    const waiting = await nurseApi.get('/nurse/questions?tab=waiting');
    const ids = (waiting.body.items as { id: string }[]).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([web.body.id, fromClaude.body.id]));

    for (const id of [web.body.id, fromClaude.body.id]) {
      expect((await nurseApi.post(`/nurse/questions/${id}/claim`)).status).toBe(200);
      expect(
        (await nurseApi.post(`/nurse/questions/${id}/answer`, { text: `Answer for ${id}` })).status,
      ).toBe(201);
    }
    const paidWeb = await w.app.post(`/me/questions/${web.body.id}/collect`);
    const paidClaude = await w.claude.post(`/me/questions/${fromClaude.body.id}/collect`, {
      confirmPayment: true,
    });
    expect([paidWeb.status, paidClaude.status]).toEqual([200, 200]);
    expect(paidWeb.body.payment.stellarTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(paidClaude.body.payment.stellarTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(facilitator.settle).toHaveBeenCalledTimes(2);
    const sources = await db.question.findMany({
      where: { id: { in: [web.body.id, fromClaude.body.id] } },
      select: { source: true },
    });
    expect(sources.map((s) => s.source).sort()).toEqual(['MCP', 'WEB']);
  });
});
