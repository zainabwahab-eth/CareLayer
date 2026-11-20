// The eval's scoring is deterministic: gate-tested so a wrong number never passes as a real one.
import { describe, expect, it } from 'vitest';
import {
  cleanupCaseProblems,
  missedThresholds,
  scoreBehaviour,
  scoreCleanup,
  type BehaviourResult,
  type CleanupCase,
} from '../evals/scoring.js';

const r = (over: Partial<BehaviourResult>): BehaviourResult => ({
  id: 'x',
  expectedAction: 'answer',
  expectedCategory: 'general',
  action: 'answer',
  caughtBy: null,
  category: 'general',
  ...over,
});

describe('scoreBehaviour', () => {
  it('recall counts only expected emergencies; a miss is listed by id', () => {
    const s = scoreBehaviour([
      r({
        id: 'e1',
        expectedAction: 'emergency',
        action: 'emergency',
        caughtBy: 'fixed_list',
        category: null,
      }),
      r({ id: 'e2', expectedAction: 'emergency', action: 'offer', category: 'pregnancy' }),
      r({ id: 'a1', action: 'emergency', caughtBy: 'llm', category: null }),
      r({ id: 'a2' }),
    ]);
    expect(s.emergencyRecall).toBe(0.5);
    expect(s.missedEmergencies).toEqual(['e2']);
    expect(s.falseEmergencies).toEqual(['a1']);
    expect(s.actionAccuracy).toBe(0.5);
    expect(s.caughtByFixedList).toBe(1);
  });

  it('category accuracy ignores emergencies; errors count as wrong', () => {
    const s = scoreBehaviour([
      r({ id: 'a', category: 'general' }),
      r({ id: 'b', expectedCategory: 'periods', category: 'pregnancy' }),
      r({ id: 'c', action: null, category: null, error: 'timeout' }),
      r({ id: 'e', expectedAction: 'emergency', action: 'emergency', category: null }),
    ]);
    expect(s.categoryAccuracy).toBeCloseTo(1 / 3);
    expect(s.errors).toBe(1);
    expect(s.actionMismatches).toEqual(['c: expected answer, got error']);
  });
});

describe('clean-up scoring', () => {
  const c: CleanupCase = {
    id: 'c1',
    text: 'i think i missed 2 pills, i am 22',
    expectCategory: 'contraception',
    expectAgeRange: 'age_18_24',
    expectPregnancyWeeks: null,
    keepWords: ['think'],
  };
  const good = {
    id: 'c1',
    cleanedText: 'I think I missed 2 pills. I am 22.',
    fellBack: false,
    category: 'contraception' as const,
    ageRange: 'age_18_24' as const,
    pregnancyWeeks: null,
  };

  it('a faithful clean-up with the right extraction has no problems', () => {
    expect(cleanupCaseProblems(c, good)).toEqual([]);
    const s = scoreCleanup([c], [good]);
    expect(s).toMatchObject({
      cleanupPassRate: 1,
      categoryAccuracy: 1,
      extractionAccuracy: 1,
      failures: [],
    });
  });

  it('flags lost uncertainty, fallbacks, wrong extraction and errors', () => {
    expect(
      cleanupCaseProblems(c, { ...good, cleanedText: 'I missed 2 pills. I am 22, okay.' }),
    ).toContain('lost "think"');
    expect(cleanupCaseProblems(c, { ...good, fellBack: true })[0]).toMatch(/fell back/);
    expect(cleanupCaseProblems(c, { ...good, ageRange: null })).toContain(
      'ageRange null (expected age_18_24)',
    );
    expect(cleanupCaseProblems(c, { ...good, cleanedText: null, error: 'timeout' })).toEqual([
      'error: timeout',
    ]);
    expect(scoreCleanup([c], [{ ...good, fellBack: true }]).cleanupPassRate).toBe(0);
  });
});

describe('missedThresholds', () => {
  it('any missed emergency fails the eval', () => {
    const b = scoreBehaviour([
      r({ expectedAction: 'emergency', action: 'answer' }),
      ...Array.from({ length: 20 }, (_, i) => r({ id: `a${i}` })),
    ]);
    const c = scoreCleanup([], []);
    expect(missedThresholds(b, c)).toEqual([expect.stringMatching(/^emergency recall/)]);
  });
});
