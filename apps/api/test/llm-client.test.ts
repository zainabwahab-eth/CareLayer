// OpenAI-compatible LLM client against a stubbed fetch: request shape and failure mapping.
import { describe, expect, it } from 'vitest';
import { createOpenAiCompatibleClient, LlmUnavailableError } from '../src/modules/llm/client.js';

const cfg = {
  baseUrl: 'https://llm.example/v1',
  apiKey: 'nvapi-test-key-should-never-appear',
  model: 'some/model',
  timeoutMs: 1000,
};
const req = { messages: [{ role: 'user' as const, content: 'hi' }] };

function stub(res: Response | Error | (() => Promise<Response>)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    if (typeof res === 'function') return res();
    return res;
  }) as unknown as typeof fetch;
  return { f, calls };
}

const ok = (body: object) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

async function failureOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as LlmUnavailableError;
  }
  throw new Error('expected a failure');
}

describe('createOpenAiCompatibleClient', () => {
  it('posts a chat completion with the model and bearer key, and returns the content + usage', async () => {
    const { f, calls } = stub(
      ok({
        model: 'some/model',
        choices: [{ message: { content: '{"a":1}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
    const r = await createOpenAiCompatibleClient(cfg, f).complete({ ...req, maxTokens: 50 });
    expect(r).toMatchObject({
      content: '{"a":1}',
      model: 'some/model',
      promptTokens: 12,
      completionTokens: 3,
    });
    expect(calls[0]!.url).toBe('https://llm.example/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${cfg.apiKey}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      model: 'some/model',
      messages: req.messages,
      max_tokens: 50,
      stream: false,
    });
  });

  it.each([
    [429, 'rate_limited'],
    [401, 'auth'],
    [403, 'auth'],
    [500, 'upstream'],
    [503, 'upstream'],
  ])('maps HTTP %i to %s, without the key in the message', async (status, kind) => {
    const { f } = stub(new Response('{"error":"nope"}', { status }));
    const err = await failureOf(createOpenAiCompatibleClient(cfg, f).complete(req));
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(err.message).not.toContain(cfg.apiKey);
  });

  it('maps a timeout and a network error', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(
      (await failureOf(createOpenAiCompatibleClient(cfg, stub(timeout).f).complete(req))).kind,
    ).toBe('timeout');
    expect(
      (
        await failureOf(
          createOpenAiCompatibleClient(cfg, stub(new TypeError('fetch failed')).f).complete(req),
        )
      ).kind,
    ).toBe('upstream');
  });

  it('an empty or non-JSON reply is bad_response', async () => {
    expect(
      (
        await failureOf(
          createOpenAiCompatibleClient(cfg, stub(ok({ choices: [] })).f).complete(req),
        )
      ).kind,
    ).toBe('bad_response');
    expect(
      (
        await failureOf(
          createOpenAiCompatibleClient(
            cfg,
            stub(new Response('<html>', { status: 200 })).f,
          ).complete(req),
        )
      ).kind,
    ).toBe('bad_response');
  });

  it('no key = not_configured, and no request is made', async () => {
    const { f, calls } = stub(ok({}));
    const err = await failureOf(
      createOpenAiCompatibleClient({ ...cfg, apiKey: undefined }, f).complete(req),
    );
    expect(err.kind).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });
});
