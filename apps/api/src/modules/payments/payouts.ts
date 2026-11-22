// Nurse payouts (Z8): the nurse's 80% of every answer, sent from the treasury in test USDC.
//
// A Payout row is written in the same transaction that confirms the answer's Payment, so a payout
// exists exactly once per collected answer (Payout.paymentId is unique). Sending it is separate and
// retried: the answer is never held back because a payout is slow.
//
// Never paid twice: each send is claimed with a conditional update, and the Stellar payment carries
// memo = the payout id. Before (re)sending, Horizon is searched for that memo (same as top-ups).
// Free answers are paid the same way (fromTreasury = true): the nurse is always paid.
import type { Payout } from '../../generated/prisma/client.js';
import type { Db } from '../../db.js';
import type { Logger } from '../../lib/logger.js';
import type { TopupChain } from '../topups/chain.js';
import type { WalletService } from '../wallets/service.js';

/** A send that crashed mid-way holds its claim this long before another attempt may take it. */
const CLAIM_TIMEOUT_MS = 2 * 60_000;
/** Retry backoff: 1, 2, 4 ... minutes, capped at 30. */
const backoffMs = (attempts: number) => Math.min(30, 2 ** Math.max(0, attempts - 1)) * 60_000;

export interface PayoutServiceDeps {
  db: Db;
  /** Treasury USDC payments (same interface top-ups use). Undefined = payouts wait. */
  chain: TopupChain | undefined;
  wallets: WalletService;
  logger: Logger;
  now: () => Date;
}

export function createPayoutService(d: PayoutServiceDeps) {
  /** Where the nurse is paid: her own address if she set one, else her custodial wallet. */
  async function destinationFor(nurseId: string): Promise<{ address: string; custodial: boolean }> {
    const profile = await d.db.nurseProfile.findUniqueOrThrow({ where: { userId: nurseId } });
    if (profile.ownStellarAddress) return { address: profile.ownStellarAddress, custodial: false };
    const wallet = await d.wallets.ensureWallet(nurseId);
    return { address: wallet.stellarPublicKey, custodial: true };
  }

  /** Sends one payout (once). Never throws for chain errors: they are recorded and retried. */
  async function send(payoutId: string): Promise<Payout> {
    const now = d.now();
    const claimed = await d.db.payout.updateMany({
      where: {
        id: payoutId,
        status: { in: ['PENDING', 'SUBMITTED'] },
        OR: [
          { attemptAt: null },
          { failureReason: { not: null } },
          { attemptAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } },
        ],
      },
      data: {
        status: 'SUBMITTED',
        attemptAt: now,
        attempts: { increment: 1 },
        failureReason: null,
      },
    });
    const payout = await d.db.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (claimed.count === 0) return payout; // confirmed already, or another attempt is running

    try {
      if (!d.chain) throw new Error('treasury not configured');
      // Her custodial wallet must be on-chain with a USDC trustline before it can receive.
      const wallet = await d.db.wallet.findUnique({ where: { userId: payout.nurseId } });
      if (wallet && wallet.stellarPublicKey === payout.destinationAddress && !wallet.activatedAt) {
        await d.wallets.activate(payout.nurseId);
        const fresh = await d.db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
        if (!fresh.activatedAt) throw new Error('nurse wallet not active yet');
      }
      const txHash =
        (await d.chain.findTreasuryPaymentByMemo(payout.id)) ??
        (await d.chain.sendUsdc(payout.destinationAddress, payout.amountStroops, payout.id)).txHash;
      const done = await d.db.payout.update({
        where: { id: payout.id },
        data: { status: 'CONFIRMED', stellarTxHash: txHash, confirmedAt: d.now() },
      });
      if (wallet && wallet.stellarPublicKey === payout.destinationAddress) {
        await d.db.wallet.update({
          where: { id: wallet.id },
          data: { cachedBalanceStroops: { increment: payout.amountStroops } },
        });
      }
      d.logger.info('payout_confirmed', { payoutId: payout.id, txHash });
      return done;
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      d.logger.warn('payout_failed', { payoutId: payout.id, reason });
      return d.db.payout.update({ where: { id: payout.id }, data: { failureReason: reason } });
    }
  }

  return {
    destinationFor,
    send,

    /** Fire-and-forget send right after an answer is collected. The loop retries failures. */
    sendInBackground(payoutId: string) {
      void send(payoutId).catch((err) =>
        d.logger.error('payout_crashed', { payoutId, error: (err as Error).message }),
      );
    },

    /** Background loop: payouts not confirmed yet whose backoff has passed. */
    async processPending(limit = 10) {
      if (!d.chain) return { attempted: 0, confirmed: 0 };
      const now = d.now().getTime();
      const pending = await d.db.payout.findMany({
        where: { status: { in: ['PENDING', 'SUBMITTED'] } },
        orderBy: { createdAt: 'asc' },
        take: limit * 5,
        select: { id: true, attemptAt: true, attempts: true },
      });
      const due = pending
        .filter((p) => !p.attemptAt || now - p.attemptAt.getTime() >= backoffMs(p.attempts))
        .slice(0, limit);
      let confirmed = 0;
      for (const p of due) if ((await send(p.id)).status === 'CONFIRMED') confirmed++;
      return { attempted: due.length, confirmed };
    },
  };
}

export type PayoutService = ReturnType<typeof createPayoutService>;
