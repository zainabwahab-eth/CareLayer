// Custodial wallets (Z4).
//
// Lifecycle: the wallet row (keypair, encrypted secret) is created in the same write as the user at
// sign-up, so every user always has an address. Activation on Stellar runs right after sign-up and
// is retried in the background; sign-up never waits for or fails because of Stellar.
//
// Activation is safe to run from several places at once (sign-up hook, background loop, GET
// /wallet): a conditional UPDATE "claims" the wallet, so only one attempt runs at a time, and an
// account that already exists on-chain with its trustline is simply marked active.
import {
  FREE_ANSWERS_PER_WOMAN,
  type WalletResponse,
  type WalletTransaction,
} from '@carelayer/shared';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import type { WalletConfig } from '../../config.js';
import type { Db } from '../../db.js';
import type { Wallet } from '../../generated/prisma/client.js';
import type { Logger } from '../../lib/logger.js';
import { stroopsToKobo, stroopsToUsdcString } from '../../lib/money.js';
import { AccountAlreadyExistsError, type WalletChain } from './chain.js';
import { decryptWalletSecret, newCustodialWallet } from './crypto.js';

const MINUTE = 60_000;
/** An attempt older than this is considered dead (process crashed) and can be claimed again. */
const CLAIM_TIMEOUT_MS = 2 * MINUTE;
/** Retry backoff after a failed attempt: 1, 2, 4 ... minutes, capped at 30. */
const backoffMs = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), 30) * MINUTE;
/** Never tried, or the last attempt's backoff has passed. */
const isDue = (w: { activationAttemptAt: Date | null; activationAttempts: number }, now: number) =>
  !w.activationAttemptAt ||
  now - w.activationAttemptAt.getTime() >= backoffMs(w.activationAttempts);
/** GET /wallet waits at most this long for a live balance before showing the cached one. */
const BALANCE_TIMEOUT_MS = 4000;

export interface WalletServiceDeps {
  db: Db;
  config: WalletConfig;
  ngnPerUsdc: string;
  /** Undefined when STELLAR_TREASURY_SECRET is not set: wallets stay pending. */
  chain: WalletChain | undefined;
  logger: Logger;
  now: () => Date;
}

export type ActivationOutcome = 'activated' | 'already_active' | 'busy' | 'disabled' | 'failed';

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);

const money = (stroops: bigint, ngnPerUsdc: string, sign: 1 | -1 = 1) => {
  const kobo = stroopsToKobo(stroops < 0n ? -stroops : stroops, ngnPerUsdc);
  const usdc = stroopsToUsdcString(stroops < 0n ? -stroops : stroops);
  return sign === 1 ? { kobo, usdc } : { kobo: kobo === 0 ? 0 : -kobo, usdc: `-${usdc}` };
};

