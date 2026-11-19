import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/carelayer',
  NGN_PER_USDC: '1600',
};

describe('loadConfig (zod env validation)', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      logLevel: 'info',
      answerPriceKobo: 50000,
      ngnPerUsdc: '1600',
      corsOrigins: ['http://localhost:5173', 'http://localhost:5174'],
    });
  });

  it('parses CORS origins, trimming blanks', () => {
    expect(
      loadConfig({ ...base, CORS_ORIGINS: ' https://a.test , ,https://b.test' }).corsOrigins,
    ).toEqual(['https://a.test', 'https://b.test']);
  });

  it('fails fast and lists every invalid variable at once', () => {
    try {
      loadConfig({ PORT: 'abc', NGN_PER_USDC: '1,600', ANSWER_PRICE_KOBO: '500.5' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as ConfigError).message;
      for (const name of ['DATABASE_URL', 'PORT', 'NGN_PER_USDC', 'ANSWER_PRICE_KOBO'])
        expect(msg).toContain(name);
    }
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/);
  });

  it('rejects a zero or negative rate and price', () => {
    expect(() => loadConfig({ ...base, NGN_PER_USDC: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ANSWER_PRICE_KOBO: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ANSWER_PRICE_KOBO: '-5' })).toThrow(ConfigError);
  });

  it('keeps the rate as a string (no float on the money path)', () => {
    expect(loadConfig({ ...base, NGN_PER_USDC: '1550.50' }).ngnPerUsdc).toBe('1550.50');
  });
});
