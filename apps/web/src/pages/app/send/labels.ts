import type { AgeRange, HelpfulRating, NurseLanguage, NursePublicProfile } from '@carelayer/shared';
import { nurseRoleLabel } from '../../../utils/nurses';

/* People-facing labels for the ask-a-nurse screens (W07-W11). */

const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  under_18: 'Under 18',
  age_18_24: 'Age 18–24',
  age_25_34: 'Age 25–34',
  age_35_44: 'Age 35–44',
  age_45_plus: 'Age 45+',
};

export function ageRangeLabel(range: AgeRange): string {
  return AGE_RANGE_LABELS[range];
}

export function pregnancyWeeksLabel(weeks: number): string {
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} pregnant`;
}

const LANGUAGE_LABELS: Record<NurseLanguage, string> = {
  english: 'English',
  pidgin: 'Pidgin',
  yoruba: 'Yoruba',
  hausa: 'Hausa',
  igbo: 'Igbo',
};

export function languagesLabel(languages: readonly NurseLanguage[]): string {
  return languages.map((language) => LANGUAGE_LABELS[language]).join(', ');
}

/** "96% helpful (212)"; "New" until her first feedback (decisions log: no stars). */
export function helpfulLabel(rating: HelpfulRating): string {
  return rating.percent === null ? 'New' : `${rating.percent}% helpful (${rating.count})`;
}

/** "Registered midwife, 9 years" (W08). */
export function nurseExperienceLine(nurse: NursePublicProfile): string {
  const years = nurse.yearsOfPractice;
  return `${nurseRoleLabel(nurse.role)}, ${years} ${years === 1 ? 'year' : 'years'}`;
}

/** "~8 min" average response, or null before her first answer (never guessed). */
export function responseTimeLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  return `~${Math.max(1, Math.round(minutes))} min`;
}
