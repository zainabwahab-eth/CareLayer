// Periodic eval (paid lane: real LLM calls). Runs the assistant exactly as the API does:
//   1. Hikmah's test set (test/fixtures/assistant-test-questions.json): fixed red flags -> Mode A ->
//      action (answer / offer / emergency); Mode B -> category.
//   2. The clean-up set (evals/cleanup-cases.json): Mode B on messy questions, scored against the
//      clean-up rules and the expected age range / pregnancy weeks.
// Scores and thresholds: evals/scoring.ts. Writes evals/reports/<timestamp>.json and .md, prints a
// summary, and exits 1 when a threshold is missed.
//
//   npm run eval:assistant -w @carelayer/api
//   npm run eval:assistant -w @carelayer/api -- --only=q03,q33     (some cases)
//
// Uses LLM_* from apps/api/.env. Runs 3 calls at a time (NVIDIA's free tier: ~40 a minute).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgeRange, QuestionCategory } from '@carelayer/shared';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/lib/logger.js';
import { loadRedFlags, matchRedFlags } from '../src/modules/emergency/red-flags.js';
import { createAssistant, loadAssistantPrompt } from '../src/modules/llm/assistant.js';
import { createOpenAiCompatibleClient } from '../src/modules/llm/client.js';
import {
  missedThresholds,
  scoreBehaviour,
  scoreCleanup,
  THRESHOLDS,
  type Action,
  type BehaviourResult,
  type CleanupCase,
  type CleanupResult,
} from '../evals/scoring.js';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
const pick = <T extends { id: string }>(xs: T[]) =>
  only ? xs.filter((x) => only.includes(x.id)) : xs;

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error('[eval] LLM_API_KEY is not set in apps/api/.env');
  process.exit(1);
}
const assistant = createAssistant({
  llm: createOpenAiCompatibleClient(config.llm),
  systemPrompt: loadAssistantPrompt(),
  logger: createLogger('silent'),
});
const redFlags = loadRedFlags();

interface FixtureCase {
  id: string;
  question: string;
  expectedAction: Action;
  expectedCategory: QuestionCategory;
}
const fixture = JSON.parse(
  readFileSync(here('../test/fixtures/assistant-test-questions.json'), 'utf8'),
) as {
  cases: FixtureCase[];
};
const cleanupCases = (
  JSON.parse(readFileSync(here('../evals/cleanup-cases.json'), 'utf8')) as { cases: CleanupCase[] }
).cases;

/** Runs tasks with a fixed number in flight. */
async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
        done++;
        process.stdout.write(`\r[eval] ${done}/${items.length}`);
      }
    }),
  );
  process.stdout.write('\n');
  return out;
}

async function behaviour(c: FixtureCase): Promise<BehaviourResult> {
  const base = { id: c.id, expectedAction: c.expectedAction, expectedCategory: c.expectedCategory };
  if (matchRedFlags(redFlags, c.question).length) {
    return { ...base, action: 'emergency', caughtBy: 'fixed_list', category: null };
  }
  try {
    const reply = await assistant.reply([{ role: 'user', text: c.question }]);
    if (reply.redFlagSuspected)
      return { ...base, action: 'emergency', caughtBy: 'llm', category: null };
    const prepared = await assistant.prepareQuestion(c.question);
    return {
      ...base,
      action: reply.offerEscalation ? 'offer' : 'answer',
      caughtBy: null,
      category: prepared.category,
    };
  } catch (err) {
    return { ...base, action: null, caughtBy: null, category: null, error: (err as Error).message };
  }
}

async function cleanup(c: CleanupCase): Promise<CleanupResult> {
  try {
    const q = await assistant.prepareQuestion(c.text);
    return {
      id: c.id,
      cleanedText: q.cleanedText,
      fellBack: q.cleanupFellBack,
      category: q.category,
      ageRange: q.ageRange as AgeRange | null,
      pregnancyWeeks: q.pregnancyWeeks,
    };
  } catch (err) {
    return {
      id: c.id,
      cleanedText: null,
      fellBack: false,
      category: null,
      ageRange: null,
      pregnancyWeeks: null,
      error: (err as Error).message,
    };
  }
}

const started = Date.now();
console.log(`[eval] model ${config.llm.model} at ${config.llm.baseUrl}`);
const behaviourResults = await pool(pick(fixture.cases), 3, behaviour);
const cleanupResults = await pool(pick(cleanupCases), 3, cleanup);
const b = scoreBehaviour(behaviourResults);
const c = scoreCleanup(pick(cleanupCases), cleanupResults);
const missed = missedThresholds(b, c);
const minutes = ((Date.now() - started) / 60_000).toFixed(1);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const md = [
  `# Assistant eval, ${new Date().toISOString()}`,
  '',
  `Model \`${config.llm.model}\` · ${minutes} min · ${missed.length ? '**FAIL**' : '**PASS**'}`,
  '',
  '| Metric | Score | Threshold |',
  '| --- | --- | --- |',
  `| Emergency recall (test set) | ${pct(b.emergencyRecall)} | ${pct(THRESHOLDS.emergencyRecall)} |`,
  `| Action accuracy (answer/offer/emergency) | ${pct(b.actionAccuracy)} | ${pct(THRESHOLDS.actionAccuracy)} |`,
  `| Category accuracy (test set) | ${pct(b.categoryAccuracy)} | ${pct(THRESHOLDS.categoryAccuracy)} |`,
  `| Clean-up pass rate | ${pct(c.cleanupPassRate)} | ${pct(THRESHOLDS.cleanupPassRate)} |`,
  `| Category accuracy (clean-up set) | ${pct(c.categoryAccuracy)} | ${pct(THRESHOLDS.categoryAccuracy)} |`,
  `| Age / weeks extraction | ${pct(c.extractionAccuracy)} | ${pct(THRESHOLDS.extractionAccuracy)} |`,
  '',
  `Emergencies caught by the fixed list: ${b.caughtByFixedList}; by the LLM only: ${b.caughtByLlmOnly}. Call errors: ${b.errors + c.errors}.`,
  '',
  ...(missed.length ? ['## Missed thresholds', ...missed.map((m) => `- ${m}`), ''] : []),
  '## Test set mismatches',
  ...(b.missedEmergencies.length
    ? [`- **Missed emergencies:** ${b.missedEmergencies.join(', ')}`]
    : []),
  ...(b.falseEmergencies.length ? [`- False emergencies: ${b.falseEmergencies.join(', ')}`] : []),
  ...b.actionMismatches.map((m) => `- ${m}`),
  ...b.categoryMismatches.map((m) => `- ${m}`),
  '',
  '## Clean-up failures',
  ...(c.failures.length ? c.failures.map((f) => `- ${f}`) : ['- none']),
  '',
  '## Clean-up outputs',
  ...cleanupResults.map((r) => {
    const input = cleanupCases.find((x) => x.id === r.id)!.text;
    return `- **${r.id}** ${input}\n  → ${r.cleanedText ?? `(error: ${r.error})`}`;
  }),
  '',
].join('\n');

const dir = here('../evals/reports/');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(
  `${dir}${stamp}.json`,
  JSON.stringify(
    { model: config.llm.model, behaviour: b, cleanup: c, behaviourResults, cleanupResults },
    null,
    2,
  ),
);
writeFileSync(`${dir}${stamp}.md`, md);
console.log(md);
console.log(`[eval] report: apps/api/evals/reports/${stamp}.md`);
process.exit(missed.length ? 1 : 0);
