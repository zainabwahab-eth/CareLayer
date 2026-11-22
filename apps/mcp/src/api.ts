// The CareLayer API, as Claude may use it: only the routes an agent token is allowed on
// (docs/API_CONTRACT.md §13). The API enforces the rules (Claude's spending limit, "ask before each
// payment", emergencies); this client just calls it with her agent token.
import type {
  AnswerResponse,
  ApiErrorBody,
  CreatedQuestion,
  DraftResponse,
  EmergencyResponse,
  QuestionStatusResponse,
  SharedField,
  WalletResponse,
} from '@carelayer/shared';

export class CareLayerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CareLayerApiError';
  }
}

export interface CareLayerApi {
  draft(question: string): Promise<DraftResponse>;
  sendQuestion(body: {
    question: string;
    draftToken: string;
    sharedFields: SharedField[];
    femaleOnly?: boolean;
  }): Promise<CreatedQuestion | EmergencyResponse>;
  status(questionId: string): Promise<QuestionStatusResponse>;
  collect(questionId: string, confirmPayment: boolean): Promise<AnswerResponse>;
  wallet(): Promise<WalletResponse>;
}

/** Version of the consent text Claude shows before sending (see the ask_health_worker tool). */
export const MCP_CONSENT_VERSION = 'mcp-consent-v1';

export function createCareLayerApi(opts: {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): CareLayerApi {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // Drafting runs CareLayer's assistant (an LLM call); allow for a slow provider.
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      });
    } catch (err) {
      throw new CareLayerApiError(
        0,
        'NETWORK',
        `CareLayer could not be reached (${(err as Error).message}).`,
      );
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const error = (json as ApiErrorBody | undefined)?.error;
      throw new CareLayerApiError(
        res.status,
        error?.code ?? 'HTTP_ERROR',
        error?.message ?? `CareLayer answered ${res.status}.`,
        error?.details ?? {},
      );
    }
    return json as T;
  }

  return {
    draft: (question) =>
      call<DraftResponse>('POST', '/chat/draft', {
        messages: [{ role: 'user', text: question }],
      }),
    sendQuestion: ({ question, draftToken, sharedFields, femaleOnly }) =>
      call('POST', '/questions', {
        originalText: question,
        source: 'mcp',
        draftToken,
        femaleOnly: femaleOnly ?? false,
        consent: { sharedFields, consentVersion: MCP_CONSENT_VERSION },
      }),
    status: (id) => call('GET', `/questions/${encodeURIComponent(id)}/status`),
    collect: (id, confirmPayment) =>
      call('POST', `/me/questions/${encodeURIComponent(id)}/collect`, { confirmPayment }),
    wallet: () => call('GET', '/wallet'),
  };
}
