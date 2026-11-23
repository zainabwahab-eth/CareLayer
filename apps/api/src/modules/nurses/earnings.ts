// Nurse earnings and withdrawals (Z10). Contract: docs/API_CONTRACT.md §12. Screen: N09 Earnings.
//
// Earnings = her Payout rows (Z8): the 80% of every collected answer, free ones included.
// Balance = USDC in her custodial wallet, read from Stellar (the chain is the source of truth).
//
// Withdrawal, in order:
//   1. Fresh code (router), valid Stellar address that is not her own CareLayer wallet.
//   2. Amount: at least ₦100 and at most what is available (balance minus withdrawals in flight).
//   3. The destination exists and trusts testnet USDC (else the payment could never land).
//   4. One write: the withdrawal (PENDING), with her destination memo if any (exchanges credit
//      deposits by memo). A partial unique index allows one in flight per nurse.
//   5. Claim it (PENDING -> SUBMITTED), build and sign: her custodial key signs the payment, the
//      treasury pays the fee (fee bump). The transaction hash is stored, THEN it is submitted.
//        - Stellar accepts      -> CONFIRMED + hash, 201.
//        - Stellar refuses      -> FAILED (nothing moved), 502 STELLAR_SUBMIT_FAILED.
//        - No answer (timeout)  -> stays SUBMITTED, 201 with status "submitted". The loop (and her
//          next GET) look the stored hash up: success -> CONFIRMED; not found once the
//          transaction's 60 s window is over -> FAILED. It is never sent twice.
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  MIN_WITHDRAWAL_KOBO,
  type EarningEntry,
  type EarningsDay,
  type EarningsResponse,
  type Money,
  type Page,
  type QuestionCategory,
  type Withdrawal as WithdrawalDto,
  type WithdrawalEntry,
} from '@carelayer/shared';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { Prisma, type Withdrawal } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import {
  koboToStroops,
  stroopsToKobo,
  stroopsToUsdcString,
  usdcStringToStroops,
} from '../../lib/money.js';
import {
  StellarRejectedError,
  type DestinationMemo,
  type WithdrawalChain,
} from '../payments/withdrawal-chain.js';
import { decryptWalletSecret } from '../wallets/crypto.js';
import type { WalletService } from '../wallets/service.js';
import { lagosDayStart, lagosWeekStart } from './cases.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LAGOS_OFFSET = 60 * MINUTE; // UTC+1, no daylight saving
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** The payment's own time bound (setTimeout 60) plus a margin for ledger close and Horizon lag. */
const UNKNOWN_OUTCOME_MS = 60_000 + 2 * MINUTE;
/** A PENDING row older than this never reached the send step (crash): nothing moved. */
const STALE_PENDING_MS = 2 * MINUTE;
const TITLE_MAX = 40;
const MAX_MEMO_ID = 2n ** 64n - 1n;

/** The memo stored on a withdrawal, or null. */
function memoOf(
  w: Pick<Withdrawal, 'destinationMemoType' | 'destinationMemo'>,
): DestinationMemo | null {
  if (!w.destinationMemo || (w.destinationMemoType !== 'text' && w.destinationMemoType !== 'id')) {
    return null;
  }
  return { type: w.destinationMemoType, value: w.destinationMemo };
}

/** Stellar's memo rules: text up to 28 bytes (UTF-8); id = an unsigned 64-bit number. */
export function validateMemo(memo: DestinationMemo): string | null {
  if (memo.type === 'text') {
    if (memo.value.length === 0) return 'The memo is empty.';
    return Buffer.byteLength(memo.value, 'utf8') <= 28
      ? null
      : 'A text memo can be up to 28 bytes.';
  }
  if (!/^\d{1,20}$/.test(memo.value)) return 'A memo ID is a number, digits only.';
  return BigInt(memo.value) <= MAX_MEMO_ID ? null : 'That memo ID is too large.';
}

export interface EarningsServiceDeps {
  db: Db;
  config: Pick<Config, 'ngnPerUsdc'> & { wallet: Pick<Config['wallet'], 'encryptionKey'> };
  wallets: WalletService;
  /** Undefined = no treasury configured: withdrawals answer 503. */
  chain: WithdrawalChain | undefined;
  logger: Logger;
  now: () => Date;
}

