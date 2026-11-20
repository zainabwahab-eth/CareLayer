import { describe, expect, it } from 'vitest';
import {
  EXTRA_KEYS_HEADER,
  fillEnv,
  readEnvValue,
  syncEnvWithExample,
} from '../src/lib/env-file.js';

const sample = [
  '# Stellar',
  'STELLAR_TREASURY_SECRET=',
  'X402_PAY_TO_ADDRESS=GEXISTING',
  '',
  '# x402',
  'X402_FACILITATOR_API_KEY=   ',
].join('\n');

describe('fillEnv (never overwrites a set value)', () => {
  it('fills empty values, appends missing keys, keeps set ones, preserves comments', () => {
    const { text, results } = fillEnv(sample, {
      STELLAR_TREASURY_SECRET: 'SNEW',
      X402_PAY_TO_ADDRESS: 'GNEW',
      X402_FACILITATOR_API_KEY: 'key123',
      X402_TEST_PAYER_SECRET: 'SPAYER',
    });
    expect(results).toEqual([
      { key: 'STELLAR_TREASURY_SECRET', action: 'filled' },
      { key: 'X402_PAY_TO_ADDRESS', action: 'kept' },
      { key: 'X402_FACILITATOR_API_KEY', action: 'filled' },
      { key: 'X402_TEST_PAYER_SECRET', action: 'appended' },
    ]);
    expect(text).toContain('# Stellar');
    expect(text).toContain('X402_PAY_TO_ADDRESS=GEXISTING');
    expect(readEnvValue(text, 'STELLAR_TREASURY_SECRET')).toBe('SNEW');
    expect(readEnvValue(text, 'X402_FACILITATOR_API_KEY')).toBe('key123');
    expect(readEnvValue(text, 'X402_TEST_PAYER_SECRET')).toBe('SPAYER');
  });

  it('is idempotent: running it twice changes nothing the second time', () => {
    const once = fillEnv(sample, { STELLAR_TREASURY_SECRET: 'SNEW' }).text;
    const twice = fillEnv(once, { STELLAR_TREASURY_SECRET: 'SOTHER' });
    expect(twice.text).toBe(once);
    expect(twice.results[0]!.action).toBe('kept');
  });

  it('handles CRLF files and rejects unsafe keys or values', () => {
    expect(readEnvValue('A=1\r\nB=2\r\n', 'B')).toBe('2');
    expect(() => fillEnv('', { 'bad-key': 'x' })).toThrow();
    expect(() => fillEnv('', { GOOD: 'a\nINJECTED=1' })).toThrow();
  });

  it('syncEnvWithExample: example order and comments, your values kept, new keys added, old keys moved', () => {
    const example = [
      '# Auth',
      'JWT_ACCESS_SECRET=',
      'AUTH_PEPPER=',
      'AUTH_COOKIE_SAMESITE=lax',
      '',
      '# Email',
      'EMAIL_TRANSPORT=console',
      '',
    ].join('\n');
    const env = [
      'REFRESH_TOKEN_PEPPER=',
      'JWT_ACCESS_SECRET=secret1',
      'EMAIL_TRANSPORT=resend',
      'AUTH_PEPPER=pep',
      'CUSTOM=1',
    ].join('\r\n');
    const r = syncEnvWithExample(example, env);
    expect(r.text).toBe(
      [
        '# Auth',
        'JWT_ACCESS_SECRET=secret1',
        'AUTH_PEPPER=pep',
        'AUTH_COOKIE_SAMESITE=lax',
        '',
        '# Email',
        'EMAIL_TRANSPORT=resend',
        '',
        EXTRA_KEYS_HEADER,
        'REFRESH_TOKEN_PEPPER=',
        'CUSTOM=1',
        '',
      ].join('\n'),
    );
    expect(r.kept).toEqual(['JWT_ACCESS_SECRET', 'AUTH_PEPPER', 'EMAIL_TRANSPORT']);
    expect(r.added).toEqual(['AUTH_COOKIE_SAMESITE']);
    expect(r.extra).toEqual(['REFRESH_TOKEN_PEPPER', 'CUSTOM']);
  });

  it('syncEnvWithExample is idempotent and keeps an explicitly empty value', () => {
    const example = 'A=default\nB=\n';
    const once = syncEnvWithExample(example, 'A=\nB=x\nOLD=1\n').text;
    expect(once).toContain('A=\n'); // her explicit empty stays empty
    expect(syncEnvWithExample(example, once).text).toBe(once);
  });

  it('readEnvValue treats empty as unset', () => {
    expect(readEnvValue(sample, 'STELLAR_TREASURY_SECRET')).toBeUndefined();
    expect(readEnvValue(sample, 'MISSING')).toBeUndefined();
  });
});
