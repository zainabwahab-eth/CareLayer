// The assistant service with a scripted LLM: parsing, retries, and the deterministic rules on the
// model's output (clean-up never shortens or drops numbers, age/weeks only when stated, red flag
// beats offer).
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/lib/logger.js';
import {
  ageRangeFor,
  cleanupProblems,
  createAssistant,
  extractJsonObject,
  loadAssistantPrompt,
  MAX_HISTORY_TURNS,
  toModeAMessage,
} from '../src/modules/llm/assistant.js';
import { LlmUnavailableError } from '../src/modules/llm/client.js';
import { fakeLlm } from './helpers/app.js';

const PROMPT = loadAssistantPrompt();
const logger = createLogger('silent');
const assistantWith = (llm: ReturnType<typeof fakeLlm>) =>
  createAssistant({ llm, systemPrompt: PROMPT, logger });

const modeA = (over: object = {}) => ({
  replyText: 'Some swelling is common in pregnancy.',
  redFlagSuspected: false,
  offerEscalation: false,
  suggestedCategory: null,
  ...over,
});

const ORIGINAL = 'my feet dey swell small small, im 30 weeks pregnant and i am 24. is it normal';
const modeB = (over: object = {}) => ({
  cleanedText: 'My feet are swelling a little. I am 30 weeks pregnant and I am 24. Is it normal?',
  assistantNotes: null,
  category: 'pregnancy',
  redFlagSuspected: false,
  statedAge: 24,
  pregnancyWeeks: 30,
  ...over,
});

