import type { HelpfulRating, NurseLanguage, NurseRole, PublicNurse } from '@carelayer/shared';

const ROLE_LABELS: Record<NurseRole, string> = {
  nurse: 'Registered nurse',
  midwife: 'Registered midwife',
};

export function nurseRoleLabel(role: NurseRole): string {
  return ROLE_LABELS[role];
}

/** "Amaka Okafor" -> "Amaka O." (Figma W12). A single name is shown as is. */
export function shortNurseName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

/** "Amaka O., Registered midwife". */
export function nurseLine(nurse: PublicNurse): string {
  return `${shortNurseName(nurse.displayName)}, ${nurseRoleLabel(nurse.role)}`;
}

const LANGUAGE_LABELS: Record<NurseLanguage, string> = {
  english: 'English',
  pidgin: 'Pidgin',
  yoruba: 'Yoruba',
  hausa: 'Hausa',
  igbo: 'Igbo',
};

/** "English, Yoruba" (W08). */
export function languagesLabel(languages: readonly NurseLanguage[]): string {
  return languages.map((language) => LANGUAGE_LABELS[language]).join(', ');
}

/** "92% helpful (31)" or "New" before her first rating (W08: no stars, contract §9). */
export function helpfulLabel(helpful: HelpfulRating): string {
  if (helpful.percent == null || helpful.count === 0) return 'New';
  return `${helpful.percent}% helpful (${helpful.count})`;
}
