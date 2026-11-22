// Price quote for one nurse answer: price, free answers left, spending limit.
//
// Free answers left = 3 - collected free answers - free quotes still in flight (open, claimed or
// answered but not collected). Counting in-flight quotes means she is never told "free" for a 4th
// question while 3 free ones are still waiting; an expired or cancelled question gives its free
// answer back. The final charge is still decided when she collects the answer (Z8).
import { FREE_ANSWERS_PER_WOMAN, type EscalationOffer, type Money } from '@carelayer/shared';
import type { Db } from '../../db.js';
import { koboToStroops, stroopsToUsdcString } from '../../lib/money.js';

/** Schema default for UserSettings.spendingLimitPerAnswerKobo (₦1,000). */
export const DEFAULT_SPENDING_LIMIT_KOBO = 100_000;

export function moneyFromKobo(kobo: number, ngnPerUsdc: string): Money {
  return { kobo, usdc: stroopsToUsdcString(koboToStroops(kobo, ngnPerUsdc)) };
}

export async function freeAnswersRemaining(
  db: Pick<Db, 'question'>,
  woman: { id: string; freeAnswersUsed: number },
): Promise<number> {
  const inFlight = await db.question.count({
    where: {
      womanId: woman.id,
      isFree: true,
      collectedAt: null,
      status: { in: ['OPEN', 'CLAIMED', 'ANSWERED'] },
    },
  });
  return Math.max(0, FREE_ANSWERS_PER_WOMAN - woman.freeAnswersUsed - inFlight);
}

export interface Quote {
  priceKobo: number;
  priceStroops: bigint;
  price: Money;
  isFree: boolean;
  freeAnswersRemaining: number;
  spendingLimitKobo: number;
  /** She pays and the price is above her per-answer limit: she must approve it. */
  exceedsSpendingLimit: boolean;
}

/** Schema default for UserSettings.mcpSpendingLimitPerAnswerKobo (₦500): Claude's own limit. */
export const DEFAULT_MCP_SPENDING_LIMIT_KOBO = 50_000;

/** Where the request comes from: her app (her limit) or Claude via an agent token (Claude's limit). */
export type Channel = 'web' | 'mcp';

/** Her per-answer spending limit for this channel. */
export function spendingLimitFor(
  settings: { spendingLimitPerAnswerKobo: number; mcpSpendingLimitPerAnswerKobo: number } | null,
  channel: Channel,
): number {
  return channel === 'mcp'
    ? (settings?.mcpSpendingLimitPerAnswerKobo ?? DEFAULT_MCP_SPENDING_LIMIT_KOBO)
    : (settings?.spendingLimitPerAnswerKobo ?? DEFAULT_SPENDING_LIMIT_KOBO);
}

export async function quoteFor(
  db: Pick<Db, 'question' | 'user' | 'userSettings'>,
  cfg: { answerPriceKobo: number; ngnPerUsdc: string },
  womanId: string,
  channel: Channel = 'web',
): Promise<Quote> {
  const [woman, settings] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: womanId } }),
    db.userSettings.findUnique({ where: { userId: womanId } }),
  ]);
  const remaining = await freeAnswersRemaining(db, woman);
  const isFree = remaining > 0;
  const spendingLimitKobo = spendingLimitFor(settings, channel);
  return {
    priceKobo: cfg.answerPriceKobo,
    priceStroops: koboToStroops(cfg.answerPriceKobo, cfg.ngnPerUsdc),
    price: moneyFromKobo(cfg.answerPriceKobo, cfg.ngnPerUsdc),
    isFree,
    freeAnswersRemaining: remaining,
    spendingLimitKobo,
    exceedsSpendingLimit: !isFree && cfg.answerPriceKobo > spendingLimitKobo,
  };
}

export function offerFrom(
  quote: Quote,
  category: EscalationOffer['suggestedCategory'],
): EscalationOffer {
  return {
    price: quote.price,
    isFree: quote.isFree,
    freeAnswersRemaining: quote.freeAnswersRemaining,
    suggestedCategory: category,
    exceedsSpendingLimit: quote.exceedsSpendingLimit,
  };
}
