// Custodial Stellar wallets and Paystack test top-ups. See docs/API_CONTRACT.md §4-5.
import type { Id, IsoDateTime, Money } from './common.js';

export const FREE_ANSWERS_PER_WOMAN = 3;

/** Nurse share of every answer (₦400 of ₦500). Platform keeps the rest. Free answers: the treasury pays the nurse. */
export const PAYOUT_SPLIT = { nurseBps: 8000, platformBps: 2000 } as const;

/** ₦500 per answer. The server reads ANSWER_PRICE_KOBO; this is the agreed default. */
export const DEFAULT_ANSWER_PRICE_KOBO = 50_000;

/**
 * pending: created at sign-up, not yet on-chain (activation runs right after sign-up and is retried
 *          in the background). It can already be shown; it cannot receive money yet.
 * active:  on Stellar testnet, reserves sponsored by the treasury, USDC trustline in place.
 */
export type WalletStatus = 'pending' | 'active';

// GET /wallet
export interface WalletResponse {
  /** Stellar public key (G...). Secret keys never leave the server. */
  stellarAddress: string;
  status: WalletStatus;
  /** USDC balance (shown in naira at the fixed demo rate). */
  balance: Money;
  /**
   * When `balance` was last read from the chain. Older than the request means Stellar was
   * unreachable and the last known balance is shown. Null if never read.
   */
  balanceSyncedAt: IsoDateTime | null;
  /** Women only, otherwise null. */
  freeAnswersRemaining: number | null;
}

/** Stellar Expert link for a testnet account or transaction. */
export const stellarExplorerUrl = (kind: 'account' | 'tx', id: string) =>
  `https://stellar.expert/explorer/testnet/${kind}/${id}`;

export type WalletTxKind = 'topup' | 'answer_payment' | 'answer_earning' | 'withdrawal';

/** Confirmed money movements only (pending and failed ones are not listed). */
export interface WalletTransaction {
  id: Id;
  kind: WalletTxKind;
  /** Positive = money in, negative = money out (sign on both fields). */
  amount: Money;
  /** Stellar testnet transaction hash when on-chain. */
  stellarTxHash: string | null;
  questionId: Id | null;
  createdAt: IsoDateTime;
}

/** Top-up limits in kobo: ₦100 to ₦100,000. */
export const TOPUP_LIMITS_KOBO = { min: 10_000, max: 10_000_000 } as const;

// POST /topups  (women)
export interface CreateTopupBody {
  /** Integer kobo, TOPUP_LIMITS_KOBO.min..max. */
  amountKobo: number;
}
export interface CreateTopupResponse {
  topupId: Id;
  reference: string;
  /**
   * Paystack TEST checkout URL: send her there (full-page redirect). Afterwards Paystack returns her to
   * the wallet screen with `?topupId=...&reference=...`; poll GET /topups/:topupId until it settles.
   */
  authorizationUrl: string;
}

/**
 * pending   waiting for her to pay on Paystack
 * paid      Paystack confirmed the payment; the USDC is being added to her wallet (seconds, retried if Stellar is slow)
 * credited  the USDC is in her wallet (stellarTxHash)
 * failed    the payment failed, was abandoned (24 h), or did not match
 */
export type TopupStatus = 'pending' | 'paid' | 'credited' | 'failed';

// GET /topups/:id
export interface Topup {
  id: Id;
  status: TopupStatus;
  amount: Money;
  stellarTxHash: string | null;
  createdAt: IsoDateTime;
}
