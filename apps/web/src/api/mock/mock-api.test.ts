import { describe, expect, it } from 'vitest';
import type { ChatTurn, CreatedQuestion } from '@carelayer/shared';
import { createMockApi } from './mock-api';

/*
 * The mock must follow the same contract as apps/api (§7 chat, §8 questions), so
 * switching VITE_USE_MOCK_API changes the data, never the behaviour screens rely on.
 */

const consent = {
  sharedFields: ['cleaned_text' as const, 'category' as const],
  consentVersion: 'v1',
};
const user = (text: string): ChatTurn => ({ role: 'user', text });
const assistant = (text: string): ChatTurn => ({ role: 'assistant', text });
const signedIn = () => createMockApi({ latencyMs: 0, startSignedIn: true });

describe('mock chat.send (POST /chat)', () => {
  it('replies to her newest message and keeps nothing', async () => {
    const api = signedIn();
    const reply = await api.chat.send({ messages: [user('Is spotting normal on the pill?')] });
    expect(reply).toMatchObject({ kind: 'reply', message: { role: 'assistant' } });
  });

  it('refuses a thread that does not end with her message', async () => {
    const api = signedIn();
    await expect(
      api.chat.send({ messages: [user('hi'), assistant('hello')] }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { field: 'messages' },
    });
    await expect(api.chat.send({ messages: [] })).rejects.toMatchObject({ status: 400 });
  });

  it('refuses more than CHAT_LIMITS.maxTurns turns', async () => {
    const api = signedIn();
    const messages = Array.from({ length: 41 }, (_, i) => user(`m${i}`));
    await expect(api.chat.send({ messages })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('checks only the newest message for red flags', async () => {
    const api = signedIn();
    await expect(
      api.chat.send({ messages: [user('I have heavy bleeding')] }),
    ).resolves.toMatchObject({ kind: 'emergency' });
    await expect(
      api.chat.send({
        messages: [user('I have heavy bleeding'), user('What foods have iron?')],
      }),
    ).resolves.toMatchObject({ kind: 'reply' });
  });
});

describe('mock chat.draft (POST /chat/draft) + questions.create with draftToken', () => {
  it('drafts only her question (the offered message), and the question is stored as that draft', async () => {
    const api = signedIn();
    const draft = await api.chat.draft({
      messages: [
        user('I have a mosquito bite, what can I do about it?'),
        assistant('Wash it.'),
        user('Which contraceptive would be best for me if I get migraines?'),
        assistant('A nurse could help.'),
        user('ready now'),
      ],
      focusIndex: 2,
    });
    if (draft.kind !== 'draft') throw new Error('expected a draft');
    expect(draft.draft.originalText).toBe(
      'Which contraceptive would be best for me if I get migraines?',
    );
    expect(draft.offer).toMatchObject({ suggestedCategory: draft.draft.category });

    const created = (await api.questions.create({
      originalText: draft.draft.originalText,
      source: 'web',
      consent,
      draftToken: draft.draftToken,
    })) as CreatedQuestion;
    expect(created).toMatchObject({ kind: 'question', category: draft.draft.category });
    const mine = await api.questions.getMine(created.id);
    expect(mine.cleanedText).toBe(draft.draft.cleanedText);
  });

  it('without a hint, takes her latest real question, not "ready now"', async () => {
    const api = signedIn();
    const draft = await api.chat.draft({
      messages: [
        user('Is a 40-day cycle normal for someone my age?'),
        assistant('...'),
        user('ready now'),
      ],
    });
    if (draft.kind !== 'draft') throw new Error('expected a draft');
    expect(draft.draft.originalText).toBe('Is a 40-day cycle normal for someone my age?');
  });

  it('checks the whole question for red flags', async () => {
    const api = signedIn();
    await expect(
      api.chat.draft({ messages: [user('I fainted earlier'), user('also my period is late')] }),
    ).resolves.toMatchObject({ kind: 'emergency' });
  });

  it('rejects an unknown token and an originalText that is not the draft', async () => {
    const api = signedIn();
    await expect(
      api.questions.create({ originalText: 'q', source: 'web', consent, draftToken: 'nope' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'draftToken' } });

    const draft = await api.chat.draft({ messages: [user('a question')] });
    if (draft.kind !== 'draft') throw new Error('expected a draft');
    await expect(
      api.questions.create({
        originalText: 'something else',
        source: 'web',
        consent,
        draftToken: draft.draftToken,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'originalText' } });
  });

  it('accepts a question longer than one chat turn (up to maxQuestionLength)', async () => {
    const api = signedIn();
    const long = 'a'.repeat(5_000);
    await expect(
      api.questions.create({ originalText: long, source: 'web', consent }),
    ).resolves.toMatchObject({ kind: 'question' });
  });
});

describe('mock agentTokens (Claude connections)', () => {
  it('creates a clat_ token once, lists it without the token, and revokes it', async () => {
    const api = signedIn();
    const created = await api.agentTokens.create({ label: 'Claude on my laptop' });
    expect(created.token.startsWith('clat_')).toBe(true);
    const list = await api.agentTokens.list();
    expect(list).toEqual([
      {
        id: created.id,
        label: 'Claude on my laptop',
        createdAt: created.createdAt,
        lastUsedAt: null,
      },
    ]);
    await api.agentTokens.revoke(created.id);
    expect(await api.agentTokens.list()).toEqual([]);
    await expect(api.agentTokens.revoke(created.id)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an empty name and more than MAX_AGENT_TOKENS', async () => {
    const api = signedIn();
    await expect(api.agentTokens.create({ label: '  ' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    for (let i = 0; i < 5; i += 1) await api.agentTokens.create({ label: `c${i}` });
    await expect(api.agentTokens.create({ label: 'one more' })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });
});