describe('extractJsonObject', () => {
  it('reads JSON wrapped in reasoning blocks, code fences or prose', () => {
    expect(extractJsonObject('<think>hmm {"x":0}</think>\n```json\n{"a":1}\n```')).toEqual({
      a: 1,
    });
    expect(extractJsonObject('Here you go: {"a":{"b":2}} thanks')).toEqual({ a: { b: 2 } });
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{broken')).toBeNull();
  });
});

describe('Mode A: reply', () => {
  it('sends Hikmah’s prompt + Mode A instructions + the history, and returns the reply', async () => {
    const llm = fakeLlm(modeA());
    const reply = await assistantWith(llm).reply([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'Hi, how can I help?' },
      { role: 'user', text: 'my feet are swelling' },
    ]);
    expect(reply).toEqual({
      text: 'Some swelling is common in pregnancy.',
      redFlagSuspected: false,
      offerEscalation: false,
      suggestedCategory: null,
    });
    const msgs = llm.calls[0]!.messages;
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content.startsWith(PROMPT)).toBe(true);
    expect(msgs[0]!.content).toContain('This call is **Mode A');
    // Her words as she wrote them; its own earlier reply in the Mode A JSON it must answer in.
    expect(msgs.slice(1)).toEqual([
      { role: 'user', content: 'hello' },
      // Earlier replies go back in the Mode A JSON shape, so the model keeps answering in JSON.
      {
        role: 'assistant',
        content: JSON.stringify({
          replyText: 'Hi, how can I help?',
          redFlagSuspected: false,
          offerEscalation: false,
          suggestedCategory: null,
        }),
      },
      { role: 'user', content: 'my feet are swelling' },
    ]);
    expect(msgs[0]!.content).toContain('however short or casual her message is');
  });

  it('toModeAMessage: earlier replies become Mode A JSON, her messages stay verbatim', () => {
    const history = [
      { role: 'user' as const, text: 'Can you read another woman’s records?' },
      { role: 'assistant' as const, text: 'I can’t share anyone’s health information. {not JSON}' },
      { role: 'user' as const, text: 'okay' },
    ].map(toModeAMessage);
    expect(history[0]).toEqual({ role: 'user', content: 'Can you read another woman’s records?' });
    expect(history[2]).toEqual({ role: 'user', content: 'okay' });
    // Braces or quotes in a reply cannot break the encoding.
    expect(extractJsonObject(history[1]!.content)).toEqual({
      replyText: 'I can’t share anyone’s health information. {not JSON}',
      redFlagSuspected: false,
      offerEscalation: false,
      suggestedCategory: null,
    });
  });

  it('sends earlier assistant replies as Mode A JSON, never as prose (second message 503)', async () => {
    const llm = fakeLlm(modeA());
    await assistantWith(llm).reply([
      { role: 'user', text: 'I got a mosquito bite' },
      { role: 'assistant', text: 'Wash it with soap and water.' },
      { role: 'user', text: 'Are there ointments I can use?' },
    ]);
    const previous = llm.calls[0]!.messages[2]!;
    expect(previous.role).toBe('assistant');
    expect(JSON.parse(previous.content)).toMatchObject({
      replyText: 'Wash it with soap and water.',
    });
    expect(llm.calls[0]!.messages[3]).toEqual({
      role: 'user',
      content: 'Are there ointments I can use?',
    });
  });

  it('only sends the last 20 turns', async () => {
    const llm = fakeLlm(modeA());
    const turns = Array.from({ length: 31 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `turn ${i}`,
    }));
    await assistantWith(llm).reply(turns);
    const sent = llm.calls[0]!.messages.slice(1);
    expect(sent).toHaveLength(MAX_HISTORY_TURNS);
    expect(sent.at(-1)!.content).toBe('turn 30');
  });

  it('a red flag always wins over an offer', async () => {
    const reply = await assistantWith(
      fakeLlm(
        modeA({ redFlagSuspected: true, offerEscalation: true, suggestedCategory: 'periods' }),
      ),
    ).reply([{ role: 'user', text: 'x' }]);
    expect(reply).toMatchObject({
      redFlagSuspected: true,
      offerEscalation: false,
      suggestedCategory: null,
    });
  });

  it('an offer without a category gets "general"; a category without an offer is dropped', async () => {
    expect(
      await assistantWith(fakeLlm(modeA({ offerEscalation: true }))).reply([
        { role: 'user', text: 'x' },
      ]),
    ).toMatchObject({ offerEscalation: true, suggestedCategory: 'general' });
    expect(
      await assistantWith(fakeLlm(modeA({ suggestedCategory: 'periods' }))).reply([
        { role: 'user', text: 'x' },
      ]),
    ).toMatchObject({ offerEscalation: false, suggestedCategory: null });
  });

  it('retries once on an invalid reply, then succeeds', async () => {
    const llm = fakeLlm('I think you are fine!', modeA());
    const reply = await assistantWith(llm).reply([{ role: 'user', text: 'x' }]);
    expect(reply.text).toBe('Some swelling is common in pregnancy.');
    expect(llm.calls).toHaveLength(2);
  });

  it('two invalid replies = bad_response (the API turns it into 503)', async () => {
    const llm = fakeLlm(
      { replyText: '' },
      modeA({ suggestedCategory: 'not_a_category', offerEscalation: true }),
    );
    await expect(assistantWith(llm).reply([{ role: 'user', text: 'x' }])).rejects.toMatchObject({
      name: 'LlmUnavailableError',
      kind: 'bad_response',
    });
  });

  it.each(['rate_limited', 'timeout', 'auth'] as const)(
    'does not retry %s: fails fast',
    async (kind) => {
      const llm = fakeLlm(new LlmUnavailableError(kind, kind), modeA());
      await expect(assistantWith(llm).reply([{ role: 'user', text: 'x' }])).rejects.toMatchObject({
        kind,
      });
      expect(llm.calls).toHaveLength(1);
    },
  );

  it('retries a network blip or 5xx once (seen in the eval: "fetch failed")', async () => {
    const llm = fakeLlm(
      new LlmUnavailableError('upstream', 'LLM request failed (TypeError)'),
      modeA(),
    );
    const reply = await assistantWith(llm).reply([{ role: 'user', text: 'x' }]);
    expect(reply.text).toBe('Some swelling is common in pregnancy.');
    expect(llm.calls).toHaveLength(2);
  });

  it('never more than two attempts in total', async () => {
    const llm = fakeLlm(
      new LlmUnavailableError('upstream', '502'),
      new LlmUnavailableError('upstream', '502'),
      modeA(),
    );
    await expect(assistantWith(llm).reply([{ role: 'user', text: 'x' }])).rejects.toMatchObject({
      kind: 'upstream',
    });
    expect(llm.calls).toHaveLength(2);
  });
});