/** YYYY-MM-DD of a Lagos day start. */
const lagosDate = (dayStart: Date) =>
  new Date(dayStart.getTime() + LAGOS_OFFSET).toISOString().slice(0, 10);

/** 00:00 Lagos on the 1st of `now`'s Lagos month. */
export function lagosMonthStart(now: Date): Date {
  const local = new Date(now.getTime() + LAGOS_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - LAGOS_OFFSET);
}

/** "Swollen feet at 24 weeks. Is this normal?" -> "Swollen feet at 24 weeks. Is this…" */
export function questionTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

const API_STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const;

const inFlight = { status: { in: ['PENDING' as const, 'SUBMITTED' as const] } };

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export function createEarningsService(d: EarningsServiceDeps) {
  const r = d.config.ngnPerUsdc;
  const money = (stroops: bigint): Money => ({
    kobo: stroopsToKobo(stroops, r),
    usdc: stroopsToUsdcString(stroops),
  });
  /** Sums keep kobo exact (stored per row), so ₦400 x 3 is exactly ₦1,200. */
  const sum = (rows: { amountKobo: number; amountStroops: bigint }[]): Money => {
    let kobo = 0;
    let stroops = 0n;
    for (const row of rows) {
      kobo += row.amountKobo;
      stroops += row.amountStroops;
    }
    return { kobo, usdc: stroopsToUsdcString(stroops) };
  };

  const toDto = (w: Withdrawal): WithdrawalDto => ({
    id: w.id,
    status: API_STATUS[w.status],
    amount: { kobo: w.amountKobo, usdc: stroopsToUsdcString(w.amountStroops) },
    destinationAddress: w.destinationAddress,
    destinationMemo: memoOf(w),
    stellarTxHash: w.stellarTxHash,
    failureReason: w.failureReason,
    createdAt: w.createdAt.toISOString(),
    confirmedAt: w.confirmedAt?.toISOString() ?? null,
  });

  /** Her wallet balance in stroops (live when Stellar answers within 4 s, else last known). */
  async function balanceOf(nurseId: string) {
    const view = await d.wallets.view({ id: nurseId, role: 'NURSE', freeAnswersUsed: 0 });
    return {
      stroops: usdcStringToStroops(view.balance.usdc),
      syncedAt: view.balanceSyncedAt,
      address: view.stellarAddress,
      active: view.status === 'active',
    };
  }

  async function inFlightStroops(nurseId: string) {
    const agg = await d.db.withdrawal.aggregate({
      where: { nurseId, ...inFlight },
      _sum: { amountStroops: true },
    });
    return agg._sum.amountStroops ?? 0n;
  }

  async function markConfirmed(w: Withdrawal, txHash: string) {
    const done = await d.db.withdrawal.update({
      where: { id: w.id },
      data: {
        status: 'CONFIRMED',
        stellarTxHash: txHash,
        confirmedAt: d.now(),
        failureReason: null,
      },
    });
    await d.db.wallet.updateMany({
      where: { userId: w.nurseId },
      data: { cachedBalanceStroops: { decrement: w.amountStroops } },
    });
    d.logger.info('withdrawal_confirmed', { withdrawalId: w.id, txHash });
    return done;
  }

  const markFailed = (id: string, reason: string) =>
    d.db.withdrawal.update({
      where: { id },
      data: { status: 'FAILED', failureReason: reason.slice(0, 300) },
    });

  /**
   * Claims a PENDING withdrawal and sends it once: build + sign, store the transaction hash, then
   * submit. Returns the row after the attempt.
   */
  async function send(withdrawalId: string): Promise<Withdrawal> {
    const claimed = await d.db.withdrawal.updateMany({
      where: { id: withdrawalId, status: 'PENDING' },
      data: { status: 'SUBMITTED', attemptAt: d.now(), attempts: { increment: 1 } },
    });
    const w = await d.db.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    if (claimed.count === 0) return w; // already sent by another request

    let prepared;
    try {
      const wallet = await d.db.wallet.findUniqueOrThrow({ where: { userId: w.nurseId } });
      const secret = decryptWalletSecret(
        d.config.wallet.encryptionKey,
        wallet.encryptedSecret,
        wallet.stellarPublicKey,
      );
      prepared = await d.chain!.prepare({
        from: Keypair.fromSecret(secret),
        destination: w.destinationAddress,
        stroops: w.amountStroops,
        memo: memoOf(w),
      });
      // Stored BEFORE submitting: whatever happens next, this exact transaction can be looked up.
      await d.db.withdrawal.update({
        where: { id: w.id },
        data: { preparedTxHash: prepared.hash },
      });
    } catch (err) {
      // Nothing was submitted (Horizon not answering while building, or a bad key): nothing moved.
      const reason = (err as Error).message;
      d.logger.warn('withdrawal_not_sent', { withdrawalId: w.id, reason });
      return markFailed(w.id, `not sent: ${reason}`);
    }

    try {
      await d.chain!.submit(prepared);
      return await markConfirmed(w, prepared.hash);
    } catch (err) {
      const reason = (err as Error).message;
      if (err instanceof StellarRejectedError) {
        d.logger.warn('withdrawal_rejected', { withdrawalId: w.id, reason });
        return markFailed(w.id, reason);
      }
      // Unknown outcome: keep SUBMITTED; resolve() looks the stored hash up.
      d.logger.warn('withdrawal_outcome_unknown', { withdrawalId: w.id, reason });
      return d.db.withdrawal.update({
        where: { id: w.id },
        data: { failureReason: `pending confirmation: ${reason}`.slice(0, 300) },
      });
    }
  }

  /** Settles a withdrawal whose outcome is unknown (SUBMITTED without hash, or a stale PENDING). */
  async function resolve(w: Withdrawal): Promise<Withdrawal> {
    const now = d.now().getTime();
    if (w.status === 'PENDING') {
      // Never claimed for sending (crash between write and send): nothing moved.
      return now - w.createdAt.getTime() > STALE_PENDING_MS
        ? markFailed(w.id, 'not sent (interrupted); nothing left your wallet')
        : w;
    }
    if (w.status !== 'SUBMITTED' || w.stellarTxHash || !d.chain) return w;
    const sentAt = (w.attemptAt ?? w.createdAt).getTime();
    if (!w.preparedTxHash) {
      // Interrupted before the transaction was signed: it was never submitted.
      return now - sentAt > STALE_PENDING_MS
        ? markFailed(w.id, 'not sent (interrupted); nothing left your wallet')
        : w;
    }
    let status;
    try {
      status = await d.chain.transactionStatus(w.preparedTxHash);
    } catch (err) {
      d.logger.warn('withdrawal_lookup_failed', {
        withdrawalId: w.id,
        reason: (err as Error).message,
      });
      return w;
    }
    if (status === 'success') return markConfirmed(w, w.preparedTxHash);
    if (status === 'failed') {
      return markFailed(w.id, 'the payment failed on Stellar; nothing left your wallet');
    }
    return now - sentAt > UNKNOWN_OUTCOME_MS
      ? markFailed(w.id, 'not found on Stellar after the payment expired; nothing left your wallet')
      : w;
  }

  async function resolveMine(nurseId: string) {
    const open = await d.db.withdrawal.findMany({ where: { nurseId, ...inFlight } });
    for (const w of open) await resolve(w);
  }

  return {
    send,
    resolve,

    /** GET /nurse/earnings (N09). */
    async earnings(nurseId: string): Promise<EarningsResponse> {
      await resolveMine(nurseId);
      const now = d.now();
      const weekStart = lagosWeekStart(now);
      const monthStart = lagosMonthStart(now);
      const since = weekStart < monthStart ? weekStart : monthStart;
      const today = lagosDayStart(now).getTime();

      const notFailed = { nurseId, status: { not: 'FAILED' as const } };
      const [bal, held, profile, all, periodRows, recentPayouts, recentWithdrawals] =
        await Promise.all([
          balanceOf(nurseId),
          inFlightStroops(nurseId),
          d.db.nurseProfile.findUniqueOrThrow({ where: { userId: nurseId } }),
          d.db.payout.aggregate({
            where: notFailed,
            _sum: { amountKobo: true, amountStroops: true },
            _count: true,
          }),
          d.db.payout.findMany({
            where: { ...notFailed, createdAt: { gte: since } },
            select: { amountKobo: true, amountStroops: true, createdAt: true },
          }),
          d.db.payout.findMany({
            where: notFailed,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 10,
            include: {
              payment: {
                select: {
                  questionId: true,
                  question: { select: { cleanedText: true, topicSlug: true } },
                },
              },
            },
          }),
          d.db.withdrawal.findMany({
            where: { nurseId, status: { not: 'FAILED' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 10,
          }),
        ]);

      const days: EarningsDay[] = WEEKDAYS.map((weekday, i) => {
        const start = weekStart.getTime() + i * DAY;
        const rows = periodRows.filter(
          (p) => p.createdAt.getTime() >= start && p.createdAt.getTime() < start + DAY,
        );
        return {
          date: lagosDate(new Date(start)),
          weekday,
          total: sum(rows),
          answersCount: rows.length,
          isToday: start === today,
        };
      });
      const week = periodRows.filter((p) => p.createdAt >= weekStart);
      const month = periodRows.filter((p) => p.createdAt >= monthStart);

      const earnings: EarningEntry[] = recentPayouts.map((p) => ({
        kind: 'earning',
        id: p.id,
        questionId: p.payment.questionId,
        category: p.payment.question.topicSlug as QuestionCategory,
        title: questionTitle(p.payment.question.cleanedText),
        amount: { kobo: p.amountKobo, usdc: stroopsToUsdcString(p.amountStroops) },
        paidFromTreasury: p.fromTreasury,
        status: p.status === 'CONFIRMED' ? 'confirmed' : 'pending',
        stellarTxHash: p.stellarTxHash,
        earnedAt: p.createdAt.toISOString(),
      }));
      const withdrawals: WithdrawalEntry[] = recentWithdrawals.map((w) => ({
        kind: 'withdrawal',
        id: w.id,
        amount: { kobo: -w.amountKobo, usdc: stroopsToUsdcString(-w.amountStroops) },
        destinationAddress: w.destinationAddress,
        destinationMemo: memoOf(w),
        status: API_STATUS[w.status],
        stellarTxHash: w.stellarTxHash,
        createdAt: w.createdAt.toISOString(),
      }));
      const at = (e: EarningEntry | WithdrawalEntry) =>
        e.kind === 'earning' ? e.earnedAt : e.createdAt;
      const available = bal.stroops > held ? bal.stroops - held : 0n;

      return {
        available: money(available),
        balance: money(bal.stroops),
        balanceSyncedAt: bal.syncedAt,
        stellarAddress: bal.address,
        payoutAddress: profile.ownStellarAddress,
        totalEarned: {
          kobo: all._sum.amountKobo ?? 0,
          usdc: stroopsToUsdcString(all._sum.amountStroops ?? 0n),
        },
        answersCount: all._count,
        thisWeek: {
          from: lagosDate(weekStart),
          total: sum(week),
          answersCount: week.length,
          days,
        },
        thisMonth: { from: lagosDate(monthStart), total: sum(month), answersCount: month.length },
        recent: [...earnings, ...withdrawals]
          .sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0))
          .slice(0, 10),
      };
    },

    /** GET /nurse/withdrawals: newest first. Cursor = "<createdAt ISO>|<id>". */
    async list(
      nurseId: string,
      page: { cursor?: string; limit: number },
    ): Promise<Page<WithdrawalDto>> {
      await resolveMine(nurseId);
      let after: { createdAt: Date; id: string } | null = null;
      if (page.cursor) {
        const [iso, id] = page.cursor.split('|');
        const createdAt = iso ? new Date(iso) : null;
        if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) {
          throw new AppError(400, 'VALIDATION_FAILED', 'Invalid cursor.', { field: 'cursor' });
        }
        after = { createdAt, id };
      }
      const rows = await d.db.withdrawal.findMany({
        where: {
          nurseId,
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return {
        items: items.map(toDto),
        nextCursor:
          rows.length > page.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      };
    },

    /** POST /nurse/withdrawals (fresh code checked by the router). */
    async withdraw(
      nurseId: string,
      body: { amountKobo: number; address: string; memo?: DestinationMemo },
    ): Promise<{ status: 201; body: WithdrawalDto }> {
      if (!d.chain) {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Withdrawals are not available right now.');
      }
      const address = body.address.trim();
      const badAddress = (message: string) =>
        new AppError(400, 'STELLAR_ADDRESS_INVALID', message, { field: 'destination.address' });
      if (!StrKey.isValidEd25519PublicKey(address)) {
        throw badAddress('That is not a valid Stellar address (G…).');
      }
      const memo = body.memo ? { ...body.memo, value: body.memo.value.trim() } : null;
      const memoProblem = memo ? validateMemo(memo) : null;
      if (memoProblem) {
        throw new AppError(400, 'VALIDATION_FAILED', memoProblem, { field: 'destination.memo' });
      }
      if (body.amountKobo < MIN_WITHDRAWAL_KOBO) {
        throw new AppError(400, 'VALIDATION_FAILED', 'The smallest withdrawal is ₦100.', {
          field: 'amountKobo',
        });
      }

      await resolveMine(nurseId);
      const bal = await balanceOf(nurseId);
      if (address === bal.address) {
        throw badAddress('That is your CareLayer wallet. Enter the wallet you want to send to.');
      }
      const stroops = koboToStroops(body.amountKobo, r);
      const available = bal.stroops - (await inFlightStroops(nurseId));
      if (!bal.active || stroops <= 0n || stroops > available) {
        throw new AppError(409, 'INSUFFICIENT_BALANCE', 'You cannot withdraw more than you have.', {
          available: money(available > 0n ? available : 0n),
          requested: { kobo: body.amountKobo, usdc: stroopsToUsdcString(stroops) },
        });
      }

      let dest;
      try {
        dest = await d.chain.destinationState(address);
      } catch (err) {
        d.logger.warn('withdrawal_destination_check_failed', { reason: (err as Error).message });
        throw new AppError(
          503,
          'SERVICE_UNAVAILABLE',
          'Stellar is not answering. Try again shortly.',
          {
            retryable: true,
          },
        );
      }
      if (!dest.exists) {
        throw badAddress('No Stellar account exists at that address yet.');
      }
      if (!dest.hasUsdcTrustline) {
        throw badAddress('That wallet cannot receive USDC yet. Add a USDC trustline to it first.');
      }

      let created: Withdrawal;
      try {
        created = await d.db.withdrawal.create({
          data: {
            nurseId,
            amountKobo: body.amountKobo,
            amountStroops: stroops,
            destinationAddress: address,
            destinationMemoType: memo?.type ?? null,
            destinationMemo: memo?.value ?? null,
            status: 'PENDING',
            createdAt: d.now(),
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(
            409,
            'CONFLICT',
            'A withdrawal is already in progress. Wait for it to finish.',
          );
        }
        throw err;
      }
      d.logger.info('withdrawal_created', { withdrawalId: created.id, nurseId });

      const after = await send(created.id);
      if (after.status === 'FAILED') {
        throw new AppError(
          502,
          'STELLAR_SUBMIT_FAILED',
          'Stellar did not accept the payment. Nothing left your wallet.',
          { withdrawalId: after.id, reason: after.failureReason },
        );
      }
      return { status: 201, body: toDto(after) };
    },

    /** Background loop: settle withdrawals whose outcome is unknown. */
    async processPending(limit = 20) {
      const open = await d.db.withdrawal.findMany({
        where: inFlight,
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      let settled = 0;
      for (const w of open) if ((await resolve(w)).status !== w.status) settled++;
      return { checked: open.length, settled };
    },
  };
}

export type EarningsService = ReturnType<typeof createEarningsService>;
