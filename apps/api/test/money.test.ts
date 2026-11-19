import { describe, expect, it } from 'vitest';
import {
  koboToStroops,
  parseNgnPerUsdcToKobo,
  splitPayout,
  splitPayoutKobo,
  stroopsToKobo,
  stroopsToUsdcString,
} from '../src/lib/money.js';

describe('money (kobo Int, stroops BigInt, no floats)', () => {
  it('parses the rate into kobo per USDC without floats', () => {
    expect(parseNgnPerUsdcToKobo('1600')).toBe(160000n);
    expect(parseNgnPerUsdcToKobo('1550.5')).toBe(155050n);
    expect(parseNgnPerUsdcToKobo('1550.05')).toBe(155005n);
    for (const bad of ['', '0', '1e3', '-1', '1,600', '1600.001', 'abc']) {
      expect(() => parseNgnPerUsdcToKobo(bad)).toThrow();
    }
  });

  it('₦500 at ₦1,600/USDC is exactly 0.3125 USDC', () => {
    expect(koboToStroops(50_000, '1600')).toBe(3_125_000n);
    expect(stroopsToUsdcString(3_125_000n)).toBe('0.3125000');
  });

  it('₦3,500 at ₦1,600/USDC round-trips', () => {
    const stroops = koboToStroops(350_000, '1600');
    expect(stroops).toBe(21_875_000n);
    expect(stroopsToKobo(stroops, '1600')).toBe(350_000);
  });

  it('rounds down when the rate does not divide evenly', () => {
    // ₦1 at ₦1,550.50: 100 * 1e7 / 155050 = 6449.53... -> 6449
    expect(koboToStroops(100, '1550.50')).toBe(6449n);
  });

  it('formats USDC with 7 decimal places', () => {
    expect(stroopsToUsdcString(0n)).toBe('0.0000000');
    expect(stroopsToUsdcString(1n)).toBe('0.0000001');
    expect(stroopsToUsdcString(12_345_678_901n)).toBe('1234.5678901');
    expect(stroopsToUsdcString(-5n)).toBe('-0.0000005');
  });

  it('splits 80/20 and the parts always sum to the whole', () => {
    expect(splitPayout(3_125_000n)).toEqual({ nurse: 2_500_000n, platform: 625_000n });
    expect(splitPayoutKobo(50_000)).toEqual({ nurse: 40_000, platform: 10_000 }); // ₦400 / ₦100
    for (const n of [0n, 1n, 7n, 3_125_001n, 999_999_999n]) {
      const { nurse, platform } = splitPayout(n);
      expect(nurse + platform).toBe(n);
      expect(nurse * 10_000n <= n * 8_000n).toBe(true); // never more than 80% to the nurse
    }
  });

  it('rejects non-integer or negative kobo', () => {
    expect(() => koboToStroops(1.5, '1600')).toThrow();
    expect(() => koboToStroops(-1, '1600')).toThrow();
    expect(() => splitPayoutKobo(0.1)).toThrow();
    expect(() => splitPayout(-1n)).toThrow();
  });
});
