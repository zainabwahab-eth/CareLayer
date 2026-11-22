// Answers, pay on delivery, and feedback (Z8). Contract: docs/API_CONTRACT.md §8.3-8.4.
//
// GET /questions/:id/answer (x402), in order:
//   1. Owner check (404).
//   2. Answered guard: 410 QUESTION_EXPIRED if expired, else 409 QUESTION_NOT_ANSWERED unless
//      answered. No payment is ever requested for an unanswered question.
//   3. Already collected: the same answer and receipt again. Never charged twice.
//   4. Free (one of her first 3): no payment. The treasury pays the nurse.
//   5. Paid: an earlier attempt still PENDING is reconciled on chain first. Then x402: no
//      PAYMENT-SIGNATURE -> 402 with requirements; with one: verify -> record the attempt ->
//      settle -> only on success confirm the payment, create the nurse payout, return the answer.
//      HARD RULE: the answer text is only read after settlement succeeded.
//
// POST /me/questions/:id/collect: the API's own agent. Checks her spending limit and balance,
// signs an x402 payment with her custodial wallet and runs the same flow (in process: same code
// path as the HTTP route, no loopback request).
import {
  FREE_ANSWERS_PER_WOMAN,
  type AnswerResponse,
  type FeedbackResponse,
} from '@carelayer/shared';
import type { Config } from '../../config.js';
import type { Db } from '../../db.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { splitPayout, splitPayoutKobo, stroopsToKobo } from '../../lib/money.js';
import {
  ANSWER_PAYMENT_TIMEOUT_SECONDS,
  answerRequirements,
  classifySettleError,
  classifyVerifyError,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  paymentReference,
  type PaymentPayload,
  type PaymentRequirements,
  type X402Server,
} from '../payments/answer-x402.js';
import type { AnswerPaymentChain } from '../payments/chain.js';
import type { PayoutService } from '../payments/payouts.js';
import type { AnswerPayer } from '../payments/x402-client.js';
import { decryptWalletSecret } from '../wallets/crypto.js';
import type { WalletChain } from '../wallets/chain.js';
import { recomputeNurseStats } from '../nurses/stats.js';
import { moneyFromKobo } from './pricing.js';
import { publicNurse } from './service.js';

/** Margin on top of the payment's own timeout before an unconfirmed attempt is declared failed. */
const SETTLE_DEADLINE_MARGIN_MS = 60_000;

export interface AnswerServiceDeps {
  db: Db;
  config: Pick<Config, 'ngnPerUsdc' | 'webAppUrl'> & {
    x402: Pick<Config['x402'], 'network'>;
    wallet: Pick<Config['wallet'], 'encryptionKey'>;
  };
  /** Where answer payments go (the treasury). Undefined = paid answers answer 503. */
  payTo: string | undefined;
  /** x402 resource server on the facilitator. Undefined = paid answers answer 503. */
  x402: X402Server | undefined;
  /** Reconciles indeterminate settlements. Undefined = a PENDING attempt waits for its deadline. */
  chain: AnswerPaymentChain | undefined;
  /** Live wallet balance for the collect pre-check. */
  walletChain: WalletChain | undefined;
  /** Signs x402 payments for the internal agent. */
  payer: AnswerPayer;
  payouts: PayoutService;
  logger: Logger;
  now: () => Date;
}

/** What GET /questions/:id/answer sends back. */
export type AnswerFetchResult =
  | { kind: 'answer'; body: AnswerResponse; paymentResponseHeader?: string }
  | { kind: 'payment_required'; paymentRequiredHeader: string; body: unknown };

const questionInclude = {
  answer: { include: { nurse: true } },
  payment: true,
} as const;

type LoadedQuestion = Prisma.QuestionGetPayload<{ include: typeof questionInclude }>;

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const unavailable = (message: string, details: Record<string, unknown> = {}) =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message, { retryable: true, ...details });

