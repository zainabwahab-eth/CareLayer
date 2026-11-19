// Money maths. Naira as integer kobo, USDC as integer stroops (1 USDC = 10^7 stroops). No floats.
// All conversions use BigInt and round DOWN (in the platform's favour by at most 1 stroop).
import { PAYOUT_SPLIT } from '@carelayer/shared';

export const STROOPS_PER_USDC = 10_000_000n;

/** "1600" -> 160000n kobo per USDC. "1550.5" -> 155050n. Rejects anything that is not a plain decimal. */
export function parseNgnPerUsdcToKobo(ngnPerUsdc: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(ngnPerUsdc.trim());
  if (!match) throw new Error(`Invalid NGN_PER_USDC: "${ngnPerUsdc}"`);
  const naira = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  const koboPerUsdc = naira * 100n + fraction;
  if (koboPerUsdc <= 0n) throw new Error('NGN_PER_USDC must be greater than 0');
  return koboPerUsdc;
}

function assertKobo(kobo: number) {
  if (!Number.isSafeInteger(kobo) || kobo < 0) {
    throw new Error(`kobo must be a non-negative safe integer, got ${kobo}`);
  }
}

/** Naira (kobo) -> USDC stroops at the fixed demo rate. Rounds down. */
export function koboToStroops(kobo: number, ngnPerUsdc: string): bigint {
  assertKobo(kobo);
  return (BigInt(kobo) * STROOPS_PER_USDC) / parseNgnPerUsdcToKobo(ngnPerUsdc);
}

/** USDC stroops -> naira (kobo) at the fixed demo rate, for display. Rounds down. */
export function stroopsToKobo(stroops: bigint, ngnPerUsdc: string): number {
  if (stroops < 0n) throw new Error('stroops must be non-negative');
  const kobo = (stroops * parseNgnPerUsdcToKobo(ngnPerUsdc)) / STROOPS_PER_USDC;
  if (kobo > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('kobo overflow');
  return Number(kobo);
}

/** 3125000n -> "0.3125000" (the `usdc` string in the API's Money type, always 7 places). */
export function stroopsToUsdcString(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_USDC;
  const fraction = (abs % STROOPS_PER_USDC).toString().padStart(7, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Nurse gets 80% (rounded down), platform keeps the remainder, so the parts always sum to the whole. */
export function splitPayout(amount: bigint): { nurse: bigint; platform: bigint } {
  if (amount < 0n) throw new Error('amount must be non-negative');
  const nurse = (amount * BigInt(PAYOUT_SPLIT.nurseBps)) / 10_000n;
  return { nurse, platform: amount - nurse };
}

/** Same split for kobo amounts (display and records). */
export function splitPayoutKobo(kobo: number): { nurse: number; platform: number } {
  assertKobo(kobo);
  const nurse = Math.floor((kobo * PAYOUT_SPLIT.nurseBps) / 10_000);
  return { nurse, platform: kobo - nurse };
}
