// Pay-on-delivery guard (docs/API_CONTRACT.md §8.3, step 2).
//
// Mounted BEFORE the x402 payment middleware. When the condition is false it ends the request with
// a contract-shaped 409 through the central error handler, so the payment middleware never runs:
// no 402, no PAYMENT-REQUIRED header, no facilitator call. Unanswered questions never ask for money.
//
// We do not use x402's built-in onProtectedRequest hook for this: it can only deny with a 403,
// and the contract requires 409 QUESTION_NOT_ANSWERED.
import type { Request, RequestHandler } from 'express';
import type { AppError } from '../../lib/errors.js';

export type GuardCheck = (req: Request) => boolean | Promise<boolean>;

export function payOnDeliveryGuard(check: GuardCheck, failure: () => AppError): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (await check(req)) next();
      else next(failure());
    } catch (err) {
      next(err);
    }
  };
}