export function createAnswerService(d: AnswerServiceDeps) {
  const money = (kobo: number) => moneyFromKobo(kobo, d.config.ngnPerUsdc);

  /**
   * The resource server learns the facilitator's supported schemes (GET /supported) before it can
   * build requirements. Done once, lazily; a failure is retried on the next request.
   */
  let x402Ready: Promise<void> | undefined;
  function ensureX402Ready(): Promise<void> {
    x402Ready ??= d.x402!.initialize().catch((err: unknown) => {
      x402Ready = undefined;
      throw err;
    });
    return x402Ready;
  }

  async function load(womanId: string, questionId: string): Promise<LoadedQuestion> {
    const q = await d.db.question.findFirst({
      where: { id: questionId, womanId },
      include: questionInclude,
    });
    if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found.');
    return q;
  }

  /** Step 2: the pay-on-delivery guard. Runs before anything that could ask for money. */
  function guardAnswered(q: LoadedQuestion): asserts q is LoadedQuestion & {
    answer: NonNullable<LoadedQuestion['answer']>;
  } {
    if (q.status === 'EXPIRED') {
      throw new AppError(
        410,
        'QUESTION_EXPIRED',
        'No nurse picked this up in time. You were not charged.',
      );
    }
    if (q.status !== 'ANSWERED' || !q.answer) {
      throw new AppError(
        409,
        'QUESTION_NOT_ANSWERED',
        'There is no answer yet. Nothing has been charged.',
      );
    }
  }

  /** The answer + receipt. Only called once the payment is confirmed (or free). */
  async function answerBody(questionId: string): Promise<AnswerResponse> {
    const q = await d.db.question.findUniqueOrThrow({
      where: { id: questionId },
      include: questionInclude,
    });
    const a = q.answer!;
    const p = q.payment!;
    return {
      answer: {
        questionId: q.id,
        text: a.text,
        nurse: publicNurse(a.nurse),
        recommendSeeSomeoneToday: a.recommendSeeSomeoneToday,
        answeredAt: a.createdAt.toISOString(),
      },
      payment: {
        amount: money(p.amountKobo),
        stellarTxHash: p.stellarTxHash,
        paidFromTreasury: p.source === 'TREASURY_FREE',
      },
    };
  }

  /** Payout row for the nurse's 80%, written inside the confirming transaction. */
  async function payoutData(
    q: LoadedQuestion & { answer: NonNullable<LoadedQuestion['answer']> },
    fromTreasury: boolean,
  ) {
    const dest = await d.payouts.destinationFor(q.answer.nurseId);
    return {
      nurseId: q.answer.nurseId,
      amountKobo: splitPayoutKobo(q.priceKobo).nurse,
      amountStroops: splitPayout(q.priceStroops).nurse,
      fromTreasury,
      destinationAddress: dest.address,
      status: 'PENDING' as const,
    };
  }

  // ---------------------------------------------------------------- free

  /**
   * Free answer: uses one of her first 3 (conditional update, so two collects cannot both use the
   * last one). Returns false if she has none left (the question is then paid).
   */
  async function collectFree(
    q: LoadedQuestion & { answer: NonNullable<LoadedQuestion['answer']> },
  ): Promise<boolean> {
    const payout = await payoutData(q, true);
    const now = d.now();
    try {
      const payoutId = await d.db.$transaction(async (tx) => {
        const used = await tx.user.updateMany({
          where: { id: q.womanId!, freeAnswersUsed: { lt: FREE_ANSWERS_PER_WOMAN } },
          data: { freeAnswersUsed: { increment: 1 } },
        });
        if (used.count === 0) return null;
        const payment = await tx.payment.create({
          data: {
            questionId: q.id,
            source: 'TREASURY_FREE',
            payerAddress: null,
            amountKobo: 0,
            amountStroops: 0n,
            platformFeeStroops: 0n,
            status: 'CONFIRMED',
            createdAt: now,
            settledAt: now,
            payout: { create: payout },
          },
          include: { payout: true },
        });
        await tx.question.update({ where: { id: q.id }, data: { collectedAt: now } });
        return payment.payout!.id;
      });
      if (!payoutId) return false;
      d.logger.info('answer_collected', { questionId: q.id, free: true });
      d.payouts.sendInBackground(payoutId);
      return true;
    } catch (err) {
      // Collected concurrently by another request: that one won, nothing was used twice.
      if (isUniqueViolation(err)) return true;
      throw err;
    }
  }

  // ---------------------------------------------------------------- paid

  /** PENDING -> CONFIRMED + collectedAt + nurse payout, in one transaction. Idempotent. */
  async function confirmPaid(
    q: LoadedQuestion & { answer: NonNullable<LoadedQuestion['answer']> },
    paymentId: string,
    txHash: string,
  ) {
    const payout = await payoutData(q, false);
    const now = d.now();
    const payoutId = await d.db.$transaction(async (tx) => {
      const moved = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'CONFIRMED', stellarTxHash: txHash, settledAt: now, failureReason: null },
      });
      if (moved.count === 0) return null; // confirmed by a concurrent request
      await tx.question.update({ where: { id: q.id }, data: { collectedAt: now } });
      const created = await tx.payout.create({ data: { ...payout, paymentId } });
      return created.id;
    });
    if (payoutId) {
      d.logger.info('answer_collected', { questionId: q.id, free: false, txHash });
      d.payouts.sendInBackground(payoutId);
    }
  }

  async function markFailed(paymentId: string, reason: string) {
    await d.db.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED', failureReason: reason.slice(0, 300) },
    });
  }

  /**
   * An earlier settle whose outcome is unknown. Look for it on chain before asking for money again.
   * Returns 'confirmed' (it went through), 'failed' (it can no longer settle: ask again) or throws
   * 503 (still possible: wait).
   */
  async function reconcile(
    q: LoadedQuestion & { answer: NonNullable<LoadedQuestion['answer']> },
  ): Promise<'confirmed' | 'failed'> {
    const p = q.payment!;
    if (d.chain && p.payerAddress && d.payTo && p.attemptAt) {
      let hash: string | null = null;
      try {
        hash = await d.chain.findTransfer({
          payer: p.payerAddress,
          payTo: d.payTo,
          stroops: p.amountStroops,
          since: new Date(p.attemptAt.getTime() - SETTLE_DEADLINE_MARGIN_MS),
        });
      } catch (err) {
        d.logger.warn('payment_reconcile_failed', {
          questionId: q.id,
          reason: (err as Error).message,
        });
      }
      if (hash) {
        d.logger.info('payment_reconciled', { questionId: q.id, txHash: hash });
        await confirmPaid(q, p.id, hash);
        return 'confirmed';
      }
    }
    if (p.settleDeadline && d.now() > p.settleDeadline) {
      await markFailed(p.id, 'settlement not found on chain before the payment expired');
      return 'failed';
    }
    const retryAfterSeconds = p.settleDeadline
      ? Math.max(5, Math.ceil((p.settleDeadline.getTime() - d.now().getTime()) / 1000))
      : 30;
    throw unavailable('Your payment is still being confirmed. Try again in a moment.', {
      paymentPending: true,
      retryAfterSeconds,
    });
  }

  async function paymentRequired(
    q: LoadedQuestion,
    requirements: PaymentRequirements[],
    error?: string,
  ): Promise<AnswerFetchResult> {
    const required = await d.x402!.createPaymentRequiredResponse(
      requirements,
      {
        url: `${d.config.webAppUrl}/questions/${q.id}/answer`,
        description: 'CareLayer: one answer from a verified nurse or midwife',
        mimeType: 'application/json',
      },
      error,
    );
    return {
      kind: 'payment_required',
      paymentRequiredHeader: encodePaymentRequiredHeader(required),
      body: required,
    };
  }

  /** Record the attempt BEFORE settling: create the row, or reuse a FAILED one. */
  async function recordAttempt(
    q: LoadedQuestion,
    header: string,
    payer: string | undefined,
  ): Promise<string> {
    const now = d.now();
    const data = {
      source: 'WOMAN_WALLET' as const,
      payerAddress: payer ?? null,
      amountKobo: q.priceKobo,
      amountStroops: q.priceStroops,
      platformFeeStroops: splitPayout(q.priceStroops).platform,
      status: 'PENDING' as const,
      x402Reference: paymentReference(header),
      attemptAt: now,
      attempts: { increment: 1 },
      settleDeadline: new Date(
        now.getTime() + ANSWER_PAYMENT_TIMEOUT_SECONDS * 1000 + SETTLE_DEADLINE_MARGIN_MS,
      ),
      failureReason: null,
    };
    const busy = () =>
      new AppError(409, 'CONFLICT', 'A payment for this answer is already in progress.');
    if (q.payment) {
      const claimed = await d.db.payment.updateMany({
        where: { id: q.payment.id, status: 'FAILED' },
        data,
      });
      if (claimed.count === 0) throw busy();
      return q.payment.id;
    }
    try {
      const created = await d.db.payment.create({
        data: { ...data, attempts: 1, questionId: q.id, createdAt: now },
      });
      return created.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw busy();
      throw err;
    }
  }

  async function fetchPaid(
    q: LoadedQuestion & { answer: NonNullable<LoadedQuestion['answer']> },
    paymentHeader: string | undefined,
  ): Promise<AnswerFetchResult> {
    if (!d.x402 || !d.payTo) {
      throw unavailable('Payments are not available right now. You were not charged.');
    }

    if (q.payment?.status === 'PENDING') {
      if ((await reconcile(q)) === 'confirmed')
        return { kind: 'answer', body: await answerBody(q.id) };
      q = { ...q, payment: await d.db.payment.findUniqueOrThrow({ where: { id: q.payment.id } }) };
    }

    let requirements: PaymentRequirements[];
    try {
      await ensureX402Ready();
      requirements = await answerRequirements(d.x402, {
        network: d.config.x402.network,
        payTo: d.payTo,
        priceStroops: q.priceStroops,
      });
    } catch (err) {
      d.logger.warn('x402_requirements_failed', { reason: (err as Error).message });
      throw unavailable('The payment service is busy. Try again shortly. You were not charged.');
    }
    if (!paymentHeader) return paymentRequired(q, requirements);

    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(paymentHeader);
    } catch {
      return paymentRequired(q, requirements, 'invalid_payment_header');
    }
    const match = d.x402.findMatchingRequirements(requirements, payload);
    if (!match) return paymentRequired(q, requirements, 'payment_does_not_match_requirements');

    // Verify. Nothing moves on chain here.
    let payer: string | undefined;
    try {
      const v = await d.x402.verifyPayment(payload, match);
      if (!v.isValid) {
        return paymentRequired(q, requirements, v.invalidReason ?? 'invalid_payment');
      }
      payer = v.payer;
    } catch (err) {
      if (classifyVerifyError(err) === 'invalid') {
        return paymentRequired(q, requirements, 'invalid_payment');
      }
      d.logger.warn('x402_verify_unavailable', { reason: (err as Error).message });
      throw unavailable('The payment service is busy. Try again shortly. You were not charged.');
    }

    // Record the attempt, then settle.
    const paymentId = await recordAttempt(q, paymentHeader, payer);
    let settled;
    try {
      settled = await d.x402.settlePayment(payload, match);
    } catch (err) {
      const reason = (err as Error).message;
      if (classifySettleError(err) === 'indeterminate') {
        await d.db.payment.update({
          where: { id: paymentId },
          data: { failureReason: `indeterminate: ${reason}`.slice(0, 300) },
        });
        d.logger.warn('x402_settle_indeterminate', { questionId: q.id, reason });
        throw unavailable('Your payment is being confirmed. Try again in a moment.', {
          paymentPending: true,
          retryAfterSeconds: 30,
        });
      }
      await markFailed(paymentId, reason);
      d.logger.warn('x402_settle_rejected', { questionId: q.id, reason });
      throw unavailable('The payment service is busy. Try again shortly. You were not charged.');
    }
    if (!settled.success || !settled.transaction) {
      await markFailed(paymentId, settled.errorReason ?? 'settlement_failed');
      d.logger.warn('x402_settle_failed', { questionId: q.id, reason: settled.errorReason });
      return paymentRequired(q, requirements, settled.errorReason ?? 'settlement_failed');
    }

    await confirmPaid(q, paymentId, settled.transaction);
    return {
      kind: 'answer',
      body: await answerBody(q.id),
      paymentResponseHeader: encodePaymentResponseHeader(settled),
    };
  }

  // ---------------------------------------------------------------- public

  async function fetchAnswer(
    womanId: string,
    questionId: string,
    paymentHeader?: string,
  ): Promise<AnswerFetchResult> {
    const q = await load(womanId, questionId);
    guardAnswered(q);

    if (q.payment?.status === 'CONFIRMED') return { kind: 'answer', body: await answerBody(q.id) };

    // Free if quoted free and she still has one of her first 3 (decided now, on collection).
    if (q.isFree && !q.payment && (await collectFree(q))) {
      return { kind: 'answer', body: await answerBody(q.id) };
    }
    return fetchPaid(q, paymentHeader);
  }

  return {
    fetchAnswer,

    /** POST /me/questions/:id/collect: the API's own agent pays from her custodial wallet. */
    async collect(
      womanId: string,
      questionId: string,
      opts: { approvedAboveLimit?: boolean } = {},
    ): Promise<AnswerResponse> {
      const q = await load(womanId, questionId);
      guardAnswered(q);

      const first = await fetchAnswer(womanId, questionId);
      if (first.kind === 'answer') return first.body; // collected already, free, or reconciled

      // She pays: her limit, then her balance, then sign and pay.
      const settings = await d.db.userSettings.findUnique({ where: { userId: womanId } });
      const limit = settings?.spendingLimitPerAnswerKobo ?? 100_000;
      if (q.priceKobo > limit && !opts.approvedAboveLimit) {
        throw new AppError(
          409,
          'SPENDING_LIMIT_EXCEEDED',
          'This answer costs more than your limit per answer. Approve it to continue.',
          { priceKobo: q.priceKobo, spendingLimitKobo: limit },
        );
      }
      const wallet = await d.db.wallet.findUnique({ where: { userId: womanId } });
      let balance = wallet?.cachedBalanceStroops ?? 0n;
      if (wallet?.activatedAt && d.walletChain) {
        try {
          balance = (await d.walletChain.accountState(wallet.stellarPublicKey)).usdcStroops;
          await d.db.wallet.update({
            where: { id: wallet.id },
            data: { cachedBalanceStroops: balance, balanceSyncedAt: d.now() },
          });
        } catch {
          // Stellar slow: use the last known balance; the payment itself will fail safely if short.
        }
      }
      if (!wallet?.activatedAt || balance < q.priceStroops) {
        throw new AppError(
          409,
          'INSUFFICIENT_BALANCE',
          'Not enough in your wallet for this answer. Top up to continue.',
          {
            price: money(q.priceKobo),
            balance: money(stroopsToKobo(balance, d.config.ngnPerUsdc)),
          },
        );
      }

      const secret = decryptWalletSecret(
        d.config.wallet.encryptionKey,
        wallet.encryptedSecret,
        wallet.stellarPublicKey,
      );
      let header: string;
      try {
        header = await d.payer.createPaymentHeader(secret, first.paymentRequiredHeader);
      } catch (err) {
        d.logger.warn('x402_sign_failed', { questionId, reason: (err as Error).message });
        throw unavailable(
          'We could not prepare the payment. Try again shortly. You were not charged.',
        );
      }
      const paid = await fetchAnswer(womanId, questionId, header);
      if (paid.kind === 'answer') return paid.body;
      throw unavailable('The payment did not go through. You were not charged. Try again.');
    },

    /** POST /questions/:id/feedback: one per answer, changeable. Updates the nurse's % helpful. */
    async feedback(
      womanId: string,
      questionId: string,
      helpful: boolean,
    ): Promise<FeedbackResponse> {
      const q = await load(womanId, questionId);
      if (q.status !== 'ANSWERED' || !q.answer || !q.collectedAt) {
        throw new AppError(
          409,
          'QUESTION_NOT_ANSWERED',
          'You can rate an answer once you have it.',
        );
      }
      const answer = q.answer;
      const fb = await d.db.$transaction(async (tx) => {
        const row = await tx.feedback.upsert({
          where: { answerId: answer.id },
          update: { helpful },
          create: { answerId: answer.id, womanId, helpful },
        });
        await recomputeNurseStats(tx, answer.nurseId);
        return row;
      });
      return { questionId: q.id, helpful: fb.helpful, updatedAt: fb.updatedAt.toISOString() };
    },
  };
}

export type AnswerService = ReturnType<typeof createAnswerService>;