export function createWalletService(d: WalletServiceDeps) {
  /** The user's wallet; creates one if missing (users from before Z4). */
  async function ensureWallet(userId: string): Promise<Wallet> {
    const existing = await d.db.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    try {
      return await d.db.wallet.create({
        data: { userId, ...newCustodialWallet(d.config.encryptionKey) },
      });
    } catch {
      // Created concurrently by another request.
      return d.db.wallet.findUniqueOrThrow({ where: { userId } });
    }
  }

  async function activate(userId: string): Promise<ActivationOutcome> {
    if (!d.chain) return 'disabled';
    const wallet = await ensureWallet(userId);
    if (wallet.activatedAt) return 'already_active';

    // Claim. "In flight" = an attempt started (activationAttemptAt) and has not recorded an error
    // yet. A failed attempt releases the claim at once (it sets activationError); a crashed one
    // holds it until CLAIM_TIMEOUT_MS. Claiming clears the error, marking this attempt in flight.
    const now = d.now();
    const claimed = await d.db.wallet.updateMany({
      where: {
        id: wallet.id,
        activatedAt: null,
        OR: [
          { activationAttemptAt: null },
          { activationError: { not: null } },
          { activationAttemptAt: { lt: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } },
        ],
      },
      data: {
        activationAttemptAt: now,
        activationAttempts: { increment: 1 },
        activationError: null,
      },
    });
    if (claimed.count === 0) {
      const fresh = await d.db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      return fresh.activatedAt ? 'already_active' : 'busy';
    }

    const markActive = (txHash: string | null) =>
      d.db.wallet.update({
        where: { id: wallet.id },
        data: {
          activatedAt: d.now(),
          activationTxHash: txHash,
          activationError: null,
          balanceSyncedAt: d.now(),
        },
      });

    try {
      if (!StrKey.isValidEd25519PublicKey(wallet.stellarPublicKey)) {
        // Only seen with pre-Z4 seed placeholders ("GSEED...A"): re-run the seed.
        throw new Error('invalid wallet address (pre-Z4 placeholder?): re-run npm run db:seed');
      }
      const state = await d.chain.accountState(wallet.stellarPublicKey);
      if (state.exists && state.hasUsdcTrustline) {
        await markActive(null); // an earlier attempt already succeeded
        return 'activated';
      }
      if (state.exists) {
        throw new Error('account exists without a USDC trustline');
      }
      const secret = decryptWalletSecret(
        d.config.encryptionKey,
        wallet.encryptedSecret,
        wallet.stellarPublicKey,
      );
      try {
        const { txHash } = await d.chain.activate(Keypair.fromSecret(secret));
        await markActive(txHash);
        d.logger.info('wallet_activated', { userId, txHash });
      } catch (err) {
        if (!(err instanceof AccountAlreadyExistsError)) throw err;
        const after = await d.chain.accountState(wallet.stellarPublicKey);
        if (!after.hasUsdcTrustline) {
          throw new Error('account exists without a USDC trustline', { cause: err });
        }
        await markActive(null);
      }
      return 'activated';
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      await d.db.wallet.update({ where: { id: wallet.id }, data: { activationError: reason } });
      d.logger.warn('wallet_activation_failed', { userId, reason });
      return 'failed';
    }
  }

  return {
    ensureWallet,
    activate,

    /** Fire-and-forget activation (sign-up hook). Never throws. */
    activateInBackground(userId: string) {
      void activate(userId).catch((err) =>
        d.logger.error('wallet_activation_crashed', { userId, error: (err as Error).message }),
      );
    },

    /** Background loop: retries pending wallets whose backoff has passed. Returns what it did. */
    async activatePending(limit = 10) {
      if (!d.chain) return { attempted: 0, activated: 0 };
      const now = d.now().getTime();
      const pending = await d.db.wallet.findMany({
        where: { activatedAt: null },
        orderBy: [{ activationAttemptAt: { sort: 'asc', nulls: 'first' } }],
        take: limit * 5,
        select: { userId: true, activationAttemptAt: true, activationAttempts: true },
      });
      const due = pending.filter((w) => isDue(w, now)).slice(0, limit);
      let activated = 0;
      for (const w of due) if ((await activate(w.userId)) === 'activated') activated++;
      return { attempted: due.length, activated };
    },

    /** GET /wallet. Live balance when Stellar answers quickly, else the last known one. */
    async view(user: {
      id: string;
      role: 'WOMAN' | 'NURSE' | 'ADMIN';
      freeAnswersUsed: number;
    }): Promise<WalletResponse> {
      let wallet = await ensureWallet(user.id);
      // Same backoff as the loop, so refreshing the wallet screen during an outage does not hammer Stellar.
      if (!wallet.activatedAt && d.chain && isDue(wallet, d.now().getTime())) {
        // Kick an attempt (claimed, so it is cheap if one is already running) but do not wait long.
        await withTimeout(activate(user.id), BALANCE_TIMEOUT_MS).catch(() => undefined);
        wallet = await d.db.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      }
      if (wallet.activatedAt && d.chain) {
        try {
          const state = await withTimeout(
            d.chain.accountState(wallet.stellarPublicKey),
            BALANCE_TIMEOUT_MS,
          );
          wallet = await d.db.wallet.update({
            where: { id: wallet.id },
            data: { cachedBalanceStroops: state.usdcStroops, balanceSyncedAt: d.now() },
          });
        } catch (err) {
          d.logger.warn('wallet_balance_stale', {
            userId: user.id,
            reason: (err as Error).message,
          });
        }
      }
      return {
        stellarAddress: wallet.stellarPublicKey,
        status: wallet.activatedAt ? 'active' : 'pending',
        balance: money(wallet.cachedBalanceStroops, d.ngnPerUsdc),
        balanceSyncedAt: wallet.balanceSyncedAt?.toISOString() ?? null,
        freeAnswersRemaining:
          user.role === 'WOMAN' ? Math.max(0, FREE_ANSWERS_PER_WOMAN - user.freeAnswersUsed) : null,
      };
    },

    /**
     * GET /wallet/transactions: confirmed money movements, newest first.
     * Women: top-ups (+) and answers she paid for from her wallet (-). Nurses: earnings (+) and
     * withdrawals (-). Cursor = "<createdAt ISO>|<id>" of the last item.
     */
    async transactions(
      user: { id: string; role: 'WOMAN' | 'NURSE' | 'ADMIN' },
      page: { cursor?: string; limit: number },
    ): Promise<{ items: WalletTransaction[]; nextCursor: string | null }> {
      const before = page.cursor ? parseCursor(page.cursor) : null;
      const take = page.limit + 1;
      const olderThan = before ? { createdAt: { lte: before.createdAt } } : {};
      const r = d.ngnPerUsdc;
      const items: WalletTransaction[] = [];

      if (user.role === 'WOMAN') {
        const [topups, payments] = await Promise.all([
          d.db.topup.findMany({
            where: { womanId: user.id, status: 'CONFIRMED', ...olderThan },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          }),
          d.db.payment.findMany({
            where: {
              question: { womanId: user.id },
              source: 'WOMAN_WALLET',
              status: 'CONFIRMED',
              ...olderThan,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          }),
        ]);
        for (const t of topups) {
          items.push({
            id: t.id,
            kind: 'topup',
            amount: money(t.amountStroops, r),
            stellarTxHash: t.stellarTxHash,
            questionId: null,
            createdAt: t.createdAt.toISOString(),
          });
        }
        for (const p of payments) {
          items.push({
            id: p.id,
            kind: 'answer_payment',
            amount: money(p.amountStroops, r, -1),
            stellarTxHash: p.stellarTxHash,
            questionId: p.questionId,
            createdAt: p.createdAt.toISOString(),
          });
        }
      } else if (user.role === 'NURSE') {
        const [payouts, withdrawals] = await Promise.all([
          d.db.payout.findMany({
            where: { nurseId: user.id, status: 'CONFIRMED', ...olderThan },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
            include: { payment: { select: { questionId: true } } },
          }),
          d.db.withdrawal.findMany({
            where: { nurseId: user.id, status: 'CONFIRMED', ...olderThan },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          }),
        ]);
        for (const p of payouts) {
          items.push({
            id: p.id,
            kind: 'answer_earning',
            amount: money(p.amountStroops, r),
            stellarTxHash: p.stellarTxHash,
            questionId: p.payment.questionId,
            createdAt: p.createdAt.toISOString(),
          });
        }
        for (const w of withdrawals) {
          items.push({
            id: w.id,
            kind: 'withdrawal',
            amount: money(w.amountStroops, r, -1),
            stellarTxHash: w.stellarTxHash,
            questionId: null,
            createdAt: w.createdAt.toISOString(),
          });
        }
      }

      const sorted = items
        .filter((i) => !before || isOlder(i, before))
        .sort((a, b) =>
          a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
        );
      const pageItems = sorted.slice(0, page.limit);
      const last = pageItems[pageItems.length - 1];
      return {
        items: pageItems,
        nextCursor: sorted.length > page.limit && last ? `${last.createdAt}|${last.id}` : null,
      };
    },
  };
}

export type WalletService = ReturnType<typeof createWalletService>;

function parseCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = cursor.split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw new InvalidCursorError();
  return { createdAt, id };
}

/** Strictly after the cursor in (createdAt desc, id desc) order. */
function isOlder(item: { createdAt: string; id: string }, cursor: { createdAt: Date; id: string }) {
  const t = Date.parse(item.createdAt);
  const c = cursor.createdAt.getTime();
  return t < c || (t === c && item.id < cursor.id);
}

export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}
