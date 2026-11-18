import type { Money } from '@carelayer/shared';

const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Format contract Money (or raw kobo) for people: 350000 -> "₦3,500". Always uses kobo, never USDC. */
export function formatNaira(value: Money | number): string {
  const kobo = typeof value === 'number' ? value : value.kobo;
  return naira.format(kobo / 100);
}
