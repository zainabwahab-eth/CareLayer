// Paystack (TEST mode). Plain fetch: two endpoints and a signature check do not need an SDK.
//   POST /transaction/initialize   -> checkout URL for the woman
//   GET  /transaction/verify/:ref   -> the truth about a payment (never trust the redirect alone)
// Webhooks are signed: x-paystack-signature = hex HMAC-SHA512 of the RAW body, keyed with the secret key.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaystackVerification {
  /** Paystack's status: "success", "failed", "abandoned", "ongoing", "pending", "reversed", ... */
  status: string;
  amountKobo: number;
  currency: string;
  paidAt: Date | null;
  gatewayResponse: string | null;
}

export interface PaystackClient {
  initialize(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<PaystackVerification>;
}

export class PaystackError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

export function createPaystackClient(
  opts: { secretKey: string; baseUrl: string; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): PaystackClient {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${opts.baseUrl.replace(/\/+$/, '')}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${opts.secretKey}`,
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new PaystackError(
        `Paystack request failed (${err instanceof Error ? err.name : 'unknown'})`,
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: T;
    };
    if (!res.ok || body.status !== true || body.data === undefined) {
      throw new PaystackError(
        `Paystack: ${res.status} ${body.message ?? 'unexpected response'}`,
        res.status,
      );
    }
    return body.data;
  }

  return {
    async initialize(input) {
      const data = await call<{ authorization_url: string; reference: string }>(
        '/transaction/initialize',
        {
          method: 'POST',
          body: JSON.stringify({
            email: input.email,
            amount: input.amountKobo, // kobo, integer
            currency: 'NGN',
            reference: input.reference,
            callback_url: input.callbackUrl,
            channels: ['card', 'bank_transfer', 'ussd'],
            metadata: input.metadata,
          }),
        },
      );
      return { authorizationUrl: data.authorization_url, reference: data.reference };
    },

    async verify(reference) {
      const data = await call<{
        status: string;
        amount: number;
        currency: string;
        paid_at: string | null;
        gateway_response: string | null;
      }>(`/transaction/verify/${encodeURIComponent(reference)}`);
      return {
        status: data.status,
        amountKobo: data.amount,
        currency: data.currency,
        paidAt: data.paid_at ? new Date(data.paid_at) : null,
        gatewayResponse: data.gateway_response ?? null,
      };
    },
  };
}

/** True when `signature` is the hex HMAC-SHA512 of the raw body under the secret key. Constant time. */
export function isValidPaystackSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secretKey: string,
) {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secretKey).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

/** Test helper and Postman parity: sign a body like Paystack does. */
export const signPaystackBody = (rawBody: string | Buffer, secretKey: string) =>
  createHmac('sha512', secretKey).update(rawBody).digest('hex');