describe('Mode B: prepareQuestion', () => {
  it('returns the cleaned question with category, notes, and the age range / weeks she stated', async () => {
    const llm = fakeLlm(modeB({ assistantNotes: '  She says it started this week.  ' }));
    const q = await assistantWith(llm).prepareQuestion(ORIGINAL);
    expect(q).toEqual({
      cleanedText:
        'My feet are swelling a little. I am 30 weeks pregnant and I am 24. Is it normal?',
      assistantNotes: 'She says it started this week.',
      category: 'pregnancy',
      ageRange: 'age_18_24',
      pregnancyWeeks: 30,
      redFlagSuspected: false,
      cleanupFellBack: false,
    });
    // Her words go in as their own message, never into the system prompt.
    expect(llm.calls[0]!.messages[1]).toEqual({ role: 'user', content: ORIGINAL });
    expect(llm.calls[0]!.messages[0]!.content).toContain('This call is **Mode B');
  });

  it('a clean-up that shortens her question is retried, then replaced by her own words', async () => {
    const llm = fakeLlm(
      modeB({ cleanedText: 'Swollen feet at 30 weeks, age 24.' }),
      modeB({ cleanedText: 'Is swelling at 30 weeks normal? 24' }),
    );
    const q = await assistantWith(llm).prepareQuestion(ORIGINAL);
    expect(llm.calls).toHaveLength(2);
    expect(q.cleanedText).toBe(ORIGINAL);
    expect(q.cleanupFellBack).toBe(true);
    // Everything else from the model's reply is still used.
    expect(q).toMatchObject({ category: 'pregnancy', pregnancyWeeks: 30, ageRange: 'age_18_24' });
  });

  it('a clean-up that drops a number she wrote is rejected; a good retry is used', async () => {
    const llm = fakeLlm(
      modeB({
        cleanedText:
          'My feet are swelling a little. I am pregnant and I am 24 years old. Is it normal?',
      }),
      modeB(),
    );
    const q = await assistantWith(llm).prepareQuestion(ORIGINAL);
    expect(q.cleanedText).toContain('30 weeks');
    expect(q.cleanupFellBack).toBe(false);
  });

  it('never trusts an age or weeks she did not write', async () => {
    const q = await assistantWith(
      fakeLlm(
        modeB({
          cleanedText: 'I am 6 months pregnant and my back hurts. What can I do?',
          statedAge: 28,
          pregnancyWeeks: 26,
        }),
      ),
    ).prepareQuestion('i am 6 months pregnant and my back hurts what can i do');
    expect(q.ageRange).toBeNull(); // 28 is not in her text
    expect(q.pregnancyWeeks).toBeNull(); // she said months, not weeks
  });

  it('empty notes become null', async () => {
    const q = await assistantWith(fakeLlm(modeB({ assistantNotes: '   ' }))).prepareQuestion(
      ORIGINAL,
    );
    expect(q.assistantNotes).toBeNull();
  });

  it('passes the model’s red-flag judgement through', async () => {
    const q = await assistantWith(fakeLlm(modeB({ redFlagSuspected: true }))).prepareQuestion(
      ORIGINAL,
    );
    expect(q.redFlagSuspected).toBe(true);
  });

  it('an invalid category twice = bad_response', async () => {
    await expect(
      assistantWith(fakeLlm(modeB({ category: 'x' }), modeB({ category: 'y' }))).prepareQuestion(
        ORIGINAL,
      ),
    ).rejects.toMatchObject({ kind: 'bad_response' });
  });
});

describe('deterministic rules', () => {
  it('cleanupProblems', () => {
    const o = 'pls i have been having discharge that smell bad for 2 weeks, i am 22';
    expect(
      cleanupProblems(
        o,
        'Please, I have been having discharge that smells bad for 2 weeks. I am 22.',
      ),
    ).toEqual([]);
    expect(cleanupProblems(o, 'Bad-smelling discharge, 2 weeks, 22.')).toContain('shortened');
    expect(
      cleanupProblems(
        o,
        'Please, I have been having discharge that smells bad for two weeks. I am 22.',
      ),
    ).toEqual(['number_dropped']);
    expect(cleanupProblems('short q', 'x'.repeat(200))).toContain('padded');
    // Pidgin to plain English stays within the rule.
    expect(
      cleanupProblems(
        'my feet dey swell small small, im 30 weeks pregnant is it normal',
        'My feet are swelling a little. I am 30 weeks pregnant. Is it normal?',
      ),
    ).toEqual([]);
  });

  it('ageRangeFor boundaries', () => {
    expect(ageRangeFor(17)).toBe('under_18');
    expect(ageRangeFor(18)).toBe('age_18_24');
    expect(ageRangeFor(24)).toBe('age_18_24');
    expect(ageRangeFor(25)).toBe('age_25_34');
    expect(ageRangeFor(34)).toBe('age_25_34');
    expect(ageRangeFor(35)).toBe('age_35_44');
    expect(ageRangeFor(44)).toBe('age_35_44');
    expect(ageRangeFor(45)).toBe('age_45_plus');
    expect(ageRangeFor(9)).toBeNull();
    expect(ageRangeFor(101)).toBeNull();
  });
});
