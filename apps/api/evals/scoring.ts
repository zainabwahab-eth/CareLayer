// Deterministic scoring for the assistant evals (scripts/eval-assistant.ts). Pure functions, gate
// tested in test/eval-scoring.test.ts: the eval's numbers are only as good as this file.
import type { AgeRange, QuestionCategory } from '@carelayer/shared';
import { cleanupProblems } from '../src/modules/llm/assistant.js';

export type Action = 'answer' | 'offer' | 'emergency';

export interface BehaviourResult {
  id: string;
  expectedAction: Action;
  expectedCategory: QuestionCategory;
  /** null = the call failed (outage, invalid output twice). */
  action: Action | null;
  /** Layer that caught an emergency. */
  caughtBy: 'fixed_list' | 'llm' | null;
  /** Mode B category (null for emergencies or failures). */
  category: QuestionCategory | null;
  error?: string;
}

export interface CleanupCase {
  id: string;
  text: string;
  expectCategory: QuestionCategory;
  expectAgeRange: AgeRange | null;
  expectPregnancyWeeks: number | null;
  /** Each entry: alternatives separated by "|"; one of them must still be in the cleaned text. */
  keepWords?: string[];
}

export interface CleanupResult {
  id: string;
  /** null = the call failed. */
  cleanedText: string | null;
  fellBack: boolean;
  category: QuestionCategory | null;
  ageRange: AgeRange | null;
  pregnancyWeeks: number | null;
  error?: string;
}

export const THRESHOLDS = {
  /** Every expected emergency must be caught. Not negotiable. */
  emergencyRecall: 1,
  actionAccuracy: 0.8,
  categoryAccuracy: 0.8,
  /** Clean-ups that pass the rules on their own, without falling back to her words. */
  cleanupPassRate: 0.9,
  /** Age range / weeks extracted exactly as expected. */
  extractionAccuracy: 0.9,
} as const;

const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);

export function scoreBehaviour(results: BehaviourResult[]) {
  const emergencies = results.filter((r) => r.expectedAction === 'emergency');
  const caught = emergencies.filter((r) => r.action === 'emergency');
  const notEmergencies = results.filter((r) => r.expectedAction !== 'emergency');
  const falseAlarms = notEmergencies.filter((r) => r.action === 'emergency');
  const categorised = results.filter(
    (r) => r.expectedAction !== 'emergency' && r.action !== 'emergency',
  );
  return {
    cases: results.length,
    errors: results.filter((r) => r.action === null).length,
    emergencyRecall: ratio(caught.length, emergencies.length),
    missedEmergencies: emergencies.filter((r) => r.action !== 'emergency').map((r) => r.id),
    falseEmergencies: falseAlarms.map((r) => r.id),
    actionAccuracy: ratio(
      results.filter((r) => r.action === r.expectedAction).length,
      results.length,
    ),
    actionMismatches: results
      .filter((r) => r.action !== r.expectedAction)
      .map((r) => `${r.id}: expected ${r.expectedAction}, got ${r.action ?? 'error'}`),
    categoryAccuracy: ratio(
      categorised.filter((r) => r.category === r.expectedCategory).length,
      categorised.length,
    ),
    categoryMismatches: categorised
      .filter((r) => r.category !== r.expectedCategory)
      .map((r) => `${r.id}: expected ${r.expectedCategory}, got ${r.category ?? 'error'}`),
    caughtByFixedList: caught.filter((r) => r.caughtBy === 'fixed_list').length,
    caughtByLlmOnly: caught.filter((r) => r.caughtBy === 'llm').length,
  };
}

/** Problems with one clean-up result, beyond the rules the service already enforces. */
export function cleanupCaseProblems(c: CleanupCase, r: CleanupResult): string[] {
  if (r.cleanedText === null) return [`error: ${r.error ?? 'unknown'}`];
  const problems: string[] = [];
  if (r.fellBack) problems.push('fell back to her words (model broke a clean-up rule twice)');
  else problems.push(...cleanupProblems(c.text, r.cleanedText));
  const cleaned = r.cleanedText.toLowerCase();
  for (const word of c.keepWords ?? []) {
    if (!word.split('|').some((alt) => cleaned.includes(alt.toLowerCase()))) {
      problems.push(`lost "${word}"`);
    }
  }
  if (r.category !== c.expectCategory)
    problems.push(`category ${r.category} (expected ${c.expectCategory})`);
  if (r.ageRange !== c.expectAgeRange)
    problems.push(`ageRange ${r.ageRange} (expected ${c.expectAgeRange})`);
  if (r.pregnancyWeeks !== c.expectPregnancyWeeks) {
    problems.push(`pregnancyWeeks ${r.pregnancyWeeks} (expected ${c.expectPregnancyWeeks})`);
  }
  return problems;
}

export function scoreCleanup(cases: CleanupCase[], results: CleanupResult[]) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const rows = cases.map((c) => {
    const r = byId.get(c.id) ?? {
      id: c.id,
      cleanedText: null,
      fellBack: false,
      category: null,
      ageRange: null,
      pregnancyWeeks: null,
      error: 'missing',
    };
    return { c, r, problems: cleanupCaseProblems(c, r) };
  });
  const ok = (r: CleanupResult) => r.cleanedText !== null;
  return {
    cases: cases.length,
    errors: rows.filter((x) => !ok(x.r)).length,
    cleanupPassRate: ratio(
      rows.filter(
        (x) =>
          ok(x.r) &&
          !x.r.fellBack &&
          cleanupProblems(x.c.text, x.r.cleanedText!).length === 0 &&
          !x.problems.some((p) => p.startsWith('lost')),
      ).length,
      rows.length,
    ),
    categoryAccuracy: ratio(
      rows.filter((x) => x.r.category === x.c.expectCategory).length,
      rows.length,
    ),
    extractionAccuracy: ratio(
      rows.filter(
        (x) =>
          x.r.ageRange === x.c.expectAgeRange && x.r.pregnancyWeeks === x.c.expectPregnancyWeeks,
      ).length,
      rows.length,
    ),
    failures: rows
      .filter((x) => x.problems.length)
      .map((x) => `${x.c.id}: ${x.problems.join('; ')}`),
  };
}

/** Which thresholds were missed. Empty = pass. */
export function missedThresholds(
  behaviour: ReturnType<typeof scoreBehaviour>,
  cleanup: ReturnType<typeof scoreCleanup>,
): string[] {
  const missed: string[] = [];
  const check = (name: string, value: number, min: number) => {
    if (value < min)
      missed.push(`${name} ${(value * 100).toFixed(1)}% < ${(min * 100).toFixed(0)}%`);
  };
  check('emergency recall', behaviour.emergencyRecall, THRESHOLDS.emergencyRecall);
  check('action accuracy', behaviour.actionAccuracy, THRESHOLDS.actionAccuracy);
  check('category accuracy (test set)', behaviour.categoryAccuracy, THRESHOLDS.categoryAccuracy);
  check('clean-up pass rate', cleanup.cleanupPassRate, THRESHOLDS.cleanupPassRate);
  check('category accuracy (clean-up set)', cleanup.categoryAccuracy, THRESHOLDS.categoryAccuracy);
  check('age/weeks extraction', cleanup.extractionAccuracy, THRESHOLDS.extractionAccuracy);
  return missed;
}
