// Top-ups (Z5): Paystack TEST payment -> test USDC from the treasury to her wallet.
//
// States (Topup.status):
//   PENDING    created, waiting for her to pay on Paystack
//   SUBMITTED  Paystack confirmed the payment; USDC credit in progress or being retried
//   CONFIRMED  USDC credited on-chain (stellarTxHash)
//   FAILED     payment failed, was abandoned (24 h) or did not match (amount/currency)
//
// A payment is confirmed by EITHER the signed webhook OR a server-side verify (GET /topups/:id and the
// background loop). Webhooks cannot reach localhost, so verify keeps local dev working without a tunnel.
// Both paths go through markPaid(), which is idempotent: a top-up is credited at most once.
//
// Never paying twice: the credit is "claimed" with a conditional UPDATE (one attempt at a time), the
// Stellar payment's memo is the top-up id, and before any (re)send we look for a treasury payment
// with that memo. A credit that went through but was never recorded is found, not repeated.
import { randomBytes } from 'node:crypto';
import type { Topup as TopupDto, TopupStatus } from '@carelayer/shared';
import type { Db } from '../../db.js';
import type { Topup } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { koboToStroops, stroopsToUsdcString } from '../../lib/money.js';
import type { WalletService } from '../wallets/service.js';
import type { TopupChain } from './chain.js';
import type { PaystackClient } from './paystack.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** An unpaid top-up older than this is closed as abandoned. */
const ABANDON_AFTER_MS = 24 * HOUR;
/** A credit attempt older than this is considered crashed and can be claimed again. */
const CLAIM_TIMEOUT_MS = 2 * MINUTE;
const backoffMs = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), 30) * MINUTE;

export interface TopupServiceDeps {
  db: Db;
  paystack: PaystackClient | undefined;
  /** Undefined without a treasury: payments are recorded but credits wait. */
  chain: TopupChain | undefined;
  wallets: WalletService;
  ngnPerUsdc: string;
  callbackUrl: string;
  logger: Logger;
  now: () => Date;
}

const API_STATUS: Record<Topup['status'], TopupStatus> = {
  PENDING: 'pending',
  SUBMITTED: 'paid',
  CONFIRMED: 'credited',
  FAILED: 'failed',
};

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);

