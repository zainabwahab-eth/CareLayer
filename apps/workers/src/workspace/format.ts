import {
  DEFAULT_ANSWER_PRICE_KOBO,
  PAYOUT_SPLIT,
  type AgeRange,
  type NurseLanguage,
  type NurseQuestionView,
  type NurseRole,
} from '@carelayer/shared';

/*
 * Labels and time maths for the nurse workspace. Money is always formatted
 * from kobo with apps/web's formatNaira (never from USDC).
 */

/**
 * The nurse's share of an answer at the agreed default price (₦500 × 80% = ₦400).
 * NurseQuestionView carries no price, so this comes from @carelayer/shared's
 * defaults (docs/QUESTIONS.md Q6).
 */
export const ANSWER_SHARE_KOBO = (DEFAULT_ANSWER_PRICE_KOBO * PAYOUT_SPLIT.nurseBps) / 10_000;

const AGE_LABELS: Record<AgeRange, string> = {
  under_18: 'Under 18',
  age_18_24: 'Age 18–24',
  age_25_34: 'Age 25–34',
  age_35_44: 'Age 35–44',
  age_45_plus: 'Age 45+',
};

export const ageRangeLabel = (range: AgeRange) => AGE_LABELS[range];

const LANGUAGE_LABELS: Record<NurseLanguage, string> = {
  english: 'English',
  pidgin: 'Pidgin',
  yoruba: 'Yoruba',
  hausa: 'Hausa',
  igbo: 'Igbo',
};

export const languageLabel = (language: NurseLanguage) => LANGUAGE_LABELS[language];

export const roleLabel = (role: NurseRole | null) =>
  role === 'midwife' ? 'Midwife' : role === 'nurse' ? 'Nurse' : 'Health worker';

/** "08:42" for a countdown. Never negative. */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "Waiting 4 min", "Waiting under a minute". */
export function waitingLabel(createdAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(createdAt)) / 60_000);
  return minutes < 1 ? 'Waiting under a minute' : `Waiting ${minutes} min`;
}

/** "Age 25–34, 30 weeks" from what she agreed to share. */
export function contextLine(q: Pick<NurseQuestionView, 'ageRange' | 'pregnancyWeeks'>): string {
  const parts: string[] = [];
  if (q.ageRange) parts.push(ageRangeLabel(q.ageRange));
  if (q.pregnancyWeeks !== null) parts.push(`${q.pregnancyWeeks} weeks`);
  return parts.join(', ');
}

/** Milliseconds until an ISO time (negative once passed). */
export const msUntil = (iso: string | null, now: number) =>
  iso === null ? 0 : Date.parse(iso) - now;

/** "GABC…WXYZ" for long Stellar addresses. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** "Good morning" / "Good afternoon" / "Good evening" in her local time. */
export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;

/** "1,500" or "1500.50" -> kobo, or null. */
export function parseNaira(value: string): number | null {
  const cleaned = value.replace(/[,\s₦]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
