/*
 * MOCK DATA / MOCK BEHAVIOUR. Not medical content, not production logic.
 *
 * Stand-ins for decisions the real API makes server-side (red-flag check,
 * category assignment, pricing). Phrases and replies are illustrative sample
 * text for building the UI and must never be shipped as real guidance.
 */
import type { EmergencyResponse, Money, QuestionCategory } from '@carelayer/shared';

/** Mock fixed answer price: ₦500 (contract open question 6: ANSWER_PRICE_KOBO default). */
export const MOCK_ANSWER_PRICE_KOBO = 50_000;
/** Mock fixed testnet rate (contract open question 7: NGN_PER_USDC). ₦500 = 0.3125 USDC. */
export const MOCK_NGN_PER_USDC = 1_600;

/** Build a contract Money value from kobo. USDC is a 7-place decimal string, never a float. */
export function mockMoney(kobo: number): Money {
  // USDC in 1e-7 units = kobo / 100 (naira) / rate * 1e7.
  const units = Math.round((kobo * 100_000) / MOCK_NGN_PER_USDC);
  const sign = units < 0 ? '-' : '';
  const digits = String(Math.abs(units)).padStart(8, '0');
  return { kobo, usdc: `${sign}${digits.slice(0, -7)}.${digits.slice(-7)}` };
}

/**
 * MOCK red flags. apps/api/config/red-flags.json has no entries yet; these ids
 * are placeholders prefixed `mock_` so they are never mistaken for real ones.
 */
const MOCK_RED_FLAGS: ReadonlyArray<{ id: string; patterns: readonly string[] }> = [
  { id: 'mock_heavy_bleeding', patterns: ['heavy bleeding', 'bleeding heavily', 'soaking a pad'] },
  { id: 'mock_severe_pain', patterns: ['severe pain', 'worst pain'] },
  { id: 'mock_seizure', patterns: ['seizure', 'convulsion', 'fitting'] },
  { id: 'mock_breathing', patterns: ["can't breathe", 'cannot breathe', 'struggling to breathe'] },
  { id: 'mock_fainting', patterns: ['fainted', 'passed out', 'unconscious'] },
  { id: 'mock_baby_not_moving', patterns: ['baby not moving', 'baby stopped moving'] },
  { id: 'mock_self_harm', patterns: ['kill myself', 'end my life', 'hurt myself'] },
];

export function detectMockRedFlags(text: string): string[] {
  const lower = text.toLowerCase();
  return MOCK_RED_FLAGS.filter((flag) => flag.patterns.some((p) => lower.includes(p))).map(
    (flag) => flag.id,
  );
}

/** MOCK emergency content. Numbers are unverified (`verified: false`) on purpose. */
export function mockEmergencyResponse(triggeredBy: string[]): EmergencyResponse {
  return {
    kind: 'emergency',
    message:
      'This could be an emergency. Please get help now: call the emergency number or go to the nearest hospital. This is free and you will not be charged.',
    triggeredBy,
    contacts: [
      { label: 'National emergency number (mock data)', number: '112', verified: false },
      { label: 'Lagos State emergency (mock data)', number: '767', verified: false },
    ],
    findHospitalUrl: 'https://www.google.com/maps/search/hospital+near+me',
  };
}

const CATEGORY_KEYWORDS: ReadonlyArray<[QuestionCategory, readonly string[]]> = [
  ['pregnancy', ['pregnan', 'baby', 'trimester', 'antenatal', 'due date', 'birth']],
  [
    'contraception',
    ['pill', 'contracept', 'condom', 'implant', 'iud', 'injection', 'family planning'],
  ],
  ['periods', ['period', 'cycle', 'menstrua', 'spotting', 'cramps']],
  ['sexual_health', ['sex', 'discharge', 'itch', 'sti', 'infection', 'smell']],
];

/** MOCK of the AI's category assignment. Women never choose a category. */
export function mockCategorise(text: string): QuestionCategory {
  const lower = text.toLowerCase();
  return (
    CATEGORY_KEYWORDS.find(([, words]) => words.some((w) => lower.includes(w)))?.[0] ?? 'general'
  );
}

/** MOCK of the assistant's spelling/grammar clean-up. Never summarises. */
export function mockCleanText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  const capitalised = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.?!]$/.test(capitalised) ? capitalised : `${capitalised}?`;
}

const MOCK_ASSISTANT_REPLIES: Record<QuestionCategory, string> = {
  pregnancy:
    'Thank you for sharing this. Many changes in pregnancy are common, but every pregnancy is different. Can you tell me how many weeks along you are and how long this has been happening?',
  periods:
    'Cycles can vary from month to month, especially with stress, weight changes or a new contraceptive. How long is your usual cycle, and when did this change start?',
  contraception:
    'That is a common question. Side effects often settle within the first three months of a new method. When did you start, and are you taking it at the same time each day?',
  sexual_health:
    'Thank you for trusting me with this. It is private, and a lot of women ask the same thing. Is there any pain, unusual discharge or a smell?',
  general:
    'Thank you for asking. Could you tell me a little more about what you are noticing and how long it has been going on?',
};

/** MOCK assistant reply text for a user message. */
export function mockAssistantReply(category: QuestionCategory): string {
  return MOCK_ASSISTANT_REPLIES[category];
}

/** MOCK of when the assistant suggests a health worker: on request, or after a few messages. */
export function mockShouldOfferEscalation(text: string, userMessageCount: number): boolean {
  const lower = text.toLowerCase();
  const asksForPerson = ['nurse', 'midwife', 'doctor', 'health worker', 'professional'].some((w) =>
    lower.includes(w),
  );
  return asksForPerson || userMessageCount >= 3;
}
