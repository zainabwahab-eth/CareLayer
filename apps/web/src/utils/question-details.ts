import type { AgeRange } from '@carelayer/shared';

const AGE_LABELS: Record<AgeRange, string> = {
  under_18: 'Under 18',
  age_18_24: '18-24',
  age_25_34: '25-34',
  age_35_44: '35-44',
  age_45_plus: '45+',
};

/** "Age 25-34" (W07 chips). */
export function ageRangeLabel(range: AgeRange): string {
  return `Age ${AGE_LABELS[range]}`;
}

/** "24 weeks pregnant" (W07 chips). */
export function pregnancyLabel(weeks: number): string {
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} pregnant`;
}
