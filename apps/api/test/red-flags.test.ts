// Fixed red-flag list: the real file loads, and matching is the documented case-insensitive
// substring match. This list runs before the LLM, so it must work with no network at all.
import { describe, expect, it } from 'vitest';
import {
  loadRedFlags,
  matchRedFlags,
  normaliseForMatching,
  parseRedFlags,
} from '../src/modules/emergency/red-flags.js';

const flags = loadRedFlags();

describe('red-flags.json (Hikmah owns the content)', () => {
  it('loads and validates the real file', () => {
    expect(flags.length).toBeGreaterThan(5);
    for (const f of flags) expect(f.patterns.length).toBeGreaterThan(0);
  });

  it('matches regardless of case, curly apostrophes and extra spaces', () => {
    expect(matchRedFlags(flags, 'I CAN’T  BREATHE   PROPERLY since morning')).toContain(
      'severe_breathing_difficulty_or_chest_pain',
    );
    expect(matchRedFlags(flags, 'Abeg I wan kill myself')).toContain('suicide_or_self_harm_risk');
  });

  it('matches inside a longer message and can return several flags', () => {
    const hit = matchRedFlags(
      flags,
      'Since yesterday I took too many pills and now I am struggling to breathe',
    );
    expect(hit).toEqual(
      expect.arrayContaining([
        'suspected_overdose_or_poisoning',
        'severe_breathing_difficulty_or_chest_pain',
      ]),
    );
  });

  it('does not match an ordinary question', () => {
    expect(matchRedFlags(flags, 'Is it normal to feel tired in early pregnancy?')).toEqual([]);
  });

  it('every pattern in the file matches itself (no pattern is unreachable after normalising)', () => {
    for (const f of flags) {
      for (const p of f.patterns) expect(matchRedFlags(flags, p)).toContain(f.id);
    }
  });

  it('refuses a broken file instead of running without a safety net', () => {
    expect(() => parseRedFlags({ flags: [] })).toThrow();
    expect(() => parseRedFlags({})).toThrow();
    expect(() =>
      parseRedFlags({
        flags: [
          { id: 'a', label: 'A', patterns: ['abc def'] },
          { id: 'a', label: 'B', patterns: ['ghi jkl'] },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() => loadRedFlags('does/not/exist.json')).toThrow(/Cannot read red flags/);
  });

  it('normalises text the same way for both sides', () => {
    expect(normaliseForMatching('  Don’t\n\tSTOP  ')).toBe("don't stop");
  });
});
