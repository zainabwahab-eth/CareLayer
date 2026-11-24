// Saved chats (2026-11-24): POST /chat saves to a conversation; GET/DELETE /chat/conversations.
// Real test database, scripted LLM (no network).
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { LlmUnavailableError } from '../src/modules/llm/client.js';
import { excerpt } from '../src/modules/chat/conversations.js';
import { buildTestApp, fakeClock, fakeLlm, memoryEmailSender } from './helpers/app.js';
import { testDatabaseUrl } from './helpers/env.js';
import { ensureTopics, signUpWoman } from './helpers/people.js';

const db = createDb(testDatabaseUrl());
beforeAll(() => ensureTopics(db));
afterAll(() => db.$disconnect());

const modeA = (replyText: string, over: object = {}) => ({
  replyText,
  redFlagSuspected: false,
  offerEscalation: false,
  suggestedCategory: null,
  ...over,
});
const user = (text: string) => ({ role: 'user', text });
const bot = (text: string) => ({ role: 'assistant', text });

let clock: ReturnType<typeof fakeClock>;
let mail: ReturnType<typeof memoryEmailSender>;
beforeEach(() => {
  clock = fakeClock(new Date());
  mail = memoryEmailSender();
});

async function setup(...replies: (object | string | Error)[]) {
  const app = buildTestApp(db, { clock, emailSender: mail, llm: fakeLlm(...replies) });
  const w = await signUpWoman(app, mail);
  const as = (token: string) => ({
    chat: (body: object) =>
      request(app).post('/chat').set('Authorization', `Bearer ${token}`).send(body),
    list: (query = '') =>
      request(app).get(`/chat/conversations${query}`).set('Authorization', `Bearer ${token}`),
    get: (id: string) =>
      request(app).get(`/chat/conversations/${id}`).set('Authorization', `Bearer ${token}`),
    remove: (id: string) =>
      request(app).delete(`/chat/conversations/${id}`).set('Authorization', `Bearer ${token}`),
  });
  return { app, w, her: as(w.token), as };
}

describe('POST /chat saves the conversation', () => {
  it('creates a conversation on the first message and adds to it after', async () => {
    const { her } = await setup(modeA('Wash it with soap.'), modeA('Calamine can help.'));

    const first = await her.chat({ messages: [user('I got a mosquito bite')] });
    expect(first.status).toBe(200);
    const id = first.body.conversationId as string;
    expect(id).toBeTruthy();

    clock.advance(60_000);
    const second = await her.chat({
      conversationId: id,
      messages: [user('I got a mosquito bite'), bot('Wash it with soap.'), user('Any ointment?')],
    });
    expect(second.body.conversationId).toBe(id);

    const saved = await her.get(id);
    expect(saved.status).toBe(200);
    expect(saved.headers['cache-control']).toBe('no-store');
    expect(saved.body).toMatchObject({ id, title: 'I got a mosquito bite' });
    expect(
      saved.body.messages.map((m: { role: string; text: string }) => [m.role, m.text]),
    ).toEqual([
      ['user', 'I got a mosquito bite'],
      ['assistant', 'Wash it with soap.'],
      ['user', 'Any ointment?'],
      ['assistant', 'Calamine can help.'],
    ]);
  });

  it('saves nothing when the assistant fails, so "Try again" does not duplicate', async () => {
    const { her, w } = await setup(
      new LlmUnavailableError('rate_limited', 'busy'),
      modeA('Here is an answer.'),
    );
    expect((await her.chat({ messages: [user('hello')] })).status).toBe(503);
    expect(await db.conversation.count({ where: { womanId: w.userId } })).toBe(0);

    const retry = await her.chat({ messages: [user('hello')] });
    const saved = await her.get(retry.body.conversationId);
    expect(saved.body.messages).toHaveLength(2);
  });

  it('saves her emergency message, with no reply, and still returns the emergency', async () => {
    const { her } = await setup();
    const res = await her.chat({ messages: [user('heavy bleeding while pregnant')] });
    expect(res.body.kind).toBe('emergency');
    const saved = await her.get(res.body.conversationId);
    expect(saved.body.messages).toEqual([
      expect.objectContaining({ role: 'user', emergency: true }),
    ]);
  });

  it("refuses another woman's conversation (404) before calling the assistant", async () => {
    const { app, her, as } = await setup(modeA('mine'));
    const mine = await her.chat({ messages: [user('my question')] });
    const other = await signUpWoman(app, mail, 'Ada');
    const res = await as(other.token).chat({
      conversationId: mine.body.conversationId,
      messages: [user('hello')],
    });
    expect(res.status).toBe(404);
    expect((await as(other.token).get(mine.body.conversationId)).status).toBe(404);
    expect((await as(other.token).remove(mine.body.conversationId)).status).toBe(404);
  });
});