export function createTopupService(d: TopupServiceDeps) {
  const toDto = (t: Topup): TopupDto => ({
    id: t.id,
    status: API_STATUS[t.status],
    amount: { kobo: t.amountKobo, usdc: stroopsToUsdcString(t.amountStroops) },
    stellarTxHash: t.stellarTxHash,
    createdAt: t.createdAt.toISOString(),
  });

  const isCreditDue = (t: Topup, now: number) =>
    !t.creditAttemptAt || now - t.creditAttemptAt.getTime() >= backoffMs(t.creditAttempts);

  /** Records a confirmed Paystack payment. Idempotent; returns the (possibly unchanged) top-up. */
  async function markPaid(
    reference: string,
    payment: { amountKobo: number; currency: string; paidAt: Date | null },
    source: 'webhook' | 'verify',
  ): Promise<Topup | null> {
    const topup = await d.db.topup.findUnique({ where: { paystackReference: reference } });
    if (!topup) {
      d.logger.warn('topup_unknown_reference', { source });
      return null;
    }
    const reopenable =
      topup.status === 'PENDING' ||
      (topup.status === 'FAILED' && topup.failureReason === 'abandoned');
    if (!reopenable) return topup; // already paid / credited / failed for a real reason

    if (payment.amountKobo !== topup.amountKobo || payment.currency !== 'NGN') {
      d.logger.warn('topup_amount_mismatch', { topupId: topup.id, source });
      return d.db.topup.update({
        where: { id: topup.id },
        data: { status: 'FAILED', failureReason: 'amount_mismatch' },
      });
    }
    const moved = await d.db.topup.updateMany({
      where: { id: topup.id, status: topup.status },
      // creditAttemptAt reset: for PENDING it only tracked verify checks.
      data: {
        status: 'SUBMITTED',
        paidAt: payment.paidAt ?? d.now(),
        failureReason: null,
        creditAttemptAt: null,
      },
    });
    if (moved.count === 1) d.logger.info('topup_paid', { topupId: topup.id, source });
    return d.db.topup.findUniqueOrThrow({ where: { id: topup.id } });
  }

  /** Sends the USDC (once). Returns the top-up after the attempt. Never throws for chain errors. */
  async function credit(topupId: string): Promise<Topup> {
    const now = d.now();
    const claimed = await d.db.topup.updateMany({
      where: {
        id: topupId,
        status: 'SUBMITTED',
        OR: [
          { creditAttemptAt: null },
          { failureReason: { not: null } },
          { creditAttemptAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } },
        ],
      },
      data: { creditAttemptAt: now, creditAttempts: { increment: 1 }, failureReason: null },
    });
    const topup = await d.db.topup.findUniqueOrThrow({ where: { id: topupId } });
    if (claimed.count === 0) return topup; // not paid yet, already credited, or another attempt is running

    try {
      if (!d.chain) throw new Error('treasury not configured');
      let wallet = await d.wallets.ensureWallet(topup.womanId);
      if (!wallet.activatedAt) {
        await d.wallets.activate(topup.womanId);
        wallet = await d.wallets.ensureWallet(topup.womanId);
        if (!wallet.activatedAt) throw new Error('wallet not active yet');
      }
      const txHash =
        (await d.chain.findTreasuryPaymentByMemo(topup.id)) ??
        (await d.chain.sendUsdc(wallet.stellarPublicKey, topup.amountStroops, topup.id)).txHash;
      const [done] = await d.db.$transaction([
        d.db.topup.update({
          where: { id: topup.id },
          data: {
            status: 'CONFIRMED',
            stellarTxHash: txHash,
            creditedAt: d.now(),
            failureReason: null,
          },
        }),
        d.db.wallet.update({
          where: { id: wallet.id },
          data: { cachedBalanceStroops: { increment: topup.amountStroops } },
        }),
      ]);
      d.logger.info('topup_credited', { topupId: topup.id, txHash });
      return done;
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      d.logger.warn('topup_credit_failed', { topupId: topup.id, reason });
      return d.db.topup.update({ where: { id: topup.id }, data: { failureReason: reason } });
    }
  }

  /** Asks Paystack about an unpaid top-up and records the outcome. */
  async function syncWithPaystack(topup: Topup): Promise<Topup> {
    if (topup.status !== 'PENDING' || !d.paystack) return topup;
    const v = await d.paystack.verify(topup.paystackReference);
    if (v.status === 'success') {
      return (await markPaid(topup.paystackReference, v, 'verify')) ?? topup;
    }
    if (v.status === 'failed' || v.status === 'reversed') {
      return d.db.topup.update({
        where: { id: topup.id },
        data: { status: 'FAILED', failureReason: `payment_${v.status}` },
      });
    }
    return topup; // abandoned / ongoing / pending: she may still finish paying
  }

  return {
    toDto,
    markPaid,
    credit,

    /** POST /topups: creates the top-up and the Paystack checkout. */
    async create(woman: { id: string; email: string }, amountKobo: number) {
      if (!d.paystack) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Top-ups are not available right now.');
      }
      await d.wallets.ensureWallet(woman.id);
      const reference = `cltop_${randomBytes(12).toString('hex')}`;
      const topup = await d.db.topup.create({
        data: {
          womanId: woman.id,
          paystackReference: reference,
          amountKobo,
          amountStroops: koboToStroops(amountKobo, d.ngnPerUsdc),
          status: 'PENDING',
          createdAt: d.now(),
        },
      });
      const callback = new URL(d.callbackUrl);
      callback.searchParams.set('topupId', topup.id);
      try {
        const { authorizationUrl } = await d.paystack.initialize({
          email: woman.email,
          amountKobo,
          reference,
          callbackUrl: callback.toString(),
          metadata: { topupId: topup.id },
        });
        return { topupId: topup.id, reference, authorizationUrl };
      } catch (err) {
        await d.db.topup.update({
          where: { id: topup.id },
          data: { status: 'FAILED', failureReason: 'paystack_initialize_failed' },
        });
        d.logger.warn('topup_initialize_failed', {
          topupId: topup.id,
          reason: (err as Error).message,
        });
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'Payments are not available right now. Please try again.',
        );
      }
    },

    /** GET /topups/:id. Brings an unpaid or uncredited top-up up to date before answering. */
    async get(womanId: string, topupId: string): Promise<TopupDto> {
      let topup = await d.db.topup.findFirst({ where: { id: topupId, womanId } });
      if (!topup) throw new AppError(404, 'NOT_FOUND', 'Top-up not found.');
      try {
        if (topup.status === 'PENDING') topup = await withTimeout(syncWithPaystack(topup), 6000);
        if (topup.status === 'SUBMITTED' && isCreditDue(topup, d.now().getTime())) {
          topup = await withTimeout(credit(topup.id), 15_000);
        }
      } catch (err) {
        d.logger.warn('topup_refresh_slow', { topupId, reason: (err as Error).message });
        topup = await d.db.topup.findUniqueOrThrow({ where: { id: topupId } });
      }
      return toDto(topup);
    },

    /**
     * Background loop: credit paid top-ups whose backoff has passed, check unpaid ones with Paystack
     * (at most every 2 minutes each), close the ones abandoned for 24 h.
     */
    async processPending(limit = 10) {
      const now = d.now().getTime();
      const result = { credited: 0, verified: 0, abandoned: 0 };

      const paid = await d.db.topup.findMany({
        where: { status: 'SUBMITTED' },
        orderBy: { createdAt: 'asc' },
        take: limit * 5,
      });
      for (const t of paid.filter((t) => isCreditDue(t, now)).slice(0, limit)) {
        if ((await credit(t.id)).status === 'CONFIRMED') result.credited++;
      }

      if (d.paystack) {
        const unpaid = await d.db.topup.findMany({
          where: {
            status: 'PENDING',
            createdAt: { lt: new Date(now - MINUTE) },
            OR: [
              { creditAttemptAt: null },
              { creditAttemptAt: { lt: new Date(now - 2 * MINUTE) } },
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: limit,
        });
        for (const t of unpaid) {
          // For PENDING rows creditAttemptAt is "last checked with Paystack" (reset when paid).
          await d.db.topup.update({ where: { id: t.id }, data: { creditAttemptAt: d.now() } });
          try {
            const after = await syncWithPaystack(t);
            result.verified++;
            if (after.status === 'SUBMITTED') await credit(after.id);
            else if (after.status === 'PENDING' && now - t.createdAt.getTime() > ABANDON_AFTER_MS) {
              await d.db.topup.update({
                where: { id: t.id },
                data: { status: 'FAILED', failureReason: 'abandoned' },
              });
              result.abandoned++;
            }
          } catch (err) {
            d.logger.warn('topup_verify_failed', { topupId: t.id, reason: (err as Error).message });
          }
        }
      }
      return result;
    },
  };
}

export type TopupService = ReturnType<typeof createTopupService>;
