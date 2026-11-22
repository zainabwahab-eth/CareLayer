// Everything a router needs, passed in explicitly so tests can swap any piece.
import type { FacilitatorClient } from '@x402/core/server';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Logger } from './lib/logger.js';
import type { EmailSender } from './modules/auth/email.js';
import type { GoogleVerifier } from './modules/auth/google.js';
import type { LlmClient } from './modules/llm/client.js';
import type { TopupChain } from './modules/topups/chain.js';
import type { PaystackClient } from './modules/topups/paystack.js';
import type { WalletChain } from './modules/wallets/chain.js';
import type { AnswerPaymentChain } from './modules/payments/chain.js';
import type { AnswerPayer } from './modules/payments/x402-client.js';

export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
  /**
   * x402 facilitator (verify / settle). Real one: createFacilitatorClient(config.x402).
   * Tests pass a fake so no network call is made. Required when an x402 route is mounted.
   */
  facilitator?: FacilitatorClient;
  /** Current time. Injected so expiry rules are testable. Default: new Date(). */
  clock?: () => Date;
  /** Sign-in code emails. Default: console transport (dev only; refused in production by config). */
  emailSender?: EmailSender;
  /** Google ID token verifier. Default: built from GOOGLE_CLIENT_ID, or none (503). */
  googleVerifier?: GoogleVerifier;
  /** Stellar side of wallets. Default: Horizon with the treasury, or none (wallets stay pending). */
  walletChain?: WalletChain;
  /** Paystack. Default: built from PAYSTACK_SECRET_KEY, or none (POST /topups answers 503). */
  paystack?: PaystackClient;
  /** Treasury USDC payments for top-ups. Default: Horizon with the treasury, or none. */
  topupChain?: TopupChain;
  /** Treasury USDC payments for nurse payouts (Z8). Default: same Horizon chain as top-ups. */
  payoutChain?: TopupChain;
  /** Finds answer settlements on chain (Z8 reconciliation). Default: Horizon. */
  answerChain?: AnswerPaymentChain;
  /** Signs x402 payments for the API's own agent (Z8). Default: @x402/stellar exact client. */
  answerPayer?: AnswerPayer;
  /** The assistant's LLM. Default: OpenAI-compatible client from LLM_* (no key = chat answers 503). */
  llm?: LlmClient;
}
