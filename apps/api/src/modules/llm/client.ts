// LLM transport: one OpenAI-compatible chat completions call. Works with NVIDIA's hosted endpoints
// (default), OpenAI, or any provider speaking the same protocol: switching is LLM_BASE_URL,
// LLM_API_KEY and LLM_MODEL. Everything above this file depends on the LlmClient interface only,
// so tests inject a fake and nothing here is called.
//
// Failures become LlmUnavailableError with a kind the API maps to 503. The error message never
// contains the API key or the conversation text.
import type { LlmConfig } from '../../config.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** Upper bound on the reply (reasoning models spend part of it thinking). */
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResult {
  content: string;
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResult>;
}

export type LlmFailure =
  'not_configured' | 'rate_limited' | 'timeout' | 'upstream' | 'auth' | 'bad_response';

export class LlmUnavailableError extends Error {
  constructor(
    readonly kind: LlmFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAiCompatibleClient(
  cfg: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): LlmClient {
  return {
    async complete(req) {
      if (!cfg.apiKey) {
        throw new LlmUnavailableError('not_configured', 'LLM_API_KEY is not set');
      }
      const started = Date.now();
      let res: Response;
      try {
        res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model: cfg.model,
            messages: req.messages,
            temperature: req.temperature ?? 0.2,
            max_tokens: req.maxTokens ?? 1500,
            stream: false,
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : 'unknown';
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new LlmUnavailableError('timeout', `LLM call timed out after ${cfg.timeoutMs} ms`);
        }
        throw new LlmUnavailableError('upstream', `LLM request failed (${name})`);
      }

      if (!res.ok) {
        // Read a little of the body for the log. Providers do not echo the key back.
        const detail = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
        const kind: LlmFailure =
          res.status === 429
            ? 'rate_limited'
            : res.status === 401 || res.status === 403
              ? 'auth'
              : 'upstream';
        throw new LlmUnavailableError(
          kind,
          `LLM provider answered ${res.status}: ${detail}`,
          res.status,
        );
      }

      let body: ChatCompletion;
      try {
        body = (await res.json()) as ChatCompletion;
      } catch {
        throw new LlmUnavailableError('bad_response', 'LLM provider sent a body that is not JSON');
      }
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new LlmUnavailableError('bad_response', 'LLM provider sent an empty reply');
      }
      return {
        content,
        model: body.model ?? cfg.model,
        latencyMs: Date.now() - started,
        promptTokens: body.usage?.prompt_tokens ?? null,
        completionTokens: body.usage?.completion_tokens ?? null,
      };
    },
  };
}
