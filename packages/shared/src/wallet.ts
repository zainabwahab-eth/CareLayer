// Custodial Stellar wallets and Paystack test top-ups. See docs/API_CONTRACT.md §4-5.
import type { Id, IsoDateTime, Money } from './common.js';

export const FREE_ANSWERS_PER_WOMAN = 3;

/** Nurse share of every answer (₦400 of ₦500). Platform keeps the rest. Free answers: the treasury pays the nurse. */
export const PAYOUT_SPLIT = { nurseBps: 8000, platformBps: 2000 } as const;

/** ₦500 per answer. The server reads ANSWER_PRICE_KOBO; this is the agreed default. */
export const DEFAULT_ANSWER_PRICE_KOBO = 50_000;

// GET /wallet
export interface WalletResponse {
  /** Stellar public key (G...). Secret keys never leave the server. */
  stellarAddress: string;
  balance: Money;
  /** Women only, otherwise null. */
  freeAnswersRemaining: number | null;
}

export type WalletTxKind = 'topup' | 'answer_payment' | 'answer_earning' | 'withdrawal';

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

// POST /topups
export interface CreateTopupBody {
  amountKobo: number;
}
export interface CreateTopupResponse {
  topupId: Id;
  reference: string;
  /** Paystack TEST checkout URL. */
  authorizationUrl: string;
}

export type TopupStatus = 'pending' | 'credited' | 'failed';

// GET /topups/:id
export interface Topup {
  id: Id;
  status: TopupStatus;
  amount: Money;
  stellarTxHash: string | null;
  createdAt: IsoDateTime;
}
