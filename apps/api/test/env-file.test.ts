import { readFileSync } from 'node:fs';
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

  it('syncEnvWithExample fills an empty value with the example default; empty secrets stay empty', () => {
    // Regression: LLM_MODEL / LLM_BASE_URL sat empty in .env although the example had defaults.
    const example = 'LLM_BASE_URL=https://integrate.api.nvidia.com/v1\nLLM_API_KEY=\nB=\n';
    const r = syncEnvWithExample(example, 'LLM_BASE_URL=\nLLM_API_KEY=\nB=x\nOLD=1\n');
    expect(r.text).toContain('LLM_BASE_URL=https://integrate.api.nvidia.com/v1\n');
    expect(r.text).toContain('LLM_API_KEY=\n'); // no default in the example: she fills it
    expect(r.text).toContain('B=x\n'); // a set value is never overwritten
    expect(r.filled).toEqual(['LLM_BASE_URL']);
    expect(r.kept).toEqual(['LLM_API_KEY', 'B']);
    expect(syncEnvWithExample(example, r.text).text).toBe(r.text); // idempotent
  });

  it('.env.example lists every variable config.ts reads (so env:sync can add it)', () => {
    const configSrc = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const read = [...configSrc.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
    const listed = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
    expect(read.length).toBeGreaterThan(20);
    expect(read.filter((k) => !listed.has(k))).toEqual([]);
  });

  it('readEnvValue treats empty as unset', () => {
    expect(readEnvValue(sample, 'STELLAR_TREASURY_SECRET')).toBeUndefined();
    expect(readEnvValue(sample, 'MISSING')).toBeUndefined();
  });
});
