// Custodial Stellar wallets and Paystack test top-ups. See docs/API_CONTRACT.md §4-5.
import type { Id, IsoDateTime, Money } from './common.js';

export const FREE_ANSWERS_PER_WOMAN = 3;

/** Health worker share of every paid answer. Platform keeps the rest. */
export const PAYOUT_SPLIT = { workerBps: 8000, platformBps: 2000 } as const;

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