describe('GET /chat/conversations', () => {
  it('lists her chats, most recently active first, paged', async () => {
    const { her } = await setup(modeA('a'), modeA('b'), modeA('c'), modeA('d'));
    const a = await her.chat({ messages: [user('first chat')] });
    clock.advance(1_000);
    await her.chat({ messages: [user('second chat')] });
    clock.advance(1_000);
    await her.chat({ messages: [user('third chat')] });
    clock.advance(1_000);
    // Adding to the first chat moves it to the top.
    await her.chat({
      conversationId: a.body.conversationId,
      messages: [user('first chat'), bot('a'), user('more')],
    });

    const page1 = await her.list('?limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((c: { title: string }) => c.title)).toEqual([
      'first chat',
      'third chat',
    ]);
    expect(page1.body.items[0]).toMatchObject({ preview: 'd', messageCount: 4 });
    const page2 = await her.list(`?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.items.map((c: { title: string }) => c.title)).toEqual(['second chat']);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('only lists her own chats', async () => {
    const { app, her, as } = await setup(modeA('x'));
    await her.chat({ messages: [user('private')] });
    const other = await signUpWoman(app, mail, 'Ada');
    expect((await as(other.token).list()).body.items).toEqual([]);
  });

  it('refuses a bad cursor and signed-out callers', async () => {
    const { app, her } = await setup();
    expect((await her.list('?cursor=nonsense')).status).toBe(400);
    expect((await request(app).get('/chat/conversations')).status).toBe(401);
  });
});

describe('DELETE /chat/conversations/:id', () => {
  it('deletes the chat and its messages', async () => {
    const { her } = await setup(modeA('reply'));
    const res = await her.chat({ messages: [user('delete me')] });
    const id = res.body.conversationId as string;
    expect((await her.remove(id)).status).toBe(204);
    expect((await her.get(id)).status).toBe(404);
    expect(await db.conversationMessage.count({ where: { conversationId: id } })).toBe(0);
  });
});

describe('excerpt', () => {
  it('keeps short text and cuts long text at a word', () => {
    expect(excerpt('  short   text ', 80)).toBe('short text');
    expect(excerpt('one two three four five six', 15)).toBe('one two three…');
  });
});

describe('questions sent from a chat', () => {
  const modeB = {
    questionMessages: [1],
    cleanedText: 'Which contraceptive is best for me?',
    assistantNotes: null,
    category: 'contraception',
    redFlagSuspected: false,
    statedAge: null,
    pregnancyWeeks: null,
  };
  const CONSENT = { sharedFields: ['cleaned_text', 'category'], consentVersion: 'w07-v1' };

  async function ask(app: Parameters<typeof request>[0], token: string, conversationId?: string) {
    const draft = await request(app)
      .post('/chat/draft')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [user('Which contraceptive is best for me?')] });
    return request(app).post('/questions').set('Authorization', `Bearer ${token}`).send({
      originalText: draft.body.draft.originalText,
      source: 'web',
      consent: CONSENT,
      draftToken: draft.body.draftToken,
      conversationId,
    });
  }

  it('shows in the chat it was sent from', async () => {
    const { app, w, her } = await setup(modeA('A nurse could help.'), modeB);
    const chat = await her.chat({ messages: [user('Which contraceptive is best for me?')] });
    const id = chat.body.conversationId as string;
    clock.advance(1_000);
    const sent = await ask(app, w.token, id);
    expect(sent.status).toBe(201);

    const saved = await her.get(id);
    expect(saved.body.questions).toEqual([
      { questionId: sent.body.id, createdAt: expect.any(String) },
    ]);
  });

  it("is still sent, but not linked, with another woman's chat", async () => {
    const { app, as } = await setup(modeA('mine'), modeB);
    const mine = await as((await signUpWoman(app, mail, 'Ada')).token).chat({
      messages: [user('my chat')],
    });
    const other = await signUpWoman(app, mail, 'Bisi');
    const sent = await ask(app, other.token, mine.body.conversationId);
    expect(sent.status).toBe(201);
    expect(await db.conversationQuestion.count({ where: { questionId: sent.body.id } })).toBe(0);
  });
});
