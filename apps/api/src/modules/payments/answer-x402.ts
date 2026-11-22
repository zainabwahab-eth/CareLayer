// x402 for GET /questions/:id/answer (Z8): a manual flow, not @x402/express's paymentMiddleware.
//
// Why manual (checked in @x402/express 2.31.0): the middleware runs the route handler BEFORE it
// settles. It does buffer the handler's body and drop it when settlement fails, but the handler
// would have to write "paid" state before knowing settlement succeeded, a repeated fetch would be
// charged again, and an indeterminate settle (timeout) cannot be recorded first and reconciled.
// So the route does: verify the payment -> record the attempt -> settle -> only then load and
// return the answer. Requirements, headers and verify/settle all use the official @x402/core.
import { createHash } from 'node:crypto';
import {
  FacilitatorTimeoutError,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { SettleError, VerifyError } from '@x402/core/types';
import type { createX402Server } from './x402.js';
import { usdcPrice } from './x402.js';

export type X402Server = ReturnType<typeof createX402Server>;

/** How long a signed answer payment stays valid. After this (plus a margin) it can never settle. */
export const ANSWER_PAYMENT_TIMEOUT_SECONDS = 120;

export {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
};

/** sha256 of the PAYMENT-SIGNATURE header: identifies one signed payment attempt. */
export const paymentReference = (header: string) =>
  createHash('sha256').update(header).digest('hex');

/**
 * Facilitator failure classes.
 * - `rejected`: the facilitator answered and said no (or rate-limited us before doing anything).
 *   Nothing moved on chain. Safe to ask for a new payment.
 * - `unavailable`: the facilitator could not be reached before any money could move (verify, or
 *   startup). Nothing moved. Retry later.
 * - `indeterminate`: a settle that timed out, hit a 5xx, or lost the connection. The payment may
 *   have gone through: reconcile on chain before any new payment.
 */
export type FacilitatorFailure = 'rejected' | 'unavailable' | 'indeterminate';

function httpStatusOf(err: unknown): number | undefined {
  if (err instanceof SettleError || err instanceof VerifyError) return err.statusCode;
  const m = /failed \((\d{3})\)/.exec(err instanceof Error ? err.message : '');
  return m ? Number(m[1]) : undefined;
}

/** Classifies an error thrown by settlePayment(). */
export function classifySettleError(err: unknown): FacilitatorFailure {
  if (err instanceof FacilitatorTimeoutError) return 'indeterminate';
  const status = httpStatusOf(err);
  if (status === undefined) return 'indeterminate'; // network error: the request may have arrived
  if (status >= 500) return 'indeterminate';
  return 'rejected'; // 4xx incl. 429: the facilitator refused before settling
}

/** Classifies an error thrown by verifyPayment() or initialize(). Nothing moves on verify. */
export function classifyVerifyError(err: unknown): 'invalid' | 'unavailable' {
  if (err instanceof VerifyError && err.statusCode < 500 && err.statusCode !== 429) {
    return 'invalid';
  }
  return 'unavailable';
}

/** Builds the payment requirements for one answer: exact USDC stroops to the platform address. */
export async function answerRequirements(
  server: X402Server,
  opts: { network: 'stellar:testnet'; payTo: string; priceStroops: bigint },
): Promise<PaymentRequirements[]> {
  return server.buildPaymentRequirements({
    scheme: 'exact',
    network: opts.network,
    payTo: opts.payTo,
    price: usdcPrice(opts.priceStroops),
    maxTimeoutSeconds: ANSWER_PAYMENT_TIMEOUT_SECONDS,
  });
}
